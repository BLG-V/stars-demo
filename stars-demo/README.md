# Stars Demo

Stars is an application workbench built with Vite, React, plain CSS and a Node HTTP API. The current local revision adds confirmed generation plans, candidate-file review, durable run events, history, snapshot diffs and quality gates. The audited revision was deployed on 2026-10-24 and passed production acceptance with one real Qwen3.8-flash plan.

Production at [https://39.107.41.101/](https://39.107.41.101/) runs the 2026-10-24 release. Its historical acceptance verified HTTP→HTTPS, MySQL health with Stub disabled, a real Qwen3.8-flash three-file generation, preview interaction and refresh recovery with no browser errors. Test accounts and that run's data were removed. The short-lived IP certificate renewal timer, dry-run and Nginx hook were verified at that time; monitor renewal rather than relying on a fixed remaining lifetime.

## Run

```powershell
$env:ALLOW_STUB_MODEL='true'
npm run dev:full
```

Open the Vite URL, register or sign in, submit a prompt and confirm the generated execution scope. Generation produces candidate files for review; approve the diff to save and preview them, or reject it to keep existing files. Plans are rule-based scope descriptions, not a claimed model reasoning step. Empty projects start without generated files or a successful preview.

Vite proxies `/api` to the local Node API. `npm run dev` starts only the frontend; `npm run api` starts only the API. The example explicitly enables the local Stub. For a real provider, set `MODEL_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME`, and optionally `MODEL_TIMEOUT_MS` in the server environment, with `ALLOW_STUB_MODEL=false`. Never put the API key in frontend variables or committed files.

Development data defaults to `data/stars.json` (`STARS_STORAGE=json`). Session tokens persist only as SHA-256 digests. MySQL uses server-side `DATABASE_URL`; run migrations as a deployment identity, then use `STARS_SKIP_MIGRATIONS=true` with a least-privilege application account. This revision adds `server/migrations/002_run_states.sql` for plan, event, candidate and baseline-hash state. Migration `002_run_states.sql` is applied in production; runtime uses `STARS_SKIP_MIGRATIONS=true`. `.env` must remain uncommitted.

`POST /api/projects/:id/plans` saves a plan; confirmed runs use `{planId,idempotencyKey:planId}`. The same plan replays persisted events rather than starting another model call. `Last-Event-ID` filters replay. The frontend resumes observation after a refresh or disconnect with the same plan and saved event ID, within a 240-second window and bounded network retries; HTTP errors stop retries. The SSE stages are `queued/planning/read_file/generating/validating/file_change/review/done/error`; `read_file` requires existing files and `done` follows approval. The `approve` and `reject` run endpoints apply or discard reviewed candidates. Generation and commit both check the baseline file hash to avoid stale overwrites.

The Provider accepts `{ "files": [{ "path": "index.html", "content": "..." }] }`. It checks paths, extensions, counts/sizes and duplicates. Generated output and manual saves share `unsafeContent`, which normalizes HTML entities, percent and JavaScript escapes, TAB/CR/LF and backslashes before rejecting explicit `http(s):` schemes, external URLs (including encoded IP/IPv6/localhost authorities), and Atoms brand text. Generated-output and manual-save bypass regressions reproduced the bug before the fix and now pass. Valid candidates remain uncommitted until approval; the final JSON atomic write or MySQL transaction updates files, run/project status and `file_changes`. Rejecting or failing preserves existing files.

Deploy a single API process only. Startup marks leftover `running` records as `RUN_INTERRUPTED`; review candidates remain available. This is interruption reporting, not model-job resumption or a multi-instance worker queue. Structured logs include request IDs, status, duration, run status and model error codes. A tested `run_finished` event is logged even after client disconnection. Error responses include the request ID; logs exclude bodies and credentials.

## UI scope

- Pixel-tech Stars workbench: near-black grid canvas, lime primary actions, Royal Blue structural lines, square surfaces and hard-offset shadows. Theme tokens live at the top of `src/styles.css` and are documented in `../design-system/stars/MASTER.md`.
- Monospace labels/headings, bracketed system markers, a dashed workflow stepper and segmented generation progress.
- Responsive sidebar, navigation and actual billing status; no fabricated credits. Folder management, attachment and voice inputs are explicitly disabled until implemented.
- Natural-language composer with build mode, disabled/active send states and agent roster.
- Discover, projects and templates tabs.
- Plan and diff approval panels, persisted messages/run events, generated file tree, editor and sandboxed App Viewer.
- Preview CSP blocks common external resources, connections, forms and nested frames; it cannot reliably prevent the iframe itself from navigating to an external site. Strict zero-egress production requirements need browser or network egress isolation.
- Desktop/mobile preview toggle, console status, reload control and a real greeting-change interaction.
- Project URL refresh recovery, snapshot content diffs, restore with a safety snapshot, application dialogs for project management, and standalone HTML export.

## Checks and deployment

After all review fixes, lint, scoped typecheck, format checks, build, 19 API/storage tests and expanded Playwright passed. Both Python acceptance scripts also passed syntax compilation. The delayed local mock browser test proves that refreshing during generation reconnects with the same plan ID and `Last-Event-ID >= 3`, reaches candidate review, and makes exactly one provider call. Preview monitoring uses an IIFE so valid app globals such as `report` and `original` do not collide. `npm test` runs syntax checks and API/storage suites. Browser tests use isolated JSON data with an explicit Stub or delayed local mock Provider; they do not establish new real-model or cloud-MySQL acceptance.

`test/model_acceptance.py` now follows both approval gates; only its syntax was checked in this revision, without a paid model call.

ESLint covers application, server and JavaScript tests. Strict TypeScript `checkJs` covers only `server/schemas.mjs`, `vite.config.js` and `eslint.config.js`; the app and storage are not fully strict-typed. Prettier checks package/tool configuration, deployment documentation and CI configuration, not all application sources. Runtime Zod schemas cover authentication, plan and run requests. Dependencies are pinned; `.github/workflows/stars-ci.yml` runs the gates, but this change does not claim a remote CI run.

Sanitized Nginx/systemd reference templates are in `deploy/`; production uses a Stars-only release, resource limits, API/auth rate limits and an HTTP API redirect; Firestone/MySQL were not restarted. Encrypted Stars-only backup and isolated-schema restore passed.

## Implementation boundary

The API enforces ownership and never executes model-returned commands. Unconfigured generation fails unless an explicit development Stub is enabled; no UI animation substitutes for API success. Pending work includes rate limiting, run cancellation, broader typing/security checks, production verification of this revision, backup/restore drills, rotation of exposed root/administrative credentials, and strict egress isolation. Style sources and permission boundaries are documented in `../requirements.md` and `../development-plan.md`.
