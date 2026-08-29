#!/usr/bin/env python3
"""Mirror Relay's scoped Hermes tools into the isolated Dashboard profile."""

from __future__ import annotations

import argparse
from pathlib import Path


IMPORT_ANCHOR = "import stat\nimport sys\n"
IMPORT_REPLACEMENT = "import stat\nimport sys\nimport urllib.parse\n"

FUNCTION_ANCHOR = '''    return normalized


def _set_policy_value(config: dict, dotted_path: str, value: object) -> None:
'''

FUNCTION_REPLACEMENT = '''    return normalized


_RELAY_TOOLSETS = frozenset({"hermes-cli", "kanban", "a2a", "vector-database"})
_RELAY_PLUGINS = frozenset({
    "nemoclaw",
    "tali-a2a",
    "tali-run-telemetry",
    "tali-vector-database",
})
_RELAY_REGISTRIES = {
    "a2a_registry": ("/v1/hermes/a2a-agents", "a2a", "tali-a2a"),
    "vector_database_registry": (
        "/v1/hermes/vector-databases",
        "vector-database",
        "tali-vector-database",
    ),
}


def _normalized_relay_integrations(gateway: dict) -> dict:
    """Return only Relay-owned tool, plugin, and scoped registry settings."""
    toolsets = gateway.get("toolsets")
    plugins = gateway.get("plugins")
    if (
        not isinstance(toolsets, list)
        or not toolsets
        or any(not isinstance(value, str) or value not in _RELAY_TOOLSETS for value in toolsets)
        or len(set(toolsets)) != len(toolsets)
        or not isinstance(plugins, dict)
        or not isinstance(plugins.get("enabled"), list)
        or any(not isinstance(value, str) for value in plugins["enabled"])
    ):
        raise InvalidDashboardSeedDocumentError(
            "gateway config has invalid Relay tool integration settings"
        )

    enabled = [value for value in plugins["enabled"] if value in _RELAY_PLUGINS]
    if "tali-run-telemetry" not in enabled:
        raise InvalidDashboardSeedDocumentError(
            "gateway config is missing Relay telemetry"
        )
    normalized = {"toolsets": list(toolsets), "plugins": enabled}

    for registry_name, (expected_path, required_toolset, required_plugin) in _RELAY_REGISTRIES.items():
        registry = gateway.get(registry_name)
        if registry is None:
            continue
        if not isinstance(registry, dict):
            raise InvalidDashboardSeedDocumentError(
                "gateway config has an invalid Relay registry"
            )
        parsed = urllib.parse.urlparse(str(registry.get("url", "")))
        query = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        auth = registry.get("auth")
        if (
            parsed.scheme != "http"
            or not parsed.hostname
            or not parsed.hostname.endswith(".svc.cluster.local")
            or parsed.path != expected_path
            or len(query.get("coordinatorInstanceId", [])) != 1
            or set(query) != {"coordinatorInstanceId"}
            or not isinstance(registry.get("timeout"), int)
            or registry["timeout"] < 1
            or registry["timeout"] > 60
            or not isinstance(auth, dict)
            or auth.get("type") != "bearer"
            or not isinstance(auth.get("token"), str)
            or not auth["token"]
            or required_toolset not in toolsets
            or required_plugin not in enabled
        ):
            raise InvalidDashboardSeedDocumentError(
                "gateway config has an invalid Relay registry boundary"
            )
        normalized[registry_name] = deepcopy(registry)

    return normalized


def _set_policy_value(config: dict, dotted_path: str, value: object) -> None:
'''

VALIDATION_ANCHOR = '''    try:
        relay_memory = _normalized_relay_memory(gateway)
    except InvalidDashboardSeedDocumentError:
        print(
            "[SECURITY] Refusing to seed dashboard config because Relay Memory is invalid",
            file=sys.stderr,
        )
        return 1

    dashboard: dict = {}
'''

VALIDATION_REPLACEMENT = '''    try:
        relay_memory = _normalized_relay_memory(gateway)
    except InvalidDashboardSeedDocumentError:
        print(
            "[SECURITY] Refusing to seed dashboard config because Relay Memory is invalid",
            file=sys.stderr,
        )
        return 1
    try:
        relay_integrations = _normalized_relay_integrations(gateway)
    except (InvalidDashboardSeedDocumentError, ValueError):
        print(
            "[SECURITY] Refusing to seed dashboard config because Relay integrations are invalid",
            file=sys.stderr,
        )
        return 1

    dashboard: dict = {}
'''

MERGE_ANCHOR = '''    if relay_memory is None:
        dashboard.pop("memory", None)
    else:
        dashboard["memory"] = relay_memory

    import yaml
'''

MERGE_REPLACEMENT = '''    if relay_memory is None:
        dashboard.pop("memory", None)
    else:
        dashboard["memory"] = relay_memory

    existing_toolsets = dashboard.get("toolsets")
    retained_toolsets = (
        [value for value in existing_toolsets if value not in _RELAY_TOOLSETS]
        if isinstance(existing_toolsets, list)
        else []
    )
    dashboard["toolsets"] = list(dict.fromkeys([
        *retained_toolsets,
        *relay_integrations["toolsets"],
    ]))
    dashboard_plugins = (
        dict(dashboard.get("plugins"))
        if isinstance(dashboard.get("plugins"), dict)
        else {}
    )
    existing_enabled = dashboard_plugins.get("enabled")
    retained_enabled = (
        [value for value in existing_enabled if value not in _RELAY_PLUGINS]
        if isinstance(existing_enabled, list)
        else []
    )
    dashboard_plugins["enabled"] = list(dict.fromkeys([
        *retained_enabled,
        *relay_integrations["plugins"],
    ]))
    existing_disabled = dashboard_plugins.get("disabled")
    if isinstance(existing_disabled, list):
        dashboard_plugins["disabled"] = [
            value for value in existing_disabled if value not in _RELAY_PLUGINS
        ]
    dashboard["plugins"] = dashboard_plugins
    for registry_name in _RELAY_REGISTRIES:
        if registry_name in relay_integrations:
            dashboard[registry_name] = relay_integrations[registry_name]
        else:
            dashboard.pop(registry_name, None)

    import yaml
'''

MESSAGE_ANCHOR = '''        f"[dashboard] seeded model routing, Relay Memory, and reviewed policy into {dst}",
'''
MESSAGE_REPLACEMENT = '''        f"[dashboard] seeded model routing, Relay integrations, and reviewed policy into {dst}",
'''


def _replace_once(source: str, anchor: str, replacement: str, label: str) -> str:
    occurrences = source.count(anchor)
    if occurrences != 1:
        raise SystemExit(f"expected exactly one {label}, found {occurrences}")
    return source.replace(anchor, replacement)


def patch_dashboard_seeder(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    source = _replace_once(source, IMPORT_ANCHOR, IMPORT_REPLACEMENT, "import anchor")
    source = _replace_once(source, FUNCTION_ANCHOR, FUNCTION_REPLACEMENT, "function anchor")
    source = _replace_once(source, VALIDATION_ANCHOR, VALIDATION_REPLACEMENT, "validation anchor")
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
