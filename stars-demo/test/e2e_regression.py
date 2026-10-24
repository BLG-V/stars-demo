import json
import os
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def ready(url, expected_status):
    for _ in range(80):
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == expected_status:
                    return True
        except urllib.error.HTTPError as error:
            if error.code == expected_status:
                return True
        except (OSError, TimeoutError):
            time.sleep(.25)
    return False


def attachment_regression(page, data_dir, capture_dir):
    add = page.get_by_role("button", name="添加", exact=True)
    menu = page.get_by_role("menu", name="添加参考内容", exact=True)
    upload_file = menu.get_by_role("menuitem", name="上传文件", exact=True)
    upload_folder = menu.get_by_role("menuitem", name="上传文件夹", exact=True)
    attachment_input = page.locator("input[type='file'][aria-label='添加文本附件']")
    folder_input = page.locator("input[type='file'][aria-label='上传文本文件夹']")
    removals = page.get_by_role("button", name=re.compile(r"^移除附件 "))

    add.click()
    expect(menu).to_be_visible()
    expect(upload_file).to_be_focused()
    upload_file.press("ArrowDown")
    expect(upload_folder).to_be_focused()
    upload_folder.press("ArrowUp")
    expect(upload_file).to_be_focused()
    upload_file.press("End")
    expect(upload_folder).to_be_focused()
    upload_folder.press("Home")
    expect(upload_file).to_be_focused()
    upload_file.press("Escape")
    expect(menu).not_to_be_visible()
    expect(add).to_be_focused()
    add.click()
    upload_file.press("Tab")
    expect(menu).not_to_be_visible()
    add.click()
    page.get_by_label("描述你的应用").click()
    expect(menu).not_to_be_visible()

    for width in (375, 768, 1280):
        page.set_viewport_size({"width": width, "height": 900})
        add.click()
        expect(menu).to_be_visible()
        page.screenshot(path=str(capture_dir / f"attachments-menu-{width}.png"), full_page=False)
        assert menu.evaluate("""el => {
            const box = el.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
              [...el.querySelectorAll('[role=menuitem]')].every(item => {
                const rect = item.getBoundingClientRect();
                return item.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
              });
        }"""), f"Attachment menu clipped at {width}px: {menu.bounding_box()}"
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1280, "height": 900})

    add.click()
    with page.expect_file_chooser() as file_picker:
        upload_file.click()
    assert file_picker.value.is_multiple
    file_picker.value.set_files({"name": "payload.exe", "mimeType": "application/octet-stream", "buffer": b"not text"})
    page.get_by_role("status").filter(has_text="不支持的文件类型").wait_for(state="visible")
    expect(removals).to_have_count(0)
    expect(menu).not_to_be_visible()
    attachment_input.set_input_files({"name": "large.txt", "mimeType": "text/plain", "buffer": b"x" * (32 * 1024 + 1)})
    page.get_by_role("status").filter(has_text="单个文件超过 32 KiB").wait_for(state="visible")
    expect(removals).to_have_count(0)
    attachment_input.set_input_files({"name": "binary.txt", "mimeType": "text/plain", "buffer": b"before\x00after"})
    page.get_by_role("status").filter(has_text="不是有效文本").wait_for(state="visible")
    expect(removals).to_have_count(0)
    page.get_by_label("描述你的应用").fill("x" * 3995)
    attachment_input.set_input_files({"name": "too-long.txt", "mimeType": "text/plain", "buffer": b"context"})
    page.get_by_role("status").filter(has_text="合并需求超过 4,000 字符").wait_for(state="visible")
    expect(page.get_by_text("too-long.txt", exact=True)).to_have_count(0)
    page.get_by_label("描述你的应用").fill("")

    limit_files = [{"name": f"limit-{index}.txt", "mimeType": "text/plain", "buffer": b"small context"} for index in range(10)]
    attachment_input.set_input_files(limit_files)
    expect(removals).to_have_count(10)
    attachment_input.set_input_files({"name": "eleventh.txt", "mimeType": "text/plain", "buffer": b"not accepted"})
    page.get_by_role("status").filter(has_text="最多 10 个文本附件").wait_for(state="visible")
    expect(page.get_by_text("eleventh.txt", exact=True)).to_have_count(0)
    while removals.count():
        removals.first.click()

    attachment_input.set_input_files([
        {"name": "design.txt", "mimeType": "text/plain", "buffer": b"Design notes."},
        {"name": "data.json", "mimeType": "application/json", "buffer": b"{}"},
        {"name": "mixed.bin", "mimeType": "application/octet-stream", "buffer": b"unsupported"},
    ])
    page.get_by_role("status").filter(has_text="不支持的文件类型").wait_for(state="visible")
    expect(removals).to_have_count(2)
    page.get_by_text("design.txt", exact=True).wait_for(state="visible")
    page.get_by_text("data.json", exact=True).wait_for(state="visible")
    expect(page.get_by_text("mixed.bin", exact=True)).to_have_count(0)
    while removals.count():
        removals.first.click()

    notes = {"name": "notes.md", "mimeType": "text/markdown", "buffer": b"Use a warm cream background and a clear primary action."}
    attachment_input.set_input_files(notes)
    page.get_by_text("notes.md", exact=True).wait_for(state="visible")
    attachment_input.set_input_files(notes)
    page.get_by_role("status").filter(has_text="重复路径与内容").wait_for(state="visible")
    expect(removals).to_have_count(1)

    fixture = Path(data_dir) / "attachment-fixture"
    fixture_files = {
        "README.md": "Folder context: build an accessible project workspace.",
        "nested/src/brief.txt": "Nested directory acceptance text.",
        ".env.txt": "EXCLUDED_SYNTHETIC_HIDDEN_FILE",
        ".hidden/note.md": "EXCLUDED_SYNTHETIC_HIDDEN_PATH",
        "package-lock.json": "EXCLUDED_SYNTHETIC_LOCK_FILE",
        "yarn.lock": "EXCLUDED_SYNTHETIC_LOCK_FILE",
        "pnpm-lock.yaml": "EXCLUDED_SYNTHETIC_LOCK_FILE",
        "unsupported.bin": "EXCLUDED_SYNTHETIC_UNSUPPORTED_FILE",
    }
    for ignored in ("node_modules", "dist", "build", "coverage", "__pycache__", "target", "vendor"):
        fixture_files[f"{ignored}/ignored.txt"] = "EXCLUDED_SYNTHETIC_DIRECTORY"
    for relative, content in fixture_files.items():
        target = fixture / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    assert folder_input.get_attribute("webkitdirectory") is not None
    add.click()
    with page.expect_file_chooser() as folder_picker:
        upload_folder.click()
    folder_picker.value.set_files(str(fixture))
    expect(menu).not_to_be_visible()
    expected_paths = ["attachment-fixture/README.md", "attachment-fixture/nested/src/brief.txt"]
    for relative in expected_paths:
        page.get_by_text(relative, exact=True).wait_for(state="visible")
    expect(removals).to_have_count(3)
    assert all("EXCLUDED_SYNTHETIC" not in text for text in page.locator(".attachment-list").all_text_contents())
    for relative in fixture_files:
        if relative not in ("README.md", "nested/src/brief.txt"):
            expect(page.get_by_text("attachment-fixture/" + relative, exact=True)).to_have_count(0)
    folder_input.set_input_files(str(fixture))
    page.get_by_role("status").filter(has_text="重复路径与内容").wait_for(state="visible")
    expect(removals).to_have_count(3)
    page.get_by_role("button", name="移除附件 " + expected_paths[1], exact=True).click()
    expect(page.get_by_text(expected_paths[1], exact=True)).to_have_count(0)
    folder_input.set_input_files(str(fixture))
    page.get_by_text(expected_paths[1], exact=True).wait_for(state="visible")
    expect(removals).to_have_count(3)
    for width in (375, 768, 1280):
        page.set_viewport_size({"width": width, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(capture_dir / "attachments-selected-desktop.png"), full_page=False)
    page.get_by_label("描述你的应用").fill("x" * 3999)
    expect(page.get_by_role("button", name="开始构建", exact=True)).to_be_disabled()
    page.get_by_label("描述你的应用").fill("")
    return expected_paths


def main():
    api_port, web_port = free_port(), free_port()
    with tempfile.TemporaryDirectory(prefix="stars-e2e-") as data_dir:
        env = os.environ.copy()
        env.update({
            "ALLOW_STUB_MODEL": "true",
            "MODEL_API_KEY": "",
            "MODEL_BASE_URL": "",
            "MODEL_NAME": "",
            "PORT": str(api_port),
            "STARS_STORAGE": "json",
            "STARS_DATA_FILE": str(Path(data_dir) / "stars.json"),
            "SMTP_CAPTURE_FILE": str(Path(data_dir) / "mail.txt"),
            "SMTP_HOST": "capture",
            "SMTP_FROM": "Stars <stars@example.test>",
            "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}",
        })
        api = subprocess.Popen(["node", "server/index.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        web = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(web_port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            if not ready(f"http://127.0.0.1:{api_port}/api/me", 401) or not ready(f"http://127.0.0.1:{web_port}/", 200):
                raise RuntimeError("Isolated E2E servers did not start")

            errors = []
            stamp = str(int(time.time()))
            email = f"stars-e2e-{stamp}@example.com"
            password = "StarsE2E!12345"
            base_url = f"http://127.0.0.1:{web_port}"

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" and "status of 401" not in message.text else None)
                page.goto(base_url, wait_until="networkidle")
                assert page.locator(".public-chrome").is_visible()
                assert page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(245, 246, 248)"
                assert page.locator(".prompt-card").evaluate("el => getComputedStyle(el).borderRadius") == "24px"
                assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

                for width in (375, 768):
                    responsive = browser.new_page(viewport={"width": width, "height": 900})
                    responsive.goto(base_url, wait_until="networkidle")
                    assert responsive.locator(".public-chrome").is_visible()
                    assert responsive.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
                    responsive.close()

                page.get_by_role("button", name="登录").click()
                page.get_by_role("button", name="还没有账号？注册").click()
                page.get_by_label("邮箱").fill(email)
                page.get_by_role("button", name="发送验证码").click()
                page.get_by_label("邮箱验证码").wait_for(state="visible", timeout=5000)
                code = ""
                mail_capture = Path(data_dir) / "mail.txt"
                for _ in range(40):
                    if mail_capture.exists():
                        match = re.search(r"font-size:24px[^>]*>(\d{6})<", mail_capture.read_text(encoding="utf-8"))
                        if match:
                            code = match.group(1)
                            break
                    time.sleep(.05)
                assert re.fullmatch(r"\d{6}", code)
                page.get_by_label("邮箱验证码").fill(code)
                page.get_by_label("密码").fill(password)
                page.get_by_role("button", name="验证并注册").click()
                page.wait_for_selector("dialog", state="detached")
                expect(page.locator("body")).to_have_css("background-color", "rgb(245, 246, 248)")
                expect(page.locator(".workflow-panel")).not_to_be_visible()
                capture_dir = ROOT / "test-results"
                capture_dir.mkdir(exist_ok=True)
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(capture_dir / "attachments-workbench-cold-start.png"), full_page=False)
                account_card = page.get_by_role("button", name=re.compile(r"个人账户"))
                assert account_card.is_visible()
                account_card.click()
                account_menu = page.get_by_role("menu", name="个人账户菜单")
                assert account_menu.is_visible()
                assert account_menu.get_by_role("menuitem", name="退出登录").is_visible()
                account_card.click()
                assert not account_menu.is_visible()
                assert page.get_by_role("button", name="语音输入", exact=True).is_enabled()
                page.evaluate("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")
                page.get_by_role("button", name="语音输入", exact=True).click()
                assert page.get_by_role("status").filter(has_text="当前浏览器不支持语音输入").is_visible()
                page.evaluate("""() => {
                    window.SpeechRecognition = class {
                        start() { window.__starsSpeechRecognition = this; }
                        stop() { this.onend?.(); }
                    };
                }""")
                page.get_by_role("button", name="语音输入", exact=True).click()
                assert page.get_by_role("button", name="停止语音输入", exact=True).get_attribute("aria-pressed") == "true"
                page.evaluate("window.__starsSpeechRecognition.onerror({error: 'not-allowed'})")
                page.get_by_role("status").filter(has_text="麦克风权限被拒绝").wait_for(state="visible")
                page.evaluate("""() => {
                    window.SpeechRecognition = class {
                        start() { window.__starsSpeechRecognition = this; }
                        stop() { this.onend?.(); }
                    };
                }""")
                page.get_by_label("描述你的应用").fill("已有需求")
                page.get_by_role("button", name="语音输入", exact=True).click()
                page.evaluate("window.__starsSpeechRecognition.onresult({resultIndex: 0, results: [[{transcript: '语音识别内容'}]]})")
                expect(page.get_by_label("描述你的应用")).to_have_value("已有需求 语音识别内容")
                page.get_by_role("button", name="停止语音输入", exact=True).click()
                assert page.get_by_role("button", name="语音输入", exact=True).get_attribute("aria-pressed") == "false"

                attachment_paths = attachment_regression(page, data_dir, capture_dir)
                assert page.locator(".file-row").count() == 0
                assert "1,200" not in page.locator("body").inner_text()
                page.get_by_label("描述你的应用").fill("生成一个 Stars 介绍页，按钮点击后切换欢迎语。")
                with page.expect_request(lambda request: request.method == "POST" and request.url.endswith("/plans")) as planning_request:
                    page.get_by_role("button", name="开始构建").click()
                try:
                    page.get_by_role("heading", name="确认生成计划").wait_for(timeout=10000)
                except Exception:
                    print(page.locator(".api-error").all_text_contents())
                    raise
                assert "Use a warm cream background and a clear primary action." in page.locator(".plan-prompt").inner_text()
                for relative in attachment_paths:
                    assert relative in planning_request.value.post_data_json["prompt"]
                assert "Nested directory acceptance text." in planning_request.value.post_data_json["prompt"]
                assert "EXCLUDED_SYNTHETIC" not in planning_request.value.post_data_json["prompt"]
                assert len(planning_request.value.post_data_json["prompt"]) <= 4000
                project_id = page.evaluate("new URLSearchParams(location.search).get('projectId')")
                persisted = page.request.get(f"{base_url}/api/projects/{project_id}/messages")
                assert persisted.ok
                assert any(message["role"] == "user" and message["content"] == planning_request.value.post_data_json["prompt"] for message in persisted.json()["messages"])
                expect(page.locator(".workflow-panel")).to_be_visible()
                expect(page.locator(".workflow-step.current")).to_have_css("background-color", "rgb(68, 103, 245)")
                assert page.locator("iframe").count() == 0
                assert page.locator(".file-row").count() == 0
                page.get_by_role("button", name="确认计划并生成").click()
                page.get_by_role("heading", name="检查文件变更").wait_for(timeout=15000)
                assert page.locator(".diff-line.added").count() > 0
                assert page.locator("iframe").count() == 0
                page.locator(".approval-panel").screenshot(path=str(capture_dir / "file-review-desktop.png"))
                # Pending candidates survive a reload without becoming committed files.
                page.reload(wait_until="networkidle")
                page.get_by_role("heading", name="检查文件变更").wait_for()
                page.get_by_role("button", name="确认应用变更").click()
                page.get_by_role("heading", name="开发模式构建完成").wait_for()
                assert page.locator(".segment-progress .filled").count() == 4

                frame = page.frame_locator("iframe[title='生成应用预览']")
                button = frame.locator("#greeting")
                assert button.is_visible()
                button.click()
                assert frame.get_by_role("heading", name="让想法闪耀成真。", exact=True).is_visible()

                page.get_by_role("button", name="移动预览").click()
                assert page.locator(".preview-tools .selected").count() >= 1
                page.get_by_role("button", name="控制台").click()
                assert page.get_by_text("尚未收到预览运行错误。").is_visible()
                preview_frame = page.frame_locator("iframe[title='生成应用预览']")
                preview_frame.locator("body").evaluate("el => window.dispatchEvent(new ErrorEvent('error', {message: 'preview-regression'}))")
                page.get_by_text("预览发生错误", exact=True).wait_for()
                assert page.get_by_role("button", name="修复并重新生成").is_visible()
                page.get_by_role("button", name="重新加载预览").click()
                page.get_by_text("预览发生错误", exact=True).wait_for(state="detached")

                page.get_by_role("button", name="保存版本", exact=True).click()
                page.get_by_role("button", name="查看差异", exact=True).first.wait_for()
                page.get_by_role("button", name="编辑文件", exact=True).click()
                editor = page.get_by_label("编辑 index.html", exact=True)
                original_html = editor.input_value()
                editor.fill(original_html.replace("你好，欢迎来到 Stars！", "浏览器回归修改"))
                page.get_by_role("button", name="保存文件", exact=True).click()
                page.get_by_text("文件已保存。", exact=True).wait_for()
                page.get_by_role("button", name="查看差异", exact=True).first.click()
                assert page.get_by_role("dialog").locator(".diff-line.added").count() > 0
                page.set_viewport_size({"width": 375, "height": 900})
                page.get_by_role("dialog").screenshot(path=str(capture_dir / "snapshot-diff-mobile.png"))
                assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
                page.set_viewport_size({"width": 1280, "height": 900})
                page.get_by_role("button", name="关闭差异", exact=True).click()

                # Rejecting a generation must keep the user's saved changes.
                page.get_by_label("描述你的应用").fill("重新生成这个应用")
                page.get_by_role("button", name="开始构建", exact=True).click()
                page.get_by_role("button", name="确认计划并生成", exact=True).click()
                page.get_by_role("heading", name="检查文件变更").wait_for()
                assert page.locator(".code-preview").inner_text().find("浏览器回归修改") >= 0
                page.get_by_role("button", name="放弃本次生成", exact=True).click()
                page.get_by_text("已放弃本次生成，原文件保持不变。", exact=True).wait_for()
                assert page.locator(".code-preview").inner_text().find("浏览器回归修改") >= 0
                page.get_by_role("button", name="恢复", exact=True).first.click()
                page.get_by_role("button", name="确认恢复", exact=True).click()
                page.get_by_text("版本已恢复，恢复前文件已自动备份。", exact=True).wait_for()
                assert "浏览器回归修改" not in page.locator(".code-preview").inner_text()
                page.get_by_role("tab", name="我的项目", exact=True).click()
                page.get_by_role("button", name="重命名", exact=False).first.click()
                page.get_by_label("项目名称", exact=True).fill("Stars 回归项目")
                page.get_by_role("button", name="保存名称", exact=True).click()
                page.get_by_text("项目已重命名。", exact=True).wait_for()
                original_project_url = page.url
                original_project_id = page.evaluate("new URLSearchParams(location.search).get('projectId')")
                page.get_by_role("button", name="创建文件夹", exact=True).click()
                folder_dialog = page.get_by_role("dialog", name="新建文件夹")
                folder_dialog.get_by_label("文件夹名称").fill("回归归档")
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(ROOT / "test-results" / "folder-dialog-desktop.png"), full_page=False)
                folder_dialog.get_by_role("button", name="创建文件夹", exact=True).click()
                page.get_by_role("dialog", name="新建文件夹").wait_for(state="detached")
                assert page.get_by_role("heading", name="回归归档", exact=True).is_visible()
                page.get_by_role("link", name="我的项目", exact=True).click()
                project_folder = page.get_by_label("移动 Stars 回归项目 到文件夹", exact=True)
                project_folder.select_option(label="回归归档")
                page.get_by_text("项目已移入文件夹。", exact=True).wait_for()
                folder_id = project_folder.input_value()
                page.reload(wait_until="networkidle")
                archive_folder = page.locator(".folder-item").filter(has_text="回归归档")
                archive_folder.click()
                assert archive_folder.get_attribute("aria-pressed") == "true"
                assert page.get_by_role("heading", name="回归归档", exact=True).is_visible()
                assert page.locator(".project-row").count() == 1
                assert page.get_by_label("移动 Stars 回归项目 到文件夹", exact=True).input_value() == folder_id
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(ROOT / "test-results" / "logged-in-desktop.png"), full_page=False)
                page.get_by_role("button", name="创建文件夹", exact=True).click()
                empty_folder_dialog = page.get_by_role("dialog", name="新建文件夹")
                empty_folder_dialog.get_by_label("文件夹名称").fill("空文件夹回归")
                with page.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/api/folders")) as empty_folder_created:
                    empty_folder_dialog.get_by_role("button", name="创建文件夹", exact=True).click()
                empty_folder_id = empty_folder_created.value.json()["folder"]["id"]
                empty_folder_dialog.wait_for(state="detached")
                page.locator(".folder-item").filter(has_text="全部项目").click()
                assert page.locator(".project-row").count() == 1
                page.locator(".folder-item").filter(has_text="空文件夹回归").click()
                assert page.get_by_role("heading", name="空文件夹回归", exact=True).is_visible()
                assert page.get_by_role("heading", name="这个文件夹还没有项目", exact=True).is_visible()
                assert page.locator(".project-row").count() == 0
                # Explicit new-project actions must clear the current project and preserve the selected folder.
                for folder_name, action_name, expected_folder_id in (("回归归档", "新建项目", folder_id), ("空文件夹回归", "创建项目", empty_folder_id)):
                    page.locator(".folder-item").filter(has_text=folder_name).click()
                    page.get_by_role("button", name=action_name, exact=True).click()
                    assert page.locator(".file-row").count() == 0
                    page.get_by_label("描述你的应用").fill(f"{folder_name}中的独立项目")
                    with page.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/api/projects")) as new_project_created:
                        page.get_by_role("button", name="开始构建", exact=True).click()
                    new_project = new_project_created.value.json()["project"]
                    assert new_project["id"] != original_project_id
                    assert new_project["folderId"] == expected_folder_id
                    page.get_by_role("heading", name="确认生成计划", exact=True).wait_for()
                    page.get_by_role("button", name="取消计划", exact=True).click()
                    assert page.request.delete(f"{base_url}/api/projects/{new_project['id']}").ok
                    page.goto(original_project_url, wait_until="networkidle")
                    page.get_by_role("heading", name="开发模式构建完成", exact=True).wait_for()
                page.locator(".folder-item").filter(has_text="空文件夹回归").click()
                page.get_by_role("button", name="管理文件夹 空文件夹回归", exact=True).click()
                page.get_by_role("menuitem", name="删除", exact=True).click()
                page.get_by_role("dialog", name="删除文件夹").get_by_role("button", name="确认删除", exact=True).click()
                page.get_by_role("dialog", name="删除文件夹").wait_for(state="detached")
                archive_folder.click()
                page.get_by_role("button", name=re.compile(r"管理文件夹 回归归档")).click()
                page.get_by_role("menuitem", name="重命名", exact=True).click()
                folder_edit = page.get_by_role("dialog", name="重命名文件夹")
                folder_edit.get_by_label("文件夹名称").fill("归档完成")
                folder_edit.get_by_role("button", name="保存名称", exact=True).click()
                page.get_by_text("文件夹已重命名。", exact=True).wait_for()
                page.get_by_role("button", name=re.compile(r"管理文件夹 归档完成")).click()
                page.get_by_role("menuitem", name="删除", exact=True).click()
                folder_delete = page.get_by_role("dialog", name="删除文件夹")
                folder_delete.get_by_role("button", name="确认删除", exact=True).click()
                page.get_by_text("文件夹已删除，项目已移入未分类。", exact=True).wait_for()
                assert page.get_by_label("移动 Stars 回归项目 到文件夹", exact=True).input_value() == ""
                page.get_by_role("link", name="最近项目", exact=True).click()
                assert page.get_by_role("heading", name="最近项目", exact=True).is_visible()
                assert page.get_by_role("button", name=re.compile(r"Stars 回归项目.*刚刚|Stars 回归项目.*2026"), exact=False).first.is_visible()
                page.reload(wait_until="networkidle")
                page.wait_for_selector("text=开发模式构建完成", timeout=10000)
                assert page.locator(".file-row").count() >= 3
                assert page.locator(".message-history article").count() >= 2
                assert page.locator(".run-history details").count() >= 2
                page.locator(".run-history details").first.locator("summary").click()
                assert page.locator(".run-history .event-log li").count() >= 4
                for width in (375, 768):
                    page.set_viewport_size({"width": width, "height": 900})
                    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
                    if width == 375:
                        assert page.get_by_role("button", name="创建文件夹", exact=True).is_visible()
                        page.get_by_role("button", name="创建文件夹", exact=True).click()
                        mobile_folder_dialog = page.get_by_role("dialog", name="新建文件夹")
                        mobile_folder_dialog.get_by_label("文件夹名称").fill("移动端回归")
                        mobile_folder_dialog.get_by_role("button", name="创建文件夹", exact=True).click()
                        mobile_folder_dialog.wait_for(state="detached")
                        assert page.get_by_role("heading", name="移动端回归", exact=True).is_visible()
                        mobile_account = page.get_by_role("button", name=re.compile(r"个人账户"))
                        assert mobile_account.is_visible()
                        mobile_account.click()
                        assert page.get_by_role("menu", name="个人账户菜单").is_visible()
                        mobile_account.click()
                        page.evaluate("window.scrollTo(0, 0)")
                        page.screenshot(path=str(ROOT / "test-results" / "logged-in-mobile.png"), full_page=False)
                        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
                        page.get_by_role("button", name="管理文件夹 移动端回归", exact=True).click()
                        page.get_by_role("menuitem", name="删除", exact=True).click()
                        page.get_by_role("dialog", name="删除文件夹").get_by_role("button", name="确认删除", exact=True).click()
                        page.get_by_role("dialog", name="删除文件夹").wait_for(state="detached")
                page.set_viewport_size({"width": 1280, "height": 900})
                # Recent is capped at eight; the sidebar's all-projects action must remove that cap.
                extra_project_ids = []
                for index in range(9):
                    response = page.request.post(f"{base_url}/api/projects", data={"name": f"最近项目回归 {index}"})
                    assert response.status == 201
                    extra_project_ids.append(response.json()["project"]["id"])
                page.reload(wait_until="networkidle")
                page.get_by_role("link", name="最近项目", exact=True).click()
                assert page.get_by_role("heading", name="最近项目", exact=True).is_visible()
                assert page.locator(".project-row").count() == 8
                page.locator(".folder-item").filter(has_text="全部项目").click()
                assert page.get_by_role("heading", name="我的项目", exact=True).is_visible()
                assert page.locator(".project-row").count() == 10
                for project_id in extra_project_ids:
                    assert page.request.delete(f"{base_url}/api/projects/{project_id}").ok
                page.reload(wait_until="networkidle")
                page.get_by_role("tab", name="我的项目", exact=True).click()
                page.get_by_role("button", name="删除 Stars 回归项目", exact=True).click()
                assert page.get_by_role("dialog", name="删除项目").is_visible()
                page.get_by_role("button", name="取消", exact=True).click()
                assert page.locator(".project-row").count() == 1
                page.get_by_role("button", name="删除 Stars 回归项目", exact=True).click()
                page.get_by_role("button", name="确认删除", exact=True).click()
                page.get_by_text("项目已删除。", exact=True).wait_for()
                assert page.locator(".file-row").count() == 0
                assert page.locator(".project-row").count() == 0
                page.get_by_role("button", name=re.compile(r"个人账户")).click()
                page.get_by_role("menuitem", name="退出登录").click()
                page.locator(".public-nav-login").wait_for(state="visible")
                assert not errors, errors
                browser.close()
        finally:
            web.terminate()
            api.terminate()
            web.wait(timeout=5)
            api.wait(timeout=5)


def running_refresh_regression():
    provider_started = threading.Event()
    release_provider = threading.Event()
    provider_calls = []
    files = [
        {"path": "index.html", "content": '<main><h1>Stars refresh test</h1><button id="resume-action">Change heading</button></main>'},
        {"path": "app.js", "content": "const original=1; const report=()=>{}; document.querySelector('#resume-action').onclick=()=>{document.querySelector('h1').textContent='Recovered run is interactive'};"},
    ]

    class DelayedProvider(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            provider_calls.append(self.path)
            provider_started.set()
            release_provider.wait(timeout=20)
            body = json.dumps({"choices": [{"message": {"content": json.dumps({"files": files})}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    provider = ThreadingHTTPServer(("127.0.0.1", 0), DelayedProvider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    api_port, web_port = free_port(), free_port()
    with tempfile.TemporaryDirectory(prefix="stars-refresh-e2e-") as data_dir:
        env = os.environ.copy()
        env.update({
            "ALLOW_STUB_MODEL": "false",
            "MODEL_API_KEY": "e2e-local-provider-only",
            "MODEL_BASE_URL": f"http://127.0.0.1:{provider.server_port}/v1",
            "MODEL_NAME": "delayed-browser-test",
            "PORT": str(api_port),
            "STARS_STORAGE": "json",
            "STARS_DATA_FILE": str(Path(data_dir) / "stars.json"),
            "SMTP_HOST": "capture",
            "SMTP_FROM": "Stars <stars@example.test>",
            "SMTP_CAPTURE_FILE": str(Path(data_dir) / "mail.txt"),
            "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}",
        })
        api = subprocess.Popen(["node", "server/index.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        web = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(web_port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            if not ready(f"http://127.0.0.1:{api_port}/api/me", 401) or not ready(f"http://127.0.0.1:{web_port}/", 200):
                raise RuntimeError("Running-refresh E2E servers did not start")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page()
                errors, streams = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: streams.append(request.post_data_json) if request.method == "POST" and request.url.endswith("/runs") else None)
                page.goto(f"http://127.0.0.1:{web_port}", wait_until="networkidle")
                page.get_by_role("button", name="登录", exact=True).click()
                page.get_by_role("button", name="还没有账号？注册", exact=True).click()
                page.get_by_label("邮箱").fill(f"stars-refresh-{time.time_ns()}@example.com")
                page.get_by_role("button", name="发送验证码", exact=True).click()
                page.get_by_label("邮箱验证码").wait_for(state="visible", timeout=5000)
                mail_capture = Path(data_dir) / "mail.txt"
                code = ""
                for _ in range(40):
                    if mail_capture.exists():
                        match = re.search(r"font-size:24px[^>]*>(\d{6})<", mail_capture.read_text(encoding="utf-8"))
                        if match:
                            code = match.group(1)
                            break
                    time.sleep(.05)
                assert re.fullmatch(r"\d{6}", code)
                page.get_by_label("邮箱验证码").fill(code)
                page.get_by_label("密码").fill("StarsRefresh!12345")
                page.get_by_role("button", name="验证并注册", exact=True).click()
                page.wait_for_selector("dialog", state="detached")
                page.get_by_label("描述你的应用").fill("Create an interactive Stars page")
                page.get_by_role("button", name="开始构建", exact=True).click()
                page.get_by_role("button", name="确认计划并生成", exact=True).click()
                assert provider_started.wait(timeout=5), "Generation did not reach the delayed provider"
                # Refresh while the provider is blocked; resume starts after saved event IDs.
                with page.expect_request(lambda request: request.method == "POST" and request.url.endswith("/runs") and bool(request.headers.get("last-event-id"))) as replay:
                    page.reload(wait_until="networkidle")
                assert int(replay.value.headers["last-event-id"]) >= 3
                assert page.get_by_label("描述你的应用").is_disabled()
                assert page.get_by_role("button", name="处理中…").is_disabled()
                assert page.locator(".file-row").count() == 0
                assert len(provider_calls) == 1
                release_provider.set()
                page.get_by_role("heading", name="检查文件变更").wait_for(timeout=15000)
                assert len(provider_calls) == 1, "Refresh invoked the model again"
                assert len(streams) >= 2 and len({item["planId"] for item in streams}) == 1
                page.get_by_role("button", name="确认应用变更", exact=True).click()
                frame = page.frame_locator("iframe[title='生成应用预览']")
                frame.locator("#resume-action").click()
                assert frame.get_by_role("heading", name="Recovered run is interactive", exact=True).is_visible()
                assert page.locator(".run-history details").count() == 1
                assert not errors, errors
                browser.close()
        finally:
            release_provider.set()
            web.terminate()
            api.terminate()
            web.wait(timeout=5)
            api.wait(timeout=5)
            provider.shutdown()
            provider.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
    running_refresh_regression()
    print("e2e regression passed")
