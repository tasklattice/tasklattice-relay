#!/usr/bin/env python3
"""Recognize the native Hindsight service URL as non-secret, with a narrow shape."""
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
anchor = '        if not SECRET_KEY_RE.search(key):\n'
if source.count(anchor) != 2:
    raise SystemExit('Unexpected Hermes environment boundary: expected two secret-key checks')
source = source.replace(anchor, '''        # Hindsight uses API_URL for a non-secret internal endpoint. Credentials,
        # queries, fragments, external hosts and encoded path parts remain denied.
        if key == "HINDSIGHT_API_URL" and re.fullmatch(
            r"http://[a-z0-9-]+\\.[a-z0-9-]+\\.svc\\.cluster\\.local(?::[0-9]{1,5})?/v1/hindsight/coordinators/[a-zA-Z0-9_-]+",
            unquote(value),
        ):
            continue
''' + anchor)
path.write_text(source)
