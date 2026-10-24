"""Staged production acceptance. Run only after deployment authorization.

The run phase makes one real generation; verify and cleanup never start a model.
Sensitive browser state stays in an explicitly selected file outside the project.
"""

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PROMPT = (
    "Create a minimal Stars application using exactly index.html, styles.css and app.js. "
    "Use only local HTML/CSS/JavaScript. Include a heading with id stars-status whose initial "
    "text is exactly 'Stars ready', and a button with id stars-action and text 'Launch Stars'. "
    "Clicking the button must change that heading text to exactly 'Stars launched'. "
    "Do not include external resources, URLs, imports or other features. "
    "Return complete files in the required JSON format."
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def private_write(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    if os.name == "nt":
        account = subprocess.check_output(["whoami"], text=True).strip()
        subprocess.run(
            ["icacls", str(path), "/inheritance:r", "/grant:r", f"{account}:(F)",
             "*S-1-5-18:(F)", "*S-1-5-32-544:(F)"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )


def public_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def file_hashes(files):
    return {item["path"]: hashlib.sha256(item["content"].encode()).hexdigest() for item in files}


def api(context, base, path, method="GET", data=None, expected=200):
    response = context.request.fetch(base + "/api" + path, method=method, data=data)
    assert response.status == expected, f"API status {response.status}, expected {expected}"
    return response.json()


def project_data(context, state):
    return api(context, state["baseUrl"], "/projects/" + state["projectId"])


def check_app(page):
    frame = page.frame_locator("iframe[title='生成应用预览']")
    expect(frame.locator("#stars-status")).to_have_text("Stars ready", timeout=15000)
    frame.locator("#stars-action").click()
    expect(frame.locator("#stars-status")).to_have_text("Stars launched")
    assert page.locator(".preview-failure").count() == 0


def run_checks(browser, args, state, report):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, **({"storage_state": state["storageState"]} if args.resume_unstarted else {}))
    page = context.new_page()
    errors, plans = [], set()
    page.on("pageerror", lambda error: errors.append(type(error).__name__))

    def cap_runs(route):
        if route.request.method == "POST":
            plan_id = (route.request.post_data_json or {}).get("planId")
            if not plan_id or (plan_id not in plans and len(plans) >= args.max_model_calls):
                route.abort("blockedbyclient")
                return
            plans.add(plan_id)
        route.continue_()

    page.route("**/api/projects/*/runs", cap_runs)
    report["stage"] = "register"
    page.goto(state["baseUrl"] + ("/?projectId=" + state["projectId"] if args.resume_unstarted else ""), wait_until="networkidle")
    assert page.locator(".workflow-panel").is_visible()
    if args.resume_unstarted:
        existing = project_data(context, state)
        assert not existing["files"] and existing["runs"] and all(run["status"] == "planned" for run in existing["runs"])
        assert not state.get("generationAttempted"), "A previous paid attempt cannot be resumed as a new run"
        report["previousUnstartedPlans"] = len(existing["runs"])
    else:
        page.get_by_role("button", name="登录", exact=True).click()
        page.get_by_role("button", name="还没有账号？注册", exact=True).click()
        page.get_by_label("邮箱", exact=True).fill(f"stars-prod-{time.time_ns()}@example.test")
        page.get_by_label("密码", exact=True).fill("Stars!" + secrets.token_urlsafe(24))
        page.get_by_role("button", name="注册", exact=True).click()
        page.wait_for_selector("dialog", state="detached")
        state["userIds"] = [api(context, state["baseUrl"], "/me")["user"]["id"]]
    state["storageState"] = context.storage_state()
    private_write(args.private_state, state)
    session = next(cookie for cookie in context.cookies() if cookie["name"] == "stars_session")
    assert session["secure"] and session["httpOnly"] and session["sameSite"] == "Lax"

    report["stage"] = "plan"
    page.get_by_label("描述你的应用").fill(PROMPT)
    page.get_by_role("button", name="开始构建", exact=True).click()
    page.get_by_role("heading", name="确认生成计划").wait_for()
    state["projectId"] = parse_qs(urlparse(page.url).query)["projectId"][0]
    state["storageState"] = context.storage_state()
    private_write(args.private_state, state)
    before = project_data(context, state)
    assert not before["files"] and not plans
    assert before["runs"][0]["status"] == "planned"
    state["runId"] = max(before["runs"], key=lambda run: run["createdAt"])["id"]
    private_write(args.private_state, state)
    assert page.locator("iframe").count() == 0

    report["stage"] = "real_generation"
    state["generationAttempted"] = True
    private_write(args.private_state, state)
    page.get_by_role("button", name="确认计划并生成", exact=True).click()
    page.get_by_role("heading", name="检查文件变更").wait_for(timeout=240000)
    candidate = project_data(context, state)
    review = next(run for run in candidate["runs"] if run["status"] == "review")
    assert len(plans) == 1 and not candidate["files"]
    assert review["model"] != "local-stub" and review["details"]["candidateFiles"]
    state["runId"] = review["id"]
    private_write(args.private_state, state)
    page.locator(".approval-panel").screenshot(path=str(args.artifacts / "candidate-review.png"))
    page.reload(wait_until="networkidle")
    page.get_by_role("heading", name="检查文件变更").wait_for()
    assert not project_data(context, state)["files"]

    report["stage"] = "approve_preview"
    page.get_by_role("button", name="确认应用变更", exact=True).click()
    page.get_by_role("heading", name="构建完成").wait_for()
    assert page.locator(".dev-notice").count() == 0
    check_app(page)
    saved = project_data(context, state)
    state["historyRunCount"] = len(saved["runs"])
    state["fileHashes"] = file_hashes(saved["files"])
    assert {"index.html", "styles.css", "app.js"}.issubset(state["fileHashes"])
    assert next(run for run in saved["runs"] if run["id"] == state["runId"])["status"] == "done"
    again = api(context, state["baseUrl"], f"/projects/{state['projectId']}/runs/{state['runId']}/approve", "POST", {})
    assert file_hashes(again["files"]) == state["fileHashes"]
    run = next(item for item in again["runs"] if item["id"] == state["runId"])
    assert len([event for event in run["details"]["events"] if event["type"] == "done"]) == 1

    report["stage"] = "snapshot_edit_restore"
    page.get_by_role("button", name="保存版本", exact=True).click()
    page.get_by_text("版本已保存。", exact=True).wait_for()
    page.locator(".file-row").filter(has_text="index.html").click()
    page.get_by_role("button", name="编辑文件", exact=True).click()
    editor = page.get_by_label("编辑 index.html", exact=True)
    original = editor.input_value()
    editor.fill(original + '<p id="production-edit">Production acceptance edit</p>')
    page.get_by_role("button", name="保存文件", exact=True).click()
    page.get_by_text("文件已保存。", exact=True).wait_for()
    edited = project_data(context, state)
    assert file_hashes(edited["files"]) != state["fileHashes"]
    page.get_by_role("button", name="查看差异", exact=True).first.click()
    assert page.get_by_role("dialog").locator(".diff-line").count() > 0
    page.set_viewport_size({"width": 375, "height": 900})
    page.get_by_role("dialog").screenshot(path=str(args.artifacts / "snapshot-diff-mobile.png"))
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.get_by_role("button", name="关闭差异", exact=True).click()
    page.get_by_role("button", name="恢复", exact=True).first.click()
    page.get_by_role("button", name="确认恢复", exact=True).click()
    page.get_by_text("版本已恢复，恢复前文件已自动备份。", exact=True).wait_for()
    restored = project_data(context, state)
    assert file_hashes(restored["files"]) == state["fileHashes"]
    assert len(restored["snapshots"]) == 2
    assert any("Production acceptance edit" in file["content"] for snapshot in restored["snapshots"] for file in snapshot["manifest"])
    page.reload(wait_until="networkidle")
    page.get_by_role("heading", name="构建完成").wait_for()
    check_app(page)
    for width in (375, 768, 1280):
        page.set_viewport_size({"width": width, "height": 1000})
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=str(args.artifacts / "production-workbench.png"), full_page=True)

    report["stage"] = "ownership"
    anonymous = browser.new_context()
    api(anonymous, state["baseUrl"], "/projects/" + state["projectId"], expected=401)
    api(anonymous, state["baseUrl"], "/projects/" + state["projectId"] + "/runs", "POST", {}, expected=401)
    second = browser.new_context()
    other = api(second, state["baseUrl"], "/auth/register", "POST", {
        "email": f"stars-prod-other-{time.time_ns()}@example.test",
        "password": "Stars!" + secrets.token_urlsafe(24),
    }, expected=201)
    state["userIds"].append(other["user"]["id"])
    state["secondaryStorageState"] = second.storage_state()
    private_write(args.private_state, state)
    for suffix in ("", "/files", "/messages", "/runs", "/snapshots"):
        api(second, state["baseUrl"], "/projects/" + state["projectId"] + suffix, expected=404)
    for suffix, method, body in (("/files", "PUT", {"path": "index.html", "content": "forbidden"}),
                                 ("", "DELETE", {}),
                                 (f"/runs/{state['runId']}/approve", "POST", {})):
        api(second, state["baseUrl"], "/projects/" + state["projectId"] + suffix, method, body, expected=404)
    assert not errors
    state["storageState"] = context.storage_state()
    private_write(args.private_state, state)
    report.update({"projectId": state["projectId"], "runId": state["runId"], "userIds": state["userIds"],
                   "generatedFiles": sorted(state["fileHashes"]), "fileHashes": state["fileHashes"],
                   "distinctRunPlansSubmitted": len(plans), "model": review["model"],
                   "providerCallCountRequiresServerEvidence": True, "snapshots": len(restored["snapshots"]),
                   "checks": ["HTTPS", "mysql-health", "secure-session", "plan-gate", "candidate-gate",
                              "review-reload", "idempotent-approval", "real-preview-interaction", "snapshot-diff",
                              "protective-restore", "refresh", "responsive", "ownership-401-404"]})
    anonymous.close()
    second.close()
    context.close()


def verify_checks(browser, args, state, report):
    context = browser.new_context(storage_state=state["storageState"], viewport={"width": 1280, "height": 1000})
    page = context.new_page()
    page.route("**/api/projects/*/runs", lambda route: route.abort("blockedbyclient") if route.request.method == "POST" else route.continue_())
    data = project_data(context, state)
    assert file_hashes(data["files"]) == state["fileHashes"]
    assert next(run for run in data["runs"] if run["id"] == state["runId"])["status"] == "done"
    page.goto(state["baseUrl"] + "/?projectId=" + state["projectId"], wait_until="networkidle")
    page.get_by_role("heading", name="构建完成").wait_for()
    check_app(page)
    assert page.locator(".run-history details").count() == state["historyRunCount"]
    page.screenshot(path=str(args.artifacts / "post-restart.png"), full_page=True)
    report.update({"projectId": state["projectId"], "runId": state["runId"], "fileHashesMatch": True,
                   "checks": ["session-after-restart", "files-after-restart", "history-after-restart", "preview-after-restart"],
                   "distinctRunPlansSubmitted": 0})
    context.close()


def cleanup_checks(browser, state, report):
    for key in ("storageState", "secondaryStorageState"):
        if key not in state:
            continue
        context = browser.new_context(storage_state=state[key])
        if key == "storageState" and state.get("projectId"):
            response = context.request.get(state["baseUrl"] + "/api/projects/" + state["projectId"])
            if response.status == 200:
                for run in response.json()["runs"]:
                    if run["status"] == "review":
                        api(context, state["baseUrl"], f"/projects/{state['projectId']}/runs/{run['id']}/reject", "POST", {})
                api(context, state["baseUrl"], "/projects/" + state["projectId"], "DELETE", {})
            else:
                assert response.status == 404
        api(context, state["baseUrl"], "/auth/logout", "POST", {})
        context.close()
    report.update({"projectId": state.get("projectId"), "userIds": state.get("userIds", []),
                   "checks": ["test-project-soft-delete", "test-sessions-logout"],
                   "databasePurgeRequired": True, "distinctRunPlansSubmitted": 0})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("run", "verify", "cleanup"), required=True)
    parser.add_argument("--base-url", default="https://39.107.41.101")
    parser.add_argument("--private-state", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, default=ROOT / "test-results" / "production-acceptance")
    parser.add_argument("--max-model-calls", type=int, choices=(1, 2), default=1)
    parser.add_argument("--resume-unstarted", action="store_true", help="Reuse a saved account/project only when no model was attempted and all runs remain planned")
    args = parser.parse_args()
    args.private_state = args.private_state.resolve()
    args.artifacts = args.artifacts.resolve()
    assert not args.private_state.is_relative_to(ROOT.parent.resolve()), "Private state must be outside the workspace"
    args.artifacts.mkdir(parents=True, exist_ok=True)
    state = {"baseUrl": args.base_url.rstrip("/")} if args.phase == "run" and not args.resume_unstarted else read_json(args.private_state)
    if args.phase == "run" and not args.resume_unstarted:
        assert not args.private_state.exists(), "Use a fresh private state for a new paid run"
    assert state["baseUrl"].startswith("https://"), "Production acceptance requires valid HTTPS"
    report = {"phase": args.phase, "testedAt": datetime.now(timezone.utc).isoformat(),
              "baseUrl": state["baseUrl"], "result": "failed", "stage": "health"}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            health_context = browser.new_context()
            health = api(health_context, state["baseUrl"], "/health")
            assert health["storage"] == "mysql" and health["stubModel"] is False
            health_context.close()
            if args.phase == "run":
                run_checks(browser, args, state, report)
            elif args.phase == "verify":
                verify_checks(browser, args, state, report)
            else:
                cleanup_checks(browser, state, report)
            browser.close()
        report["result"] = "passed"
        report["stage"] = "complete"
    except Exception as error:
        report["errorType"] = type(error).__name__
        raise SystemExit(f"Acceptance failed during {report['stage']} ({report['errorType']}); no automatic paid retry.") from None
    finally:
        for key in ("projectId", "runId", "userIds"):
            if key in state:
                report[key] = state[key]
        public_write(args.artifacts / (args.phase + "-report.json"), report)
    print(f"Production acceptance {args.phase} passed; sanitized report saved.")


if __name__ == "__main__":
    main()
