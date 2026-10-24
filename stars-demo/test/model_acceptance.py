import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def ready(url, expected_status):
    for _ in range(120):
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
    base_url = os.environ.get("MODEL_BASE_URL")
    api_key = os.environ.get("MODEL_API_KEY")
    model_name = os.environ.get("MODEL_NAME")
    cap_value = os.environ.get("STARS_MODEL_ACCEPTANCE_MAX_REQUESTS")
    if not base_url or not api_key or not model_name:
        raise SystemExit("Set MODEL_BASE_URL, MODEL_API_KEY, and MODEL_NAME in this process before running acceptance.")
    try:
        request_cap = int(cap_value or "")
    except ValueError:
        raise SystemExit("Set STARS_MODEL_ACCEPTANCE_MAX_REQUESTS explicitly to 1 or 2.")
    if request_cap not in (1, 2):
        raise SystemExit("The explicit model request cap must be 1 or 2.")

    api_port = free_port()
    web_port = free_port()
    while web_port == api_port:
        web_port = free_port()
    temp_data = tempfile.TemporaryDirectory(prefix="stars-model-data-")
    env = os.environ.copy()
    env.update({
        "MODEL_BASE_URL": base_url,
        "MODEL_API_KEY": api_key,
        "MODEL_NAME": model_name,
        "ALLOW_STUB_MODEL": "false",
        "PORT": str(api_port),
        "STARS_STORAGE": "json",
        "STARS_DATA_FILE": str(Path(temp_data.name) / "stars.json"),
        "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{api_port}",
    })
    api = subprocess.Popen(["node", "server/index.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    web = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(web_port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    artifact_dir = Path(os.environ.get("STARS_ACCEPTANCE_ARTIFACT_DIR", ROOT / "test-artifacts" / "model-acceptance"))
    screenshot_path = Path(os.environ.get("STARS_ACCEPTANCE_SCREENSHOT", artifact_dir / "workbench.png"))
    video_path_value = os.environ.get("STARS_ACCEPTANCE_VIDEO")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    run_plan_ids = set()

    try:
        if not ready(f"http://127.0.0.1:{api_port}/api/me", 401) or not ready(f"http://127.0.0.1:{web_port}/", 200):
            raise RuntimeError("Acceptance servers did not start")

        stamp = str(int(time.time()))
        email = f"stars-model-acceptance-{stamp}@example.com"
        password = "StarsAccept!" + stamp
        project_id = ""
        errors = []

        with tempfile.TemporaryDirectory(prefix="stars-acceptance-video-") as temp_video_dir, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context_options = {"viewport": {"width": 1440, "height": 1000}}
            if video_path_value:
                context_options["record_video_dir"] = temp_video_dir
                context_options["record_video_size"] = {"width": 1440, "height": 1000}
            context = browser.new_context(**context_options)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            def enforce_request_cap(route):
                if route.request.method == "POST" and "/runs" in route.request.url:
                    plan_id = (route.request.post_data_json or {}).get("planId")
                    if not plan_id or (plan_id not in run_plan_ids and len(run_plan_ids) >= request_cap):
                        route.abort("blockedbyclient")
                        return
                    run_plan_ids.add(plan_id)
                route.continue_()

            page.route("**/api/projects/*/runs", enforce_request_cap)
            page.goto(f"http://127.0.0.1:{web_port}", wait_until="networkidle")
            page.get_by_role("button", name="登录").click()
            page.get_by_role("button", name="还没有账号？注册").click()
            page.get_by_label("邮箱").fill(email)
            page.get_by_label("密码").fill(password)
            page.get_by_role("button", name="注册").click()
            page.wait_for_selector("dialog", state="detached")

            prompt = "Create a minimal single-page Stars app using local HTML, CSS, and JavaScript only. Include an h1 whose initial text is exactly 'Welcome to Stars', and a button with id 'toggle-welcome' and label 'Toggle greeting'. Clicking it must change the h1 text to exactly 'Stars is ready'. Return index.html and script.js. Do not include external URLs or assets."
            page.get_by_label("描述你的应用").fill(prompt)
            page.get_by_role("button", name="开始构建").click()
            page.get_by_role("heading", name="确认生成计划").wait_for()
            assert len(run_plan_ids) == 0, "A model run started before plan approval"
            page.get_by_role("button", name="确认计划并生成", exact=True).click()
            try:
                page.get_by_role("heading", name="检查文件变更").wait_for(timeout=240000)
                assert page.locator(".file-row").count() == 0, "Candidate files were committed before review approval"
                page.get_by_role("button", name="确认应用变更", exact=True).click()
                page.locator(".builder-header h2").filter(has_text="构建完成").wait_for(timeout=15000)
            except Exception:
                error = "; ".join(page.locator(".api-error").all_text_contents()) or "provider request failed"
                raise RuntimeError(f"Real model generation failed: {error}") from None

            assert page.locator(".dev-notice").count() == 0, "Stub output is not valid model acceptance"
            file_names = [name.strip() for name in page.locator(".file-row").all_text_contents()]
            assert page.locator(".file-row").filter(has_text="index.html").count() > 0, "index.html was not persisted"
            assert page.locator(".file-row").filter(has_text="script.js").count() > 0, "script.js was not persisted"
            assert len(run_plan_ids) == 1 and len(run_plan_ids) <= request_cap, "The explicit model request cap was exceeded"

            project_id = page.url.split("projectId=")[-1].split("&")[0]
            page.screenshot(path=str(screenshot_path), full_page=True)
            frame = page.frame_locator("iframe[title='生成应用预览']")
            app_body = frame.locator("body")
            expect(app_body).to_be_visible(timeout=15000)
            initial_text = app_body.inner_text()
            action_button = frame.locator("#toggle-welcome")
            if not action_button.count():
                action_button = frame.locator("button").first
            expect(action_button).to_be_visible(timeout=15000)
            action_button.click()
            expect(app_body).not_to_have_text(initial_text, timeout=5000)
            assert not errors, errors
            page.screenshot(path=str(screenshot_path), full_page=True)
            page.reload(wait_until="networkidle")
            page.locator(".builder-header h2").filter(has_text="构建完成").wait_for(timeout=15000)
            assert page.locator(".file-row").filter(has_text="index.html").count() > 0, "Generated project did not restore after refresh"
            expect(page.frame_locator("iframe[title='生成应用预览']").locator("body")).to_be_visible(timeout=15000)
            if video_path_value:
                video_path = Path(video_path_value)
                video_path.parent.mkdir(parents=True, exist_ok=True)
                video = page.video
                context.close()
                video.save_as(str(video_path))
            browser.close()

        report = {
            "result": "passed",
            "testedAt": datetime.now(timezone.utc).isoformat(),
            "model": model_name,
            "requestCount": len(run_plan_ids),
            "requestCap": request_cap,
            "projectId": project_id,
            "generatedFiles": file_names,
            "screenshot": str(screenshot_path),
            "video": video_path_value,
        }
        report_path = artifact_dir / "report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Real model acceptance passed. Artifacts: {report_path}")
    finally:
        web.terminate()
        api.terminate()
        web.wait(timeout=5)
        api.wait(timeout=5)
        temp_data.cleanup()


if __name__ == "__main__":
    main()
