# Deployment reference templates

These sanitized templates represent the Stars architecture: `/opt/stars-demo-release/dist` is served by Nginx, `/api/` is forwarded to `127.0.0.1:8787`, and HTTP redirects to `https://39.107.41.101/`. They are reference templates, not a capture of the running server configuration. They have not been installed as part of this code change.

## Configure and validate

1. Inspect the current deployment first: `sudo systemctl cat stars-demo`, `sudo nginx -T`, `command -v node`, and `sudo certbot certificates`. Do not print environment files or commit those outputs if they contain secrets.
2. Back up the existing Nginx and systemd configuration outside the repository. Replace both certificate placeholders in `nginx.conf.example` with the actual certificate and private key paths. The ACME webroot must match the existing Certbot authenticator; keep the existing renewal configuration and deployment hook.
3. Verify `/usr/bin/node` or substitute the actual Node binary. The unit template uses an unprivileged `stars` system account; create that account and grant read and execute access to application files before enabling this template. Systemd reads the root-owned environment file; preserve mode `0600`. Use `STARS_STORAGE=mysql` and a dedicated application database account. Never copy production credentials into source control.
4. The systemd template mounts the filesystem read-only and is intended for MySQL storage. JSON storage would require an explicitly allowed data directory. Do not add application or shell execution privileges for generated code.
5. Run `sudo nginx -t` and `sudo systemd-analyze verify /etc/systemd/system/stars-demo.service` against the completed installed files. Reload only after those checks pass. Check `/api/health`, registration, generation, preview interaction, and session recovery after a release.

## Quality gates

Run `npm ci`, `python -m pip install -r test/requirements.txt`, and `python -m playwright install chromium`. The CI workflow also installs Chromium system dependencies on Ubuntu. `npm test` runs the Node API and storage suites; `npm run test:e2e` uses isolated JSON data and an explicit stub provider, never production credentials.

`npm run lint` checks all application, server, and JavaScript test files. `npm run typecheck` uses strict TypeScript `checkJs` for the actual boundary schemas and build/lint configuration; it does not claim strict typing of the existing JSX application or storage implementations. Zod validates the API request schemas at runtime. `npm run format:check` checks package files, tool configuration, this deployment guide, and CI configuration; it deliberately does not impose a reformat on unrelated application sources.

The workspace currently has no Git repository metadata, so `.env` tracking or historical publication cannot be verified with Git. `.gitignore` excludes `.env` and `.env.*` while allowing `.env.example`. A local ignored runtime file alone does not establish a leak. Do not commit `.env`; rotate any known exposed credentials through a coordinated operational change rather than deleting a working configuration.

## Stars-only encrypted backups

`backup_stars.py` dumps only `stars_demo_workbench` from the existing Docker container named `mysql`, using the application account parsed from `/opt/stars-demo-release/.env`. It does not evaluate shell expressions. The password reaches Docker through an inherited environment variable, never a command-line value or a log. The plaintext SQL streams directly into OpenSSL AES-256-CBC with PBKDF2 (250,000 iterations); it is not saved on disk.

Before installation, create `/etc/stars-demo/backup.key` as a root-owned `0600` file containing a strong randomly generated secret, and `/var/backups/stars-demo` as root-owned `0700`. Keep a recoverable copy of the key separately from the backups, outside the repository. The script deliberately does not generate or replace keys. Losing the key prevents restore. Existing `.env` must have no group/world access. Run `python3 deploy/backup_stars.py --check` to validate paths and credentials without making a dump, then execute one backup and confirm a successful result before enabling the provided service/timer templates. Validate the installed units with `systemd-analyze verify`. The daily timer is persistent; inspect the host timezone and existing load before choosing its schedule. No global database restart or unrelated project configuration is required.

Backups are root-only `stars-<UTC timestamp>-<random>.sql.enc` files. A successful backup prunes only regular files matching that exact naming scheme in the verified fixed directory whose modification time is more than seven days old. It never follows backup symlinks or scans other project directories. Encrypted files still require restricted storage and off-host retention; AES-CBC provides encryption rather than authenticated tamper detection.

To restore, decrypt with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass file:/etc/stars-demo/backup.key -in <backup.sql.enc>` and pipe directly to the database client targeting a uniquely named isolated Stars restore schema. Do not use `--databases` for backup or import into production. Confirm both pipeline exit codes, table counts, per-table row counts and selected content hashes before recording a successful drill. Only remove the exact temporary schema created for that drill. Never write the key, database password or decrypted SQL to the repository or ordinary logs.
