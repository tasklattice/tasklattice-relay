#!/usr/bin/env python3
"""Authenticate Hermes Dashboard health probes to the loopback API server."""

from __future__ import annotations

import argparse
from pathlib import Path


PROBE_ANCHOR = '''    for path in (f"{base}/health/detailed", f"{base}/health"):
        try:
            req = urllib.request.Request(path, method="GET")
'''

AUTHENTICATED_PROBE = '''    api_server_key = os.getenv("API_SERVER_KEY", "").strip()
    health_headers = (
        {"Authorization": f"Bearer {api_server_key}"}
        if api_server_key
        and urllib.parse.urlsplit(base).hostname in {"127.0.0.1", "::1", "localhost"}
        else {}
    )

    for path in (f"{base}/health/detailed", f"{base}/health"):
        try:
            req = urllib.request.Request(
                path, headers=health_headers, method="GET"
            )
'''


def _with_parse_import(source: str) -> str:
    anchor = "import urllib.request\n"
    if source.count(anchor) != 1:
        raise SystemExit("expected one urllib.request import")
    return source.replace(anchor, "import urllib.parse\n" + anchor)


def patch_web_server(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    # Hermes 0.21.3 moved the probe to web_server_gateway.py.
    if "import urllib.parse\n" not in source:
        source = _with_parse_import(source)
    occurrences = source.count(PROBE_ANCHOR)
    if occurrences != 1:
        raise SystemExit(
            f"expected exactly one unauthenticated Hermes health probe in {path}, "
            f"found {occurrences}"
        )
    path.write_text(source.replace(PROBE_ANCHOR, AUTHENTICATED_PROBE), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("web_server", type=Path)
    args = parser.parse_args()
    patch_web_server(args.web_server)


if __name__ == "__main__":
    main()
