"""Browser regression for single-use Turnstile tokens; no real provider or backend."""

import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOCK_WIDGET = """
(() => {
  const widgets = new Map();
  window.turnstileTest = { issued: 0, resets: 0, removed: 0 };
  function mount(widget) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '完成测试校验';
    button.onclick = () => {
      const token = 'synthetic-single-use-' + (++window.turnstileTest.issued);
      button.disabled = true;
      button.textContent = '已完成测试校验';
      widget.options.callback(token);
    };
    widget.element.replaceChildren(button);
  }
  window.turnstile = {
    render(element, options) {
      const id = String(widgets.size);
      const widget = { element, options };
      widgets.set(id, widget);
      mount(widget);
      return id;
    },
    reset(id) {
      const widget = widgets.get(id);
      if (!widget) throw new Error('Unknown test widget');
      window.turnstileTest.resets++;
      mount(widget);
    },
    remove(id) {
      widgets.delete(id);
      window.turnstileTest.removed++;
    }
  };
})();
"""


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="stars-turnstile-") as temp:
        config = Path(temp) / "vite.config.mjs"
        # Disable dotenv discovery: this regression needs no real configuration.
        config.write_text("export default " + json.dumps({"root": str(ROOT), "envDir": False}), encoding="utf-8")
        env = {key: value for key, value in os.environ.items() if key.upper() in {
            "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA",
        }}
        env["VITE_TURNSTILE_SITE_KEY"] = "synthetic-site-key"
        server = subprocess.Popen([
            "node", "node_modules/vite/bin/vite.js", "--config", str(config),
            "--host", "127.0.0.1", "--port", str(port), "--strictPort",
        ], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if server.poll() is not None:
                    raise RuntimeError("Isolated Vite server exited")
                try:
                    with urllib.request.urlopen(base, timeout=1):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError("Isolated Vite server did not start")
            check_browser(base)
        finally:
            server.terminate()
            server.wait(timeout=5)


def check_browser(base):
    requests, consumed, errors, external = [], set(), [], []
    session = {"user": None}

    def handle(route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname == "challenges.cloudflare.com":
            return route.fulfill(content_type="application/javascript", body=MOCK_WIDGET)
        if url.hostname != "127.0.0.1":
            external.append(request.url)
            return route.abort("blockedbyclient")
        if not url.path.startswith("/api/"):
            return route.continue_()
        payload, status = {}, 200
        if url.path == "/api/auth/logout" and request.method == "POST":
            session["user"] = None
            payload = {"ok": True}
        elif request.method == "POST" and url.path.startswith("/api/auth/"):
            body = request.post_data_json
            assert body["email"] == "turnstile@example.test"
            requests.append({"path": url.path, "token": body.get("turnstileToken")})
            token = body.get("turnstileToken")
            if not token or token in consumed:
                status, payload = 400, {"error": {"code": "TURNSTILE_FAILED", "message": "Synthetic single-use token rejected"}}
            else:
                consumed.add(token)
                if url.path.endswith("request-code"):
                    status, payload = 202, {"ok": True}
                elif url.path.endswith("verify"):
                    assert body["code"] == "123456"
                    assert body["password"] == "SyntheticPassword123"
                    session["user"] = {"id": "synthetic-user", "email": "turnstile@example.test"}
                    status, payload = 201, {"user": session["user"]}
                elif url.path.endswith("login"):
                    if body["password"] == "SyntheticPassword123":
                        session["user"] = {"id": "synthetic-user", "email": "turnstile@example.test"}
                        payload = {"user": session["user"]}
                    else:
                        status, payload = 401, {"error": {"code": "INVALID_CREDENTIALS", "message": "合成登录失败"}}
                else:
                    raise AssertionError("Unexpected auth endpoint")
        elif url.path == "/api/me":
            status, payload = (200, {"user": session["user"]}) if session["user"] else (401, {"error": {"code": "UNAUTHENTICATED"}})
        elif url.path == "/api/projects":
            payload = {"projects": []}
        elif url.path == "/api/folders":
            payload = {"folders": []}
        else:
            raise AssertionError("Unexpected API endpoint")
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route("**/*", handle)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.clock.install()
            page.goto(base, wait_until="networkidle")
            page.get_by_role("button", name="登录", exact=True).click()
            page.get_by_label("邮箱", exact=True).fill("turnstile@example.test")
            page.get_by_label("密码", exact=True).fill("IncorrectPassword123")
            challenge = page.get_by_role("button", name="完成测试校验", exact=True)
            challenge.click()
            page.get_by_role("dialog").get_by_role("button", name="登录", exact=True).click()
            expect(page.get_by_role("alert")).to_have_text("合成登录失败")
            expect(challenge).to_be_enabled()
            assert page.evaluate("turnstileTest.resets") == 1

            page.get_by_label("密码", exact=True).fill("SyntheticPassword123")
            page.get_by_role("dialog").get_by_role("button", name="登录", exact=True).click()
            expect(page.get_by_role("alert")).to_have_text("请先完成 Cloudflare 人机校验")
            assert len(requests) == 1, "Failed login token was reused on retry"
            challenge.click()
            page.get_by_role("dialog").get_by_role("button", name="登录", exact=True).click()
            expect(page.get_by_role("dialog")).to_have_count(0)
            expect(page.locator(".sidebar")).to_be_visible()
            assert page.evaluate("turnstileTest.resets") == 2
            page.locator(".top-avatar").click()
            expect(page.locator(".public-shell")).to_be_visible()
            page.get_by_role("button", name="登录", exact=True).click()

            page.get_by_role("button", name="还没有账号？注册", exact=True).click()
            challenge.click()
            page.get_by_role("button", name="发送验证码", exact=True).click()
            expect(page.get_by_label("邮箱验证码", exact=True)).to_be_visible()
            expect(challenge).to_be_enabled()
            assert page.evaluate("turnstileTest.resets") == 3
            page.get_by_label("邮箱验证码", exact=True).fill("123456")
            page.get_by_label("密码", exact=True).fill("SyntheticPassword123")
            page.get_by_role("button", name="验证并注册", exact=True).click()
            expect(page.get_by_role("alert")).to_have_text("请先完成 Cloudflare 人机校验")
            assert len(requests) == 3, "Consumed token was reused for registration"

            page.clock.run_for(61_000)
            resend = page.get_by_role("button", name="重新发送", exact=True)
            expect(resend).to_be_enabled()
            resend.click()
            assert len(requests) == 3, "Resend omitted a fresh challenge"
            challenge.click()
            resend.click()
            expect(challenge).to_be_enabled()
            assert page.evaluate("turnstileTest.resets") == 4
            challenge.click()
            page.get_by_role("button", name="验证并注册", exact=True).click()
            expect(page.get_by_role("dialog")).to_have_count(0)
            expect(page.locator(".sidebar")).to_be_visible()
            assert page.evaluate("turnstileTest.resets") == 5
            assert [item["path"] for item in requests] == [
                "/api/auth/login", "/api/auth/login", "/api/auth/register/request-code",
                "/api/auth/register/request-code", "/api/auth/register/verify",
            ]
            assert len(consumed) == len(requests) == 5
            assert not errors, errors
            assert not external, "Unexpected external network request"
        finally:
            browser.close()
    print("Turnstile regression passed: login retry and registration succeed with fresh single-use tokens; no real provider calls")


if __name__ == "__main__":
    main()
