import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


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
                assert page.locator(".workflow-panel").is_visible()
                assert page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(5, 5, 5)"
                assert page.locator(".workflow-step.current").evaluate("el => getComputedStyle(el).backgroundColor") == "rgb(204, 255, 0)"
                assert page.locator(".prompt-card").evaluate("el => getComputedStyle(el).borderRadius") == "0px"
                assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

                for width in (375, 768):
                    responsive = browser.new_page(viewport={"width": width, "height": 900})
                    responsive.goto(base_url, wait_until="networkidle")
                    assert responsive.locator(".workflow-panel").is_visible()
                    assert responsive.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
                    responsive.close()

                page.get_by_role("button", name="登录").click()
                page.get_by_role("button", name="还没有账号？注册").click()
                page.get_by_label("邮箱").fill(email)
                page.get_by_label("密码").fill(password)
                page.get_by_role("button", name="注册").click()
                page.wait_for_selector("dialog", state="detached")
                assert page.get_by_role("button", name="语音输入（暂不可用）").is_disabled()
                assert page.locator(".file-row").count() == 0
                assert "1,200" not in page.locator("body").inner_text()
                page.get_by_label("描述你的应用").fill("生成一个 Stars 介绍页，按钮点击后切换欢迎语。")
                page.get_by_role("button", name="开始构建").click()
                try:
                    page.get_by_role("heading", name="确认生成计划").wait_for(timeout=10000)
                except Exception:
                    print(page.locator(".api-error").all_text_contents())
                    raise
                assert page.locator("iframe").count() == 0
                assert page.locator(".file-row").count() == 0
                page.get_by_role("button", name="确认计划并生成").click()
                page.get_by_role("heading", name="检查文件变更").wait_for(timeout=15000)
                assert page.locator(".diff-line.added").count() > 0
                assert page.locator("iframe").count() == 0
                capture_dir = ROOT / "test-results"
                capture_dir.mkdir(exist_ok=True)
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
                page.set_viewport_size({"width": 1280, "height": 900})
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
                page.get_by_label("密码").fill("StarsRefresh!12345")
                page.get_by_role("button", name="注册", exact=True).click()
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
