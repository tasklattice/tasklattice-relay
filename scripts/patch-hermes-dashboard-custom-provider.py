#!/usr/bin/env python3
"""Keep Relay-routed Hermes Dashboard inference on the custom endpoint."""

from __future__ import annotations

import argparse
from pathlib import Path


PROVIDER_ANCHOR = '''    model["provider"] = provider_key
    return routing
'''

PROVIDER_REPLACEMENT = '''    # Relay supplies an OpenAI-compatible LiteLLM endpoint with an OpenShell-
    # managed OPENAI_API_KEY placeholder. Replacing ``custom`` with the
    # upstream vendor name makes Hermes bypass that contract and demand the
    # vendor's environment variable inside the Sandbox.
    if model.get("provider") != "custom":
        raise InvalidDashboardSeedDocumentError(
            "gateway model routing must use the managed custom provider"
        )
    return routing
'''


def patch_dashboard_seeder(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    occurrences = source.count(PROVIDER_ANCHOR)
    if occurrences != 1:
        raise SystemExit(
            f"expected exactly one Dashboard provider override in {path}, "
            f"found {occurrences}"
        )
    path.write_text(
        source.replace(PROVIDER_ANCHOR, PROVIDER_REPLACEMENT),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dashboard_seeder", type=Path)
    args = parser.parse_args()
    patch_dashboard_seeder(args.dashboard_seeder)


if __name__ == "__main__":
    main()
