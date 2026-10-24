# Stars Demo

Stars is an application workbench built with Vite, React, plain CSS and a Node HTTP API. It supports confirmed generation plans, candidate-file review, durable run events, snapshots, email verification, personal folders, project organization and account sessions.

Production at [https://39.107.41.101/](https://39.107.41.101/) runs release `20261024T123111Z-techworkbench-94ec577` from code commit `94ec577`. This release includes the neutral technology-workbench theme and local file/folder attachment menu; see the [deployment report](../docs/qa/production-techworkbench-2026-10-24.md). The prior release's 10-check MySQL workbench smoke test and earlier real Qwen generation are separate historical evidence.

## Run

```powershell
$env:ALLOW_STUB_MODEL='true'
npm run dev:full
```

Open the Vite URL, register or sign in, submit a prompt and confirm the generated execution scope. Generation produces candidate files for review; approve the diff to save and preview them, or reject it to keep existing files. Plans are rule-based scope descriptions, not a claimed model reasoning step. Empty projects start without generated files or a successful preview.

Vite proxies `/api` to the local Node API. `npm run dev` starts only the frontend; `npm run api` starts only the API. Registration uses `POST /api/auth/register/request-code` followed by `POST /api/auth/register/verify`; configure SMTP on the server (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) before enabling registration. Verification codes are one-time, short-lived, hashed at rest, attempt-limited and never logged or returned. For a real provider, set `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME`, and optionally `MODEL_TIMEOUT_MS` in the server environment, with `ALLOW_STUB_MODEL=false`. Never put API or SMTP credentials in frontend variables or committed files.

Development data defaults to `data/stars.json` (`STARS_STORAGE=json`). Session tokens persist only as SHA-256 digests. MySQL uses server-side `DATABASE_URL`; run migrations as a deployment identity, then use `STARS_SKIP_MIGRATIONS=true` with a least-privilege application account. Migrations `002_run_states.sql`, `003_email_verifications.sql` and `004_folders.sql` cover run state, email verification and personal folders. All three are applied in production; runtime uses `STARS_SKIP_MIGRATIONS=true`. `.env` must remain uncommitted.

`POST /api/projects/:id/plans` saves a plan; confirmed runs use `{planId,idempotencyKey:planId}`. The same plan replays persisted events rather than starting another model call. `Last-Event-ID` filters replay. The frontend resumes observation after a refresh or disconnect with the same plan and saved event ID, within a 240-second window and bounded network retries; HTTP errors stop retries. The SSE stages are `queued/planning/read_file/generating/validating/file_change/review/done/error`; `read_file` requires existing files and `done` follows approval. The `approve` and `reject` run endpoints apply or discard reviewed candidates. Generation and commit both check the baseline file hash to avoid stale overwrites.

The Provider accepts `{ "files": [{ "path": "index.html", "content": "..." }] }`. It checks paths, extensions, counts/sizes and duplicates. Generated output and manual saves share `unsafeContent`, which normalizes HTML entities, percent and JavaScript escapes, TAB/CR/LF and backslashes before rejecting explicit `http(s):` schemes, external URLs (including encoded IP/IPv6/localhost authorities), and Atoms brand text. Generated-output and manual-save bypass regressions reproduced the bug before the fix and now pass. Valid candidates remain uncommitted until approval; the final JSON atomic write or MySQL transaction updates files, run/project status and `file_changes`. Rejecting or failing preserves existing files.

Deploy a single API process only. Startup marks leftover `running` records as `RUN_INTERRUPTED`; review candidates remain available. This is interruption reporting, not model-job resumption or a multi-instance worker queue. Structured logs include request IDs, status, duration, run status and model error codes. A tested `run_finished` event is logged even after client disconnection. Error responses include the request ID; logs exclude bodies and credentials.

## UI scope

- Neutral technology workbench: mist-gray canvas, cool white panels, blue actions, sans-serif typography and a floating sidebar with 16px outer spacing and 20px radius. Logged-out landing and authentication retain their independent styling. Tokens: [design system](../design-system/stars/MASTER.md).
- The Add menu opens native local file or folder pickers. Text imports preserve relative paths, skip hidden/dependency/build/lock files, report accepted/skipped results and support removal. Up to 10 text files, 32 KiB each; the combined prompt is limited to 4,000 characters. Original files are not stored separately; selected text persists with project demands/messages and is sent to the configured model. Review selected content before submitting.
- Personal folder CRUD and project assignment, recent eight projects, browser speech recognition with an unsupported-browser fallback, and the authenticated account/logout menu. Browser speech services may process audio remotely; Stars does not store raw audio.
- Accessible attachment menu keyboard navigation, viewport-aware placement, visible focus, loading/disabled/error states and reduced-motion behavior. When Cloudflare Turnstile is configured, each authentication request needs a fresh single-use token, including code resend and retry.
- Natural-language composer with build mode, disabled/active send states and agent roster.
- Discover, projects and templates tabs.
- Plan and diff approval panels, persisted messages/run events, generated file tree, editor and sandboxed App Viewer.
- Preview CSP blocks common external resources, connections, forms and nested frames; it cannot reliably prevent the iframe itself from navigating to an external site. Strict zero-egress production requirements need browser or network egress isolation.
- Desktop/mobile preview toggle, console status, reload control and a real greeting-change interaction.
- Project URL refresh recovery, snapshot content diffs, restore with a safety snapshot, application dialogs for project management, and standalone HTML export.

## Checks and deployment

The deployed code passed lint, scoped typecheck, format checks, build, 22 API/storage tests and expanded Playwright. File/folder and theme checks are recorded in [attachment regression](../docs/qa/workbench-attachments-2026-10-24.md); the new public deployment is recorded separately in the [deployment report](../docs/qa/production-techworkbench-2026-10-24.md). Both Python acceptance scripts also passed syntax compilation. The delayed local mock browser test proves that refreshing during generation reconnects with the same plan ID and `Last-Event-ID >= 3`, reaches candidate review, and makes exactly one provider call. Preview monitoring uses an IIFE so valid app globals such as `report` and `original` do not collide. `npm test` runs syntax checks and API/storage suites. Browser tests use isolated JSON data with an explicit Stub or delayed local mock Provider; they do not establish new real-model or cloud-MySQL acceptance.

`test/model_acceptance.py` now follows both approval gates; only its syntax was checked in this revision, without a paid model call.

ESLint covers application, server and JavaScript tests. Strict TypeScript `checkJs` covers only `server/schemas.mjs`, `vite.config.js` and `eslint.config.js`; the app and storage are not fully strict-typed. Prettier checks package/tool configuration, deployment documentation and CI configuration, not all application sources. Runtime Zod schemas cover authentication, plan and run requests. Dependencies are pinned; `.github/workflows/stars-ci.yml` runs the gates, but this change does not claim a remote CI run.

Sanitized Nginx/systemd reference templates are in `deploy/`; production uses a Stars-only release, resource limits, API/auth rate limits and an HTTP API redirect; Firestone/MySQL were not restarted. Encrypted Stars-only backup and isolated-schema restore passed.

## Implementation boundary

The API enforces ownership and never executes model-returned commands. Unconfigured generation fails unless an explicit development Stub is enabled; no UI animation substitutes for API success. Pending work includes run cancellation, broader typing/security checks, live-model and provider verification of this release, continued backup/key-recovery drills, rotation of exposed root/administrative credentials, and strict egress isolation. Style sources and permission boundaries are documented in `../requirements.md` and `../development-plan.md`.
