#!/opt/hermes/.venv/bin/python3
"""Archive verified Relay-generated shadows before NemoClaw's native migration.

Agent memories and session databases remain for the upstream strict migrator.
Unknown conflicting content is never overwritten or discarded.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sqlite3

import yaml

DEFAULT_SOUL_SHA256 = "2765a846e1bb371d78d3b93b403dfb0f8d1ba1a9895edb5f608367abfe81194d"
REFERENCE = re.compile(r"^openshell:resolve:env:(?:v[0-9]{1,20}|s[a-f0-9]{64})_([A-Z][A-Z0-9_]*)$")


def regular(path):
    if path.resolve(strict=True) != path.absolute():
        raise RuntimeError(f"Unsafe legacy path: {path}")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError(f"Unsafe legacy file: {path}")
    if metadata.st_uid != os.geteuid() or metadata.st_size > 4 * 1024 * 1024:
        raise RuntimeError(f"Unexpected legacy file owner or size: {path}")
    return path.read_text(encoding="utf-8")


def normalize(value):
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items() if k != "_config_version"}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, str):
        prefix = "Bearer " if value.startswith("Bearer ") else ""
        if match := REFERENCE.fullmatch(value[len(prefix):]):
            return prefix + "openshell:resolve:env:" + match[1]
    return value


def subset(source, target):
    if isinstance(source, dict) and isinstance(target, dict):
        return all(k in target and subset(v, target[k]) for k, v in source.items())
    return source == target


def auth_semantic(text):
    document = json.loads(text)
    document.pop("updated_at", None)
    for pool in document.get("credential_pool", {}).values():
        for entry in pool:
            entry.pop("id", None)
    return normalize(document)


def empty_state_database(path):
    if path.resolve(strict=True) != path.absolute():
        raise RuntimeError(f"Unsafe legacy path: {path}")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != os.geteuid():
        raise RuntimeError(f"Unsafe state database: {path}")
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise RuntimeError(f"Corrupt state database: {path}")
        tables = connection.execute("SELECT name FROM pragma_table_list WHERE schema='main' AND type IN ('table', 'virtual')").fetchall()
        for (table,) in tables:
            if table in ("schema_version", "state_meta") or table.startswith("sqlite_"):
                continue
            quoted = table.replace('"', '""')
            if connection.execute(f'SELECT 1 FROM "{quoted}" LIMIT 1').fetchone():
                return False
        return True
    finally:
        connection.close()


def migrate(root):
    pending = []
    for relative in ("dashboard-home", "profiles/dashboard-home"):
        legacy = root / relative
        if not legacy.exists():
            continue
        # Reject parent symlinks as well as file symlinks.
        for path in (root, *[root.joinpath(*Path(relative).parts[:i]) for i in range(1, len(Path(relative).parts) + 1)]):
            metadata = path.lstat()
            if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid():
                raise RuntimeError(f"Unsafe legacy directory: {path}")
        for name in ("SOUL.md", "auth.json", "config.yaml", "cache/mcp_schema_cache.json", "tui-theme-boot.json"):
            source, target = legacy / name, root / name
            if not source.exists() or not target.exists():
                continue
            text, current = regular(source), regular(target)
            if text == current:
                continue
            if name == "SOUL.md":
                verified = hashlib.sha256(text.encode()).hexdigest() == DEFAULT_SOUL_SHA256
            elif name == "auth.json":
                verified = auth_semantic(text) == auth_semantic(current)
            elif name == "config.yaml":
                verified = subset(normalize(yaml.safe_load(text)), normalize(yaml.safe_load(current)))
            else:
                # Native Hermes rebuilds these schema/theme caches. Keep originals.
                json.loads(text)
                verified = True
            if not verified:
                raise RuntimeError(f"Unrecognized legacy conflict: {source}")
            pending.append((source, (relative + "/" + name).replace("/", "-")))
    native = root / "runtime/state.db"
    for relative in ("dashboard-home", "profiles/dashboard-home"):
        legacy = root / relative / "state.db"
        if not legacy.exists() or not native.exists():
            continue
        if empty_state_database(legacy):
            empty = legacy
        elif empty_state_database(native):
            empty = native
        else:
            raise RuntimeError("Both native and legacy Hermes databases contain state; merge requires review")
        for suffix in ("", "-wal", "-shm"):
            path = Path(str(empty) + suffix)
            if path.exists():
                metadata = path.lstat()
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != os.geteuid():
                    raise RuntimeError(f"Unsafe state database companion: {path}")
                pending.append((path, str(path.relative_to(root)).replace("/", "-") + ".empty-before-migration"))
    if not pending:
        return
    archive = root / ".relay-upgrade-138-archive"
    archive.mkdir(mode=0o700, exist_ok=True)
    metadata = archive.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or (metadata.st_uid, metadata.st_gid) != (os.geteuid(), os.getegid()):
        raise RuntimeError("Unsafe legacy archive directory")
    archive.chmod(0o700)
    for _, name in pending:
        if (archive / name).exists():
            raise RuntimeError("Legacy archive collision")
    for source, name in pending:
        source.rename(archive / name)
        print(f"Archived generated legacy Dashboard file: {source.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-dir", type=Path, default=Path("/sandbox/.hermes"))
    migrate(parser.parse_args().hermes_dir)
