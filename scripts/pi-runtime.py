#!/usr/bin/python3
"""Configure and launch native Pi with Relay's endpoint-bound Provider reference."""

import base64
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid
from urllib.parse import urlsplit

ROOT = Path("/sandbox")
MAX_CONFIG_BYTES = 262144
REFERENCE = re.compile(r"openshell:resolve:env:(?:v[0-9]{1,20}|s[a-f0-9]{64})_OPENAI_API_KEY")


def credential():
    value = os.environ.get("OPENAI_API_KEY", "")
    if not REFERENCE.fullmatch(value):
        raise RuntimeError("Pi requires an endpoint-bound OpenShell Provider reference")
    return value


def route(endpoint, model):
    if not isinstance(endpoint, str) or len(endpoint) > 2048 or re.search(r"[\s\\\x00-\x1f\x7f]", endpoint):
        raise ValueError("Invalid Pi inference endpoint")
    parsed = urlsplit(endpoint)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment):
        raise ValueError("Invalid Pi inference endpoint")
    _ = parsed.port
    if not isinstance(model, str) or not 1 <= len(model) <= 160 or re.search(r"[\x00-\x1f\x7f]", model):
        raise ValueError("Invalid Pi model")
    return {"endpoint": endpoint.rstrip("/"), "model": model}


def directory(parent, name):
    try:
        os.mkdir(name, 0o700, dir_fd=parent)
    except FileExistsError:
        pass
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        metadata = os.fstat(fd)
        if metadata.st_uid != os.geteuid() or metadata.st_gid != os.getegid():
            raise RuntimeError("Unexpected Pi directory owner")
        # Kubelet may re-add fsGroup permissions when remounting the PVC.
        os.fchmod(fd, 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_document(fd, name, optional=False):
    try:
        file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except FileNotFoundError:
        if optional:
            return {}
        raise
    try:
        before = os.fstat(file)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != os.geteuid() or before.st_gid != os.getegid()
                or before.st_mode & 0o007 or before.st_size > MAX_CONFIG_BYTES):
            raise RuntimeError("Unsafe Pi configuration file")
        payload = os.read(file, MAX_CONFIG_BYTES + 1)
        after = os.fstat(file)
        if (len(payload) != before.st_size or before.st_mtime_ns != after.st_mtime_ns
                or before.st_ctime_ns != after.st_ctime_ns):
            raise RuntimeError("Pi configuration changed while reading")
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise ValueError("Pi configuration must be an object")
        return value
    finally:
        os.close(file)


def write_document(fd, name, value):
    # Refuse pre-existing links even though atomic replacement would not follow them.
    read_document(fd, name, optional=True)
    temporary = f".{name}.{uuid.uuid4().hex}.tmp"
    file = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(file, "w") as output:
            json.dump(value, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.rename(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=fd)
        except FileNotFoundError:
            pass


def with_state(root=ROOT):
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        pi_fd = directory(root_fd, ".pi")
        try:
            return directory(pi_fd, "agent")
        finally:
            os.close(pi_fd)
    finally:
        os.close(root_fd)


def configure(endpoint, model, root=ROOT):
    selected = route(endpoint, model)
    credential()
    fd = with_state(root)
    try:
        settings = read_document(fd, "settings.json", optional=True)
        settings.update(defaultProvider="openshell", defaultModel=selected["model"])
        write_document(fd, "models.json", {"providers": {"openshell": {
            "api": "openai-completions", "apiKey": "${OPENAI_API_KEY}",
            "baseUrl": selected["endpoint"], "models": [{"id": selected["model"]}],
        }}})
        write_document(fd, "settings.json", settings)
    finally:
        os.close(fd)
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.close(directory(root_fd, "workspace"))
    finally:
        os.close(root_fd)


def launch_arguments(arguments, root=ROOT):
    reference = credential()
    fd = with_state(root)
    try:
        catalog = read_document(fd, "models.json")
        provider = catalog["providers"]["openshell"]
        model = provider["models"][0]["id"]
        route(provider["baseUrl"], model)
        if (set(catalog) != {"providers"} or set(catalog["providers"]) != {"openshell"}
                or set(provider) != {"api", "apiKey", "baseUrl", "models"}
                or provider["api"] != "openai-completions"
                or provider["apiKey"] != "${OPENAI_API_KEY}"
                or provider["models"] != [{"id": model}]):
            raise RuntimeError("Pi managed model configuration was changed")
    finally:
        os.close(fd)
    # Native auth.json must not override the attached Provider. This argument is
    # an opaque endpoint-bound reference, never a raw model credential.
    return ["/usr/local/bin/pi", *arguments, "--provider", "openshell", "--model", model,
            "--api-key", reference]


def main():
    if sys.argv[1:2] == ["configure"]:
        payload = json.loads(base64.b64decode(sys.argv[2], validate=True))
        configure(payload["endpoint"], payload["model"])
    elif sys.argv[1:2] == ["check"]:
        launch_arguments([])
    else:
        arguments = launch_arguments(sys.argv[1:])
        os.chdir(ROOT / "workspace")
        os.environ["PI_CODING_AGENT_DIR"] = str(ROOT / ".pi/agent")
        os.environ["PI_CODING_AGENT_SESSION_DIR"] = str(ROOT / ".pi/agent/sessions")
        os.execv(arguments[0], arguments)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, IndexError, OSError, RuntimeError):
        # Configuration can contain secrets planted by a user. Keep errors generic.
        sys.exit("Pi managed configuration is unavailable or unsafe. Check the Instance configuration.")
