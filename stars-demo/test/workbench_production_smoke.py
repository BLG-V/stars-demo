"""Public HTTPS workbench smoke test using two pre-created synthetic accounts.

Never registers accounts, sends email, or starts generation. Resource IDs are
recorded in the private state for the operator's exact cleanup afterwards.
"""

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

from production_acceptance import private_write, public_write


ROOT = Path(__file__).resolve().parents[1]


def forbidden_post(path):
    return bool(re.search(r"/api/projects/[^/]+/runs(?:/|$)", path)) or path.startswith("/api/auth/register")


def api(context, base, path, method="GET", data=None, expected=200):
    assert method != "POST" or not forbidden_post("/api" + path), "Forbidden smoke-test request"
    response = context.request.fetch(base + "/api" + path, method=method, data=data)
    assert response.status == expected, f"API returned {response.status}; expected {expected}"
    return response.json()


def run_checks(browser, args, state, report):
    base = state["baseUrl"]
    blocked, page_errors = [], []

    def remember(kind, resource_id):
        if resource_id not in state[kind]:
            state[kind].append(resource_id)
            private_write(args.private_state, state)

    def make_context():
        context = browser.new_context(viewport={"width": 1280, "height": 900})

        def guard(route):
            path = urlparse(route.request.url).path
            if route.request.method == "POST" and forbidden_post(path):
                blocked.append({"method": "POST", "path": path})
                route.abort("blockedbyclient")
            else:
                route.continue_()

        context.route("**/api/**", guard)
        page = context.new_page()
        page.on("pageerror", lambda _error: page_errors.append("JavaScriptError"))
        return context, page

    def login_ui(context, page, user, stage):
        report["stage"] = stage
        page.goto(base + "/", wait_until="networkidle")
        page.get_by_role("button", name="登录", exact=True).click()
        dialog = page.get_by_role("dialog", name="登录工作区")
        dialog.get_by_label("邮箱", exact=True).fill(user["email"])
        dialog.get_by_label("密码", exact=True).fill(user["password"])
        with page.expect_response(lambda response: response.request.method == "POST" and urlparse(response.url).path == "/api/auth/login") as submitted:
            dialog.get_by_role("button", name="登录", exact=True).click()
        response = submitted.value
        if response.status != 200 and response.json().get("error", {}).get("code") == "TURNSTILE_FAILED":
            report["failureReason"] = "Turnstile blocked normal UI login; no verification bypass attempted"
        assert response.status == 200, "Normal UI login failed"
        dialog.wait_for(state="detached")
        assert api(context, base, "/me")["user"]["id"] == user["id"]
        session = next(cookie for cookie in context.cookies() if cookie["name"] == "stars_session")
        assert session["secure"] and session["httpOnly"] and session["sameSite"] == "Lax"

    def create_folder(page, name):
        page.get_by_role("button", name="创建文件夹", exact=True).click()
        dialog = page.get_by_role("dialog", name="新建文件夹")
        dialog.get_by_label("文件夹名称").fill(name)
        with page.expect_response(lambda response: response.request.method == "POST" and urlparse(response.url).path == "/api/folders") as submitted:
            dialog.get_by_role("button", name="创建文件夹", exact=True).click()
        assert submitted.value.status == 201
        folder = submitted.value.json()["folder"]
        remember("folderIds", folder["id"])
        dialog.wait_for(state="detached")
        expect(page.get_by_role("heading", name=name, exact=True)).to_be_visible()
        return folder["id"]

    def folder_menu(page, name, action):
        page.get_by_role("button", name="管理文件夹 " + name, exact=True).click()
        page.get_by_role("menuitem", name=action, exact=True).click()

    def delete_folder(page, name):
        folder_menu(page, name, "删除")
        dialog = page.get_by_role("dialog", name="删除文件夹")
        dialog.get_by_role("button", name="确认删除", exact=True).click()
        dialog.wait_for(state="detached")
        expect(page.locator(".folder-item").filter(has_text=name)).to_have_count(0)

    def screenshot(page, filename):
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(args.output_dir / filename), full_page=False)

    def logout_ui(context, page):
        page.get_by_role("button", name=re.compile("个人账户")).click()
        page.get_by_role("menuitem", name="退出登录", exact=True).click()
        page.locator(".public-shell").wait_for(state="visible")
        api(context, base, "/me", expected=401)

    primary, page = make_context()
    secondary, second_page = make_context()
    try:
        health = api(primary, base, "/health")
        assert health["storage"] == "mysql" and health["stubModel"] is False
        api(primary, base, "/folders", expected=401)
        api(primary, base, "/projects", expected=401)
        report["checks"].append("valid-https-mysql-no-stub")
        report["checks"].append("anonymous-folders-projects-rejected")
        login_ui(primary, page, state["users"][0], "login-primary")
        assert not api(primary, base, "/projects")["projects"], "Use fresh temporary accounts"
        report["checks"].append("normal-ui-login-secure-session")

        report["stage"] = "folders-projects"
        stamp = str(time.time_ns())[-8:]
        folder_name = "公网冒烟归档 " + stamp
        folder_id = create_folder(page, folder_name)
        projects = []
        for index in range(9):
            project = api(primary, base, "/projects", "POST", {"name": f"公网冒烟项目 {index + 1:02d}"}, 201)["project"]
            remember("projectIds", project["id"])
            projects.append(project)
        project = projects[0]
        page.reload(wait_until="networkidle")
        page.get_by_role("link", name="我的项目", exact=True).click()
        page.get_by_label("移动 " + project["name"] + " 到文件夹", exact=True).select_option(folder_id)
        page.get_by_text("项目已移入文件夹。", exact=True).wait_for()
        page.reload(wait_until="networkidle")
        page.locator(".folder-item").filter(has_text=folder_name).click()
        expect(page.locator(".project-row")).to_have_count(1)
        expect(page.get_by_label("移动 " + project["name"] + " 到文件夹", exact=True)).to_have_value(folder_id)
        renamed = "公网已归档 " + stamp
        folder_menu(page, folder_name, "重命名")
        dialog = page.get_by_role("dialog", name="重命名文件夹")
        dialog.get_by_label("文件夹名称").fill(renamed)
        dialog.get_by_role("button", name="保存名称", exact=True).click()
        dialog.wait_for(state="detached")
        page.reload(wait_until="networkidle")
        page.locator(".folder-item").filter(has_text=renamed).click()
        expect(page.get_by_role("heading", name=renamed, exact=True)).to_be_visible()
        screenshot(page, "desktop-folder.png")
        report["checks"].append("folder-create-rename-and-project-assignment-survive-refresh")

        page.get_by_role("link", name="最近项目", exact=True).click()
        expect(page.locator(".project-row")).to_have_count(8)
        page.locator(".folder-item").filter(has_text="全部项目").click()
        expect(page.get_by_role("heading", name="我的项目", exact=True)).to_be_visible()
        expect(page.locator(".project-row")).to_have_count(9)
        report["checks"].append("recent-eight-to-all-nine")

        report["stage"] = "new-project-plan-only"
        page.locator(".project-open").filter(has_text=project["name"]).click()
        expect(page).to_have_url(base + "/?projectId=" + project["id"])
        page.locator(".folder-item").filter(has_text=renamed).click()
        page.get_by_role("button", name="新建项目", exact=True).click()
        expect(page).to_have_url(base + "/")
        attachment = page.locator("input[type='file'][aria-label='添加文本附件']")
        attachment.set_input_files({"name": "smoke-notes.md", "mimeType": "text/markdown", "buffer": b"Production smoke: local text context only."})
        page.get_by_text("smoke-notes.md", exact=True).wait_for()
        page.get_by_role("button", name="移除附件 smoke-notes.md", exact=True).click()
        expect(page.get_by_text("smoke-notes.md", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="语音输入", exact=True)).to_be_enabled()
        report["checks"].append("attachment-select-remove-and-voice-entry")
        page.get_by_label("描述你的应用").fill("仅创建生成计划；不执行模型调用。")
        with page.expect_response(lambda response: response.request.method == "POST" and urlparse(response.url).path == "/api/projects") as submitted:
            page.get_by_role("button", name="开始构建", exact=True).click()
        assert submitted.value.status == 201
        new_project = submitted.value.json()["project"]
        remember("projectIds", new_project["id"])
        assert new_project["id"] != project["id"] and new_project["folderId"] == folder_id
        page.get_by_role("heading", name="确认生成计划", exact=True).wait_for()
        planned = api(primary, base, "/projects/" + new_project["id"])
        assert not planned["files"] and planned["runs"] and all(run["status"] == "planned" for run in planned["runs"])
        page.get_by_role("button", name="取消计划", exact=True).click()
        report["checks"].append("explicit-new-project-clears-current-and-keeps-folder-plan-only")

        report["stage"] = "ownership"
        login_ui(secondary, second_page, state["users"][1], "login-secondary")
        report["stage"] = "ownership"
        assert not api(secondary, base, "/folders")["folders"]
        assert not api(secondary, base, "/projects")["projects"]
        api(secondary, base, "/projects/" + project["id"], expected=404)
        api(secondary, base, "/projects/" + project["id"], "PATCH", {"folderId": None}, 404)
        api(secondary, base, "/folders/" + folder_id, "PATCH", {"name": "forbidden"}, 404)
        api(secondary, base, "/folders/" + folder_id, "DELETE", expected=404)
        api(secondary, base, "/projects", "POST", {"name": "forbidden", "folderId": folder_id}, 404)
        report["checks"].append("second-user-project-folder-isolation")

        report["stage"] = "mobile-and-delete"
        page.set_viewport_size({"width": 375, "height": 900})
        expect(page.get_by_role("button", name="创建文件夹", exact=True)).to_be_visible()
        mobile_name = "公网移动文件夹 " + stamp
        create_folder(page, mobile_name)
        account = page.get_by_role("button", name=re.compile("个人账户"))
        account.click()
        expect(page.get_by_role("menu", name="个人账户菜单")).to_be_visible()
        account.click()
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        screenshot(page, "mobile-workbench.png")
        delete_folder(page, mobile_name)
        delete_folder(page, renamed)
        assert api(primary, base, "/projects/" + project["id"])["project"]["folderId"] is None
        assert api(primary, base, "/projects/" + new_project["id"])["project"]["folderId"] is None
        report["checks"].append("mobile-folder-account-no-overflow-and-folder-delete-unassigns")

        report["stage"] = "logout"
        logout_ui(primary, page)
        logout_ui(secondary, second_page)
        assert not blocked, "Forbidden generation or email request attempted"
        assert not page_errors, "Browser JavaScript errors detected"
        report["checks"].append("both-ui-logouts-and-no-generation-or-email-posts")
    finally:
        report["blockedRequests"] = blocked
        report["browserErrorCount"] = len(page_errors)
        primary.close()
        secondary.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-state", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "test-results" / "production-workbench-2026-10-24")
    args = parser.parse_args()
    args.private_state = args.private_state.resolve()
    assert not args.private_state.is_relative_to(ROOT.parent.resolve()), "Private state must be outside the workspace"
    state = json.loads(args.private_state.read_text(encoding="utf-8-sig"))
    base = urlparse(state["baseUrl"])
    assert base.scheme == "https" and base.hostname and not base.username and not base.password and base.path in ("", "/") and not base.query and not base.fragment, "Use a valid HTTPS origin"
    assert len(state["users"]) == 2 and state["users"][0]["id"] != state["users"][1]["id"]
    for user in state["users"]:
        domain = user["email"].rsplit("@", 1)[-1].lower()
        assert user["id"] and user["password"] and (domain.endswith(".test") or domain in {"example.com", "example.net", "example.org"}), "Use synthetic temporary accounts only"
    state["baseUrl"] = state["baseUrl"].rstrip("/")
    state.setdefault("projectIds", [])
    state.setdefault("folderIds", [])
    private_write(args.private_state, state)
    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"testedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": state["baseUrl"], "result": "failed", "stage": "health", "checks": [], "realModelCalls": 0}
    failed = False
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                run_checks(browser, args, state, report)
            finally:
                browser.close()
        report.update({"result": "passed", "stage": "complete"})
    except Exception as error:
        failed = True
        report["errorType"] = type(error).__name__
    finally:
        report["temporaryResourceCounts"] = {"projects": len(state["projectIds"]), "folders": len(state["folderIds"])}
        public_write(args.output_dir / "report.json", report)
    if failed:
        raise SystemExit(f"Workbench smoke failed at {report['stage']} ({report['errorType']}). " + report.get("failureReason", "See sanitized report; no automatic retry."))
    print("Production workbench smoke passed; sanitized report and screenshots saved. Temporary IDs remain in private state for cleanup.")


if __name__ == "__main__":
    main()
