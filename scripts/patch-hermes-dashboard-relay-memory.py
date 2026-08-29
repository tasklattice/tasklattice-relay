#!/usr/bin/env python3
"""Mirror Relay's managed Hermes Memory provider into the dashboard profile."""

from __future__ import annotations

import argparse
from pathlib import Path


FUNCTION_ANCHOR = '''    return sections


def _set_policy_value(config: dict, dotted_path: str, value: object) -> None:
'''

FUNCTION_REPLACEMENT = '''    return sections


def _normalized_relay_memory(gateway: dict) -> dict | None:
    """Return the non-secret Relay Memory selection owned by the gateway config."""
    memory = gateway.get("memory")
    if memory is None:
        return None
    if not isinstance(memory, dict) or memory.get("provider") != "tali_relay":
        raise InvalidDashboardSeedDocumentError(
            "gateway config has an invalid Relay Memory provider"
        )

    normalized = {"provider": "tali_relay"}
    for flag in ("memory_enabled", "user_profile_enabled"):
        if flag not in memory:
            continue
        value = memory[flag]
        if not isinstance(value, bool):
            raise InvalidDashboardSeedDocumentError(
                "gateway config has an invalid Relay Memory flag"
            )
        normalized[flag] = value
    return normalized


def _set_policy_value(config: dict, dotted_path: str, value: object) -> None:
'''

VALIDATION_ANCHOR = '''    try:
        policy_sections = _managed_policy_sections(gateway, policy)
    except InvalidDashboardSeedDocumentError:
        print(
            "[SECURITY] Refusing to seed dashboard config because gateway policy is invalid",
            file=sys.stderr,
        )
        return 1

    dashboard: dict = {}
'''

VALIDATION_REPLACEMENT = '''    try:
        policy_sections = _managed_policy_sections(gateway, policy)
    except InvalidDashboardSeedDocumentError:
        print(
            "[SECURITY] Refusing to seed dashboard config because gateway policy is invalid",
            file=sys.stderr,
        )
        return 1
    try:
        relay_memory = _normalized_relay_memory(gateway)
    except InvalidDashboardSeedDocumentError:
        print(
            "[SECURITY] Refusing to seed dashboard config because Relay Memory is invalid",
            file=sys.stderr,
        )
        return 1

    dashboard: dict = {}
'''

MERGE_ANCHOR = '''    dashboard.update(routing)
    _merge_policy(dashboard, policy_sections)

    import yaml
'''

MERGE_REPLACEMENT = '''    dashboard.update(routing)
    _merge_policy(dashboard, policy_sections)
    if relay_memory is None:
        dashboard.pop("memory", None)
    else:
        dashboard["memory"] = relay_memory

    import yaml
'''

MESSAGE_ANCHOR = '''    print(f"[dashboard] seeded model routing and reviewed policy into {dst}", file=sys.stderr)
'''

MESSAGE_REPLACEMENT = '''    print(
        f"[dashboard] seeded model routing, Relay Memory, and reviewed policy into {dst}",
        file=sys.stderr,
    )
'''


def _replace_once(source: str, anchor: str, replacement: str, label: str) -> str:
    occurrences = source.count(anchor)
    if occurrences != 1:
        raise SystemExit(f"expected exactly one {label}, found {occurrences}")
    return source.replace(anchor, replacement)


def patch_dashboard_seeder(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    source = _replace_once(source, FUNCTION_ANCHOR, FUNCTION_REPLACEMENT, "function anchor")
    source = _replace_once(
        source,
        VALIDATION_ANCHOR,
        VALIDATION_REPLACEMENT,
        "validation anchor",
    )
    source = _replace_once(source, MERGE_ANCHOR, MERGE_REPLACEMENT, "merge anchor")
    source = _replace_once(source, MESSAGE_ANCHOR, MESSAGE_REPLACEMENT, "message anchor")
    path.write_text(source, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dashboard_seeder", type=Path)
    args = parser.parse_args()
    patch_dashboard_seeder(args.dashboard_seeder)


if __name__ == "__main__":
    main()
