#!/opt/hermes/.venv/bin/python3
"""Apply TaskLattice Relay inference routing without weakening Hermes' hash anchor."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

import yaml


HASH_LINE = re.compile(r"^([0-9a-f]{64})  (.+)$")
MCP_LINE = re.compile(
    r"^# nemoclaw-hermes-mcp-state-v1 intended=([0-9a-f]{64}) applied=([0-9a-f]{64})$"
)
OPENSHELL_CREDENTIAL_PLACEHOLDER = re.compile(
    r"^openshell:resolve:env:v[0-9]+_OPENAI_API_KEY$"
)
MAX_A2A_REGISTRY_BYTES = 1024 * 1024


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Hermes A2A registry redirects are disabled")


A2A_REGISTRY_OPENER = urllib.request.build_opener(NoRedirectHandler())
VECTOR_DATABASE_REGISTRY_OPENER = urllib.request.build_opener(NoRedirectHandler())


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require_directory(path: Path) -> None:
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(f"Refusing non-directory Hermes path: {path}")


def require_regular_file(path: Path) -> None:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError(f"Refusing non-regular Hermes file: {path}")


def atomic_write(path: Path, data: bytes, mode: int) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def mcp_digest(config: Path, builder: Path, guard: Path) -> str:
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            str(builder),
            "--guard",
            str(guard),
            "--config",
            str(config),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    value = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RuntimeError("Hermes MCP digest builder returned an invalid digest")
    return value


def parse_anchor(anchor: bytes, config: Path, env: Path) -> tuple[str, str, str]:
    lines = anchor.decode("utf-8").splitlines()
    if len(lines) != 3:
        raise RuntimeError("Hermes hash anchor has an unexpected shape")
    config_match = HASH_LINE.fullmatch(lines[0])
    env_match = HASH_LINE.fullmatch(lines[1])
    mcp_match = MCP_LINE.fullmatch(lines[2])
    if not config_match or config_match.group(2) != str(config):
        raise RuntimeError("Hermes config hash anchor is invalid")
    if not env_match or env_match.group(2) != str(env):
        raise RuntimeError("Hermes env hash anchor is invalid")
    if not mcp_match or mcp_match.group(1) != mcp_match.group(2):
        raise RuntimeError("Hermes MCP hash anchor is not in a clean state")
    return config_match.group(1), env_match.group(1), mcp_match.group(1)


def validate_a2a_registry_url(value: str) -> urllib.parse.ParseResult:
    registry_url = urllib.parse.urlparse(value)
    if (
        registry_url.scheme != "http"
        or not registry_url.hostname
        or not registry_url.hostname.endswith(".svc.cluster.local")
    ):
        raise RuntimeError("Hermes A2A registry must be an in-cluster HTTP Service URL")
    return registry_url


def validate_vector_database_registry_url(value: str) -> urllib.parse.ParseResult:
    registry_url = urllib.parse.urlparse(value)
    if (
        registry_url.scheme != "http"
        or not registry_url.hostname
        or not registry_url.hostname.endswith(".svc.cluster.local")
        or registry_url.path != "/v1/hermes/vector-databases"
    ):
        raise RuntimeError(
            "Hermes Vector Database registry must be an in-cluster HTTP Service URL"
        )
    return registry_url


def openshell_model_credential() -> str:
    credential = os.environ.get("OPENAI_API_KEY", "")
    if not OPENSHELL_CREDENTIAL_PLACEHOLDER.fullmatch(credential):
        raise RuntimeError(
            "Hermes requires an OpenShell-managed OPENAI_API_KEY placeholder"
        )
    return credential


def configure_a2a(
    validated: dict,
    registry_url_value: str,
    registry_token: str,
    registry: object,
) -> None:
    """Apply a trusted Project Runtime Bridge snapshot to Hermes config."""
    registry_url = validate_a2a_registry_url(registry_url_value)
    peers = registry.get("a2a_agents") if isinstance(registry, dict) else None
    if not isinstance(peers, dict):
        raise RuntimeError("Hermes A2A registry returned an invalid peer map")
    for name, peer in peers.items():
        if not isinstance(name, str) or not name or not isinstance(peer, dict):
            raise RuntimeError("Hermes A2A registry returned an invalid peer")
        peer_url = urllib.parse.urlparse(str(peer.get("url", "")))
        if (
            peer_url.scheme != registry_url.scheme
            or peer_url.hostname != registry_url.hostname
            or peer_url.port != registry_url.port
            or not peer_url.path.startswith("/v1/a2a/")
        ):
            raise RuntimeError("Hermes A2A registry returned an out-of-bound peer URL")
    validated["a2a_registry"] = {
        "url": registry_url_value,
        "timeout": 10,
        "auth": {
            "type": "bearer",
            "token": registry_token,
        },
    }
    toolsets = validated.get("toolsets")
    if not isinstance(toolsets, list):
        toolsets = ["hermes-cli"]
    validated["toolsets"] = list(dict.fromkeys([*toolsets, "kanban", "a2a"]))
    plugins = validated.get("plugins")
    if not isinstance(plugins, dict):
        plugins = {}
        validated["plugins"] = plugins
    enabled_plugins = plugins.get("enabled")
    if not isinstance(enabled_plugins, list):
        enabled_plugins = []
    plugins["enabled"] = list(dict.fromkeys([*enabled_plugins, "tali-a2a"]))
    disabled_plugins = plugins.get("disabled")
    if isinstance(disabled_plugins, list):
        plugins["disabled"] = [
            plugin for plugin in disabled_plugins if plugin != "tali-a2a"
        ]


def configure_vector_databases(
    validated: dict,
    registry_url_value: str,
    registry_token: str,
    registry: object,
) -> None:
    """Apply the dynamic Project Vector Database registry to Hermes config."""
    registry_url = validate_vector_database_registry_url(registry_url_value)
    databases = registry.get("vector_databases") if isinstance(registry, dict) else None
    if not isinstance(databases, dict):
        raise RuntimeError(
            "Hermes Vector Database registry returned an invalid database map"
        )
    for database_id, database in databases.items():
        if (
            not isinstance(database_id, str)
            or not database_id
            or not isinstance(database, dict)
        ):
            raise RuntimeError(
                "Hermes Vector Database registry returned an invalid database"
            )
        search_url = urllib.parse.urlparse(str(database.get("url", "")))
        if (
            search_url.scheme != registry_url.scheme
            or search_url.hostname != registry_url.hostname
            or search_url.port != registry_url.port
            or not search_url.path.startswith("/v1/hermes/vector-databases/")
            or not search_url.path.endswith("/search")
        ):
            raise RuntimeError(
                "Hermes Vector Database registry returned an out-of-bound search URL"
            )
    validated["vector_database_registry"] = {
        "url": registry_url_value,
        "timeout": 10,
        "auth": {
            "type": "bearer",
            "token": registry_token,
        },
    }
    toolsets = validated.get("toolsets")
    if not isinstance(toolsets, list):
        toolsets = ["hermes-cli"]
    validated["toolsets"] = list(
        dict.fromkeys([*toolsets, "vector-database"])
    )
    plugins = validated.get("plugins")
    if not isinstance(plugins, dict):
        plugins = {}
        validated["plugins"] = plugins
    enabled_plugins = plugins.get("enabled")
    if not isinstance(enabled_plugins, list):
        enabled_plugins = []
    plugins["enabled"] = list(
        dict.fromkeys([*enabled_plugins, "tali-vector-database"])
    )
    disabled_plugins = plugins.get("disabled")
    if isinstance(disabled_plugins, list):
        plugins["disabled"] = [
            plugin
            for plugin in disabled_plugins
            if plugin != "tali-vector-database"
        ]


def configure_durable_memory(validated: dict, provider: str) -> None:
    """Select Relay's bundled scoped MemoryProvider without persisting credentials."""
    if provider != "tali_relay":
        raise RuntimeError("Unsupported Hermes Durable Memory provider")
    memory = validated.get("memory")
    if not isinstance(memory, dict):
        memory = {}
        validated["memory"] = memory
    memory["provider"] = provider


def enable_run_telemetry(validated: dict) -> None:
    """Keep Relay's bundled lifecycle plugin enabled in the managed config."""
    plugins = validated.get("plugins")
    if not isinstance(plugins, dict):
        plugins = {}
        validated["plugins"] = plugins
    enabled_plugins = plugins.get("enabled")
    if not isinstance(enabled_plugins, list):
        enabled_plugins = []
    plugins["enabled"] = list(
        dict.fromkeys([*enabled_plugins, "tali-run-telemetry"])
    )
    disabled_plugins = plugins.get("disabled")
    if isinstance(disabled_plugins, list):
        plugins["disabled"] = [
            plugin for plugin in disabled_plugins if plugin != "tali-run-telemetry"
        ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--hash-file", type=Path, required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--template-endpoint", required=True)
    parser.add_argument("--template-model", required=True)
    parser.add_argument("--a2a-registry-url")
    parser.add_argument("--a2a-registry-token")
    parser.add_argument("--vector-database-registry-url")
    parser.add_argument("--vector-database-registry-token")
    parser.add_argument("--durable-memory-provider")
    parser.add_argument(
        "--mcp-digest-builder",
        type=Path,
        default=Path("/usr/local/lib/nemoclaw/build-hermes-mcp-digest.py"),
    )
    parser.add_argument(
        "--runtime-config-guard",
        type=Path,
        default=Path("/usr/local/lib/nemoclaw/hermes-runtime-config-guard.py"),
    )
    args = parser.parse_args()

    config = args.config
    hash_file = args.hash_file
    if not config.is_absolute() or not hash_file.is_absolute():
        raise RuntimeError("Hermes bootstrap paths must be absolute")
    if config.parent != hash_file.parent:
        raise RuntimeError("Hermes config and hash anchor must share a directory")
    env = config.parent / ".env"
    require_directory(config.parent.parent)
    require_directory(config.parent)
    for path in (
        config,
        env,
        hash_file,
        args.mcp_digest_builder,
        args.runtime_config_guard,
    ):
        require_regular_file(path)
    original_config = config.read_bytes()
    original_env = env.read_bytes()
    original_anchor = hash_file.read_bytes()
    config_hash, env_hash, anchored_mcp = parse_anchor(original_anchor, config, env)
    if digest(original_config) != config_hash or digest(original_env) != env_hash:
        raise RuntimeError("Hermes persisted inputs already differ from the image anchor")
    if mcp_digest(config, args.mcp_digest_builder, args.runtime_config_guard) != anchored_mcp:
        raise RuntimeError("Hermes MCP configuration already differs from the image anchor")

    current = original_config.decode("utf-8")
    if (
        args.template_endpoint not in current
        and args.endpoint not in current
    ) or (
        args.template_model not in current
        and args.model not in current
    ):
        raise RuntimeError("Hermes config does not contain the expected inference template")
    updated = current.replace(args.template_endpoint, args.endpoint).replace(
        args.template_model, args.model
    )
    document = yaml.safe_load(updated)
    if not isinstance(document, dict):
        raise RuntimeError("Hermes config must be a YAML object")
    upstream = document.get("_nemoclaw_upstream", {}).get("provider")
    if not isinstance(upstream, str) or not upstream:
        raise RuntimeError("Hermes config does not declare its upstream provider")
    model = document.get("model")
    providers = document.get("providers")
    custom = document.get("custom_providers")
    if (
        not isinstance(model, dict)
        or not isinstance(providers, dict)
        or not isinstance(custom, list)
    ):
        raise RuntimeError("Hermes model credential fields have an unexpected shape")
    credential_routes = [model, *providers.values(), *custom]
    if not credential_routes or any(
        not isinstance(route, dict) for route in credential_routes
    ):
        raise RuntimeError("Hermes provider credential routes are invalid")
    managed_credential = openshell_model_credential()
    model["provider"] = "custom"
    for route in credential_routes:
        route["api_key"] = managed_credential
    validated = document
    enable_run_telemetry(validated)
    if bool(args.a2a_registry_url) != bool(args.a2a_registry_token):
        raise RuntimeError("Hermes A2A registry URL and token must be configured together")
    if args.a2a_registry_url:
        validate_a2a_registry_url(args.a2a_registry_url)
        request = urllib.request.Request(
            args.a2a_registry_url,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {args.a2a_registry_token}",
            },
            method="GET",
        )
        with A2A_REGISTRY_OPENER.open(request, timeout=15) as response:
            declared_length = response.headers.get("content-length")
            if declared_length and int(declared_length) > MAX_A2A_REGISTRY_BYTES:
                raise RuntimeError("Hermes A2A registry exceeded the 1 MiB limit")
            raw_registry = response.read(MAX_A2A_REGISTRY_BYTES + 1)
        if len(raw_registry) > MAX_A2A_REGISTRY_BYTES:
            raise RuntimeError("Hermes A2A registry exceeded the 1 MiB limit")
        registry = json.loads(raw_registry.decode("utf-8"))
        configure_a2a(
            validated,
            args.a2a_registry_url,
            args.a2a_registry_token,
            registry,
        )
    if bool(args.vector_database_registry_url) != bool(
        args.vector_database_registry_token
    ):
        raise RuntimeError(
            "Hermes Vector Database registry URL and token must be configured together"
        )
    if args.vector_database_registry_url:
        validate_vector_database_registry_url(args.vector_database_registry_url)
        request = urllib.request.Request(
            args.vector_database_registry_url,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {args.vector_database_registry_token}",
            },
            method="GET",
        )
        with VECTOR_DATABASE_REGISTRY_OPENER.open(request, timeout=15) as response:
            declared_length = response.headers.get("content-length")
            if declared_length and int(declared_length) > MAX_A2A_REGISTRY_BYTES:
                raise RuntimeError(
                    "Hermes Vector Database registry exceeded the 1 MiB limit"
                )
            raw_registry = response.read(MAX_A2A_REGISTRY_BYTES + 1)
        if len(raw_registry) > MAX_A2A_REGISTRY_BYTES:
            raise RuntimeError(
                "Hermes Vector Database registry exceeded the 1 MiB limit"
            )
        registry = json.loads(raw_registry.decode("utf-8"))
        configure_vector_databases(
            validated,
            args.vector_database_registry_url,
            args.vector_database_registry_token,
            registry,
        )
    if args.durable_memory_provider:
        configure_durable_memory(validated, args.durable_memory_provider)
    updated = yaml.safe_dump(
        validated,
        allow_unicode=True,
        sort_keys=False,
        width=1000,
    )
    updated_config = updated.encode("utf-8")
    config_mode = config.stat().st_mode & 0o7777
    anchor_mode = hash_file.stat().st_mode & 0o7777

    try:
        atomic_write(config, updated_config, config_mode)
        if mcp_digest(config, args.mcp_digest_builder, args.runtime_config_guard) != anchored_mcp:
            raise RuntimeError("Inference routing unexpectedly changed Hermes MCP configuration")
        updated_anchor = (
            f"{digest(updated_config)}  {config}\n"
            f"{digest(original_env)}  {env}\n"
            f"# nemoclaw-hermes-mcp-state-v1 intended={anchored_mcp} applied={anchored_mcp}\n"
        ).encode("utf-8")
        atomic_write(hash_file, updated_anchor, anchor_mode)
    except BaseException:
        atomic_write(config, original_config, config_mode)
        atomic_write(hash_file, original_anchor, anchor_mode)
        raise


if __name__ == "__main__":
    main()
