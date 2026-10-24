#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const target = process.argv[2];
const configPatchTarget = process.argv[3];
if (!target || !configPatchTarget) {
  console.error(
    "Usage: node scripts/patch-nemoclaw-deepagents-provider-v2-inference.mjs <managed-dcode-runtime.py> <patch-managed-deepagents-code.py>",
  );
  process.exit(2);
}

const importAnchor = `import stat
import sys`;

const upstreamFunction = `def managed_inference_base_url() -> str:
    """Read and validate the root-owned inference route baked into the image."""
    path = _INFERENCE_BASE_URL_FILE
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("managed inference base URL file is missing or unsafe")
    try:
        metadata = path.stat()
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError("managed inference base URL file is unreadable") from exc
    if (
        metadata.st_uid != _MANAGED_FILE_OWNER_UID
        or stat.S_IMODE(metadata.st_mode) != 0o444
    ):
        raise RuntimeError("managed inference base URL file has unsafe ownership or mode")
    value = raw.rstrip("\\n")
    if not value or len(value) > 2048 or raw not in {value, f"{value}\\n"}:
        raise RuntimeError("managed inference base URL file has invalid contents")
    if value != value.strip() or any(ord(character) < 32 for character in value):
        raise RuntimeError("managed inference base URL file has invalid contents")
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("managed inference base URL is invalid")
    return value`;

const compatibilityMarker = "_tali_openshell_inference_base_url";
const patchedFunction = `def _validated_managed_inference_base_url(value: str, source: str) -> str:
    if (
        not value
        or len(value) > 2048
        or value != value.strip()
        or any(ord(character) < 32 for character in value)
    ):
        raise RuntimeError(f"{source} has invalid contents")
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError(f"{source} is invalid")
    return value


def _tali_managed_inference_api_key() -> str:
    """Return only an endpoint-bound OpenShell placeholder or the baked sentinel."""
    # OpenShell 0.0.116 exports the sandbox name (for example i-abc), while
    # newer runtimes may use the legacy boolean marker 1. Presence
    # is the stable boundary; the endpoint-bound placeholder below remains the
    # credential authority and prevents an ambient marker from granting access.
    if not os.environ.get("OPENSHELL_SANDBOX"):
        return "nemoclaw-managed-inference"

    credential_name = "DEEPAGENTS_CODE_OPENAI_API_KEY"
    credential = os.environ.get(credential_name, "")
    if _is_openshell_placeholder_for_name(credential_name, credential):
        return credential

    # Providers created before Relay stored the dedicated DCode key expose the
    # same virtual key only as OPENAI_API_KEY. Accept that migration shape only
    # while DCode still carries NemoClaw's exact managed sentinel. The returned
    # placeholder remains bound to this provider's exact endpoint.
    legacy_name = "OPENAI_API_KEY"
    legacy_credential = os.environ.get(legacy_name, "")
    if (
        credential == "nemoclaw-managed-inference"
        and _is_openshell_placeholder_for_name(legacy_name, legacy_credential)
    ):
        return legacy_credential
    raise RuntimeError(
        "TaskLattice inference requires an endpoint-bound OpenShell credential placeholder"
    )


def ${compatibilityMarker}() -> str | None:
    """Resolve Relay's per-sandbox Provider v2 endpoint on OpenShell only.

    Provider v2 does not currently mount inference-capable providers at
    inference.local. Relay instead generates a non-secret, sandbox-local DCode
    config for the exact LiteLLM endpoint contributed by the attached provider.
    The credential remains an endpoint-bound OpenShell placeholder and is never
    read from this file.

    This is intentionally weaker than NemoClaw's root-owned baked route because
    the OpenShell identity owns config.toml. The endpoint-bound credential and
    effective egress policy remain authoritative. Remove this compatibility
    path when Provider v2 can mount attached providers at inference.local.
    """
    if not os.environ.get("OPENSHELL_SANDBOX"):
        return None

    _tali_managed_inference_api_key()

    path = Path("/sandbox/.deepagents/config.toml")
    flags = os.O_RDONLY | os.O_CLOEXEC
    if not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError("TaskLattice inference config cannot be opened safely")
    flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise RuntimeError("TaskLattice inference config is missing or unsafe") from exc
    try:
        before = os.fstat(descriptor)
        # DCode persists ordinary preferences with tempfile.mkstemp(), which
        # atomically replaces config.toml with the stricter 0600 mode. Relay's
        # bootstrap-generated file uses 0660 so the sandbox group can manage
        # initial state. Both modes keep write access scoped to the owner.
        config_mode = stat.S_IMODE(before.st_mode)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_uid != os.geteuid()
            or before.st_gid != os.getegid()
            or config_mode not in {0o600, 0o660}
            or before.st_size <= 0
            or before.st_size > 65_536
        ):
            raise RuntimeError(
                "TaskLattice inference config has unsafe ownership, mode, or size"
            )
        chunks: list[bytes] = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(descriptor)
        binding_before = (
            before.st_dev,
            before.st_ino,
            before.st_uid,
            before.st_gid,
            before.st_mode,
            before.st_nlink,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        binding_after = (
            after.st_dev,
            after.st_ino,
            after.st_uid,
            after.st_gid,
            after.st_mode,
            after.st_nlink,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if remaining or binding_before != binding_after:
            raise RuntimeError("TaskLattice inference config changed while reading")
        payload = b"".join(chunks)
    finally:
        os.close(descriptor)

    try:
        document = tomllib.loads(payload.decode("utf-8"))
        value = document["models"]["providers"]["openai"]["base_url"]
    except (KeyError, TypeError, UnicodeError, tomllib.TOMLDecodeError) as exc:
        raise RuntimeError("TaskLattice inference config is invalid") from exc
    if not isinstance(value, str):
        raise RuntimeError("TaskLattice inference config is invalid")
    return _validated_managed_inference_base_url(
        value, "TaskLattice inference base URL"
    )


def managed_inference_base_url() -> str:
    """Resolve the OpenShell route or validate the root-owned baked route."""
    openshell_value = ${compatibilityMarker}()
    if openshell_value is not None:
        return openshell_value

    path = _INFERENCE_BASE_URL_FILE
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("managed inference base URL file is missing or unsafe")
    try:
        metadata = path.stat()
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError("managed inference base URL file is unreadable") from exc
    if (
        metadata.st_uid != _MANAGED_FILE_OWNER_UID
        or stat.S_IMODE(metadata.st_mode) != 0o444
    ):
        raise RuntimeError("managed inference base URL file has unsafe ownership or mode")
    value = raw.rstrip("\\n")
    if not value or len(value) > 2048 or raw not in {value, f"{value}\\n"}:
        raise RuntimeError("managed inference base URL file has invalid contents")
    if value != value.strip() or any(ord(character) < 32 for character in value):
        raise RuntimeError("managed inference base URL file has invalid contents")
    return _validated_managed_inference_base_url(
        value, "managed inference base URL"
    )`;

const source = await readFile(target, "utf8");
if (source.includes(compatibilityMarker)) {
  throw new Error(
    "Refusing to patch NemoClaw: the TaskLattice Provider v2 inference compatibility path is already present; review and remove the downstream patch.",
  );
}
const importMatches = source.split(importAnchor).length - 1;
const functionMatches = source.split(upstreamFunction).length - 1;
if (importMatches !== 1 || functionMatches !== 1) {
  throw new Error(
    `Refusing to patch NemoClaw: expected one import anchor and one managed inference function, found ${importMatches} and ${functionMatches}.`,
  );
}

// Upstream v0.0.138 owns credential selection too. Preserve its native routes
// outside Relay; inject only the attached-provider branch on OpenShell.
const credentialAnchor = `def managed_inference_api_key(base_url: str) -> str:
    """Select the non-secret credential for the validated image-owned route."""`;
if (source.split(credentialAnchor).length !== 2) {
  throw new Error("Refusing to patch NemoClaw: expected one managed credential function.");
}
const configPatchSource = await readFile(configPatchTarget, "utf8");
if (!configPatchSource.includes('"api_key": managed_inference_api_key(base_url),')) {
  throw new Error("Refusing to patch NemoClaw: expected the upstream DCode credential selector.");
}
const patched = source
  .replace(importAnchor, `${importAnchor}\nimport tomllib`)
  .replace(upstreamFunction, patchedFunction)
  .replace(credentialAnchor, `${credentialAnchor}
    if os.environ.get("OPENSHELL_SANDBOX"):
        return _tali_managed_inference_api_key()`);
await writeFile(target, patched, "utf8");
console.log("Patched NemoClaw Deep Agents for TaskLattice Provider v2 inference routing.");
