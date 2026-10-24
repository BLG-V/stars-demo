#!/usr/bin/env python3
"""Encrypt a transaction-consistent dump of the Stars schema only."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit


ENV_FILE = Path("/opt/stars-demo-release/.env")
KEY_FILE = Path("/etc/stars-demo/backup.key")
BACKUP_DIR = Path("/var/backups/stars-demo")
DATABASE = "stars_demo_workbench"
BACKUP_NAME = re.compile(r"stars-\d{8}T\d{6}Z-[0-9a-f]{8}\.sql\.enc")


def private_file(path, root_owned=False):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("Configuration file must be a private regular file")
    if root_owned and info.st_uid != 0:
        raise ValueError("Encryption key must be owned by root")


def configuration():
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise ValueError("Run the backup as root")
    private_file(ENV_FILE)
    private_file(KEY_FILE, root_owned=True)
    key = KEY_FILE.read_bytes()
    if not 32 <= len(key.splitlines()[0] if key else b"") <= 4096:
        raise ValueError("Encryption key length is invalid")
    values = []
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*", line)
        if match:
            value = match[1]
            if value[:1] in ("'", '"'):
                if len(value) < 2 or value[-1] != value[0]:
                    raise ValueError("DATABASE_URL must be a one-line literal")
                value = value[1:-1]
            values.append(value)
    if len(values) != 1 or any(char.isspace() for char in values[0]):
        raise ValueError("Expected one literal DATABASE_URL")
    url = urlsplit(values[0])
    username, password = unquote(url.username or ""), unquote(url.password or "")
    if (url.scheme != "mysql" or url.path != "/" + DATABASE or url.fragment
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", username)
            or username == "root" or not password or "\x00" in password):
        raise ValueError("Only the Stars application database account is supported")
    # Docker exec uses this container's local MySQL socket, never a remote host.
    if url.hostname not in ("localhost", "127.0.0.1", "mysql") or url.port not in (None, 3306):
        raise ValueError("DATABASE_URL does not refer to the local MySQL service")
    if BACKUP_DIR.is_symlink() or BACKUP_DIR.resolve() != BACKUP_DIR:
        raise ValueError("Backup directory must resolve to its fixed path")
    BACKUP_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory = BACKUP_DIR.stat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0:
        raise ValueError("Backup directory must be owned by root")
    BACKUP_DIR.chmod(0o700)
    return username, password


def backup(username, password):
    name = "stars-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4) + ".sql.enc"
    destination = BACKUP_DIR / name
    partial = BACKUP_DIR / (name + ".partial")
    dump = encryption = None
    try:
        descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            environment = {**os.environ, "MYSQL_PWD": password}
            dump = subprocess.Popen([
                "docker", "exec", "-i", "-e", "MYSQL_PWD", "mysql", "mysqldump", "-u", username,
                "--single-transaction", "--skip-lock-tables", "--no-tablespaces",
                "--set-gtid-purged=OFF", DATABASE,
            ], env=environment, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            encryption = subprocess.Popen([
                "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "250000",
                "-pass", "file:" + str(KEY_FILE),
            ], stdin=dump.stdout, stdout=output, stderr=subprocess.DEVNULL)
            dump.stdout.close()
            if dump.wait(timeout=240) != 0 or encryption.wait(timeout=30) != 0:
                raise RuntimeError("Backup pipeline failed")
            output.flush()
            os.fsync(output.fileno())
        if partial.stat().st_size < 32:
            raise RuntimeError("Encrypted backup is incomplete")
        partial.replace(destination)
        cutoff = time.time() - 7 * 24 * 60 * 60
        removed = 0
        for candidate in BACKUP_DIR.iterdir():
            if BACKUP_NAME.fullmatch(candidate.name):
                info = candidate.lstat()
                if stat.S_ISREG(info.st_mode) and info.st_mtime < cutoff:
                    candidate.unlink()
                    removed += 1
        print(json.dumps({"result": "passed", "file": str(destination), "bytes": destination.stat().st_size, "expiredRemoved": removed}))
    finally:
        for process in (dump, encryption):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
        if partial.exists():
            partial.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate private configuration and fixed destination without running Docker")
    arguments = parser.parse_args()
    try:
        username, password = configuration()
        if arguments.check:
            print(json.dumps({"configuration": "valid", "database": DATABASE, "directory": str(BACKUP_DIR)}))
        else:
            backup(username, password)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        # Avoid logging exception strings: subprocess and URL errors can contain credentials.
        print("Stars backup failed; inspect private configuration, Docker and OpenSSL availability.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
