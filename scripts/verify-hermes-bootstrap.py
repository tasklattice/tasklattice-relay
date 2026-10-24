#!/opt/hermes/.venv/bin/python3
"""Exercise Relay bootstrap against the image's actual upstream configuration."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

import yaml


def sha(data):
    return hashlib.sha256(data).hexdigest()


with tempfile.TemporaryDirectory(prefix="tali-hermes-bootstrap-") as directory:
    state = Path(directory) / ".hermes"
    state.mkdir(mode=0o700)
    config, env, anchor = (state / name for name in ("config.yaml", ".env", ".config-hash"))
    for path in (config, env):
        path.write_bytes((Path("/sandbox/.hermes") / path.name).read_bytes())
        path.chmod(0o600)
    anchor.write_text(f"{sha(config.read_bytes())}  {config}\n{sha(env.read_bytes())}  {env}\n")
    anchor.chmod(0o600)
    command = [
        "/usr/local/lib/tali/bootstrap-hermes-config.py",
        "--config", str(config), "--hash-file", str(anchor),
        "--endpoint", "http://tali-litellm:4000/v1", "--model", "tali-bootstrap-probe",
        "--template-endpoint", "https://inference.local/v1",
        "--template-model", "deepseek-chat",
    ]
    environment = {**os.environ, "OPENAI_API_KEY": "openshell:resolve:env:s" + "a" * 64 + "_OPENAI_API_KEY"}
    subprocess.run(command, env=environment, check=True, capture_output=True)
    assert yaml.safe_load(config.read_text())["memory"]["provider"] == ""
    subprocess.run(command + [
        "--durable-memory-provider", "hindsight", "--durable-memory-endpoint",
        "http://runtime-bridge.project.svc.cluster.local:8080/v1/hindsight/coordinators/agent-a",
    ], env=environment, check=True, capture_output=True)
    assert yaml.safe_load(config.read_text())["memory"]["provider"] == "hindsight"
    assert anchor.read_text() == f"{sha(config.read_bytes())}  {config}\n{sha(env.read_bytes())}  {env}\n"
    config.write_text(config.read_text() + "\n# unauthorized change\n")
    rejected = subprocess.run(command, env=environment, capture_output=True, text=True)
    assert rejected.returncode != 0 and "already differ" in rejected.stderr
print("Hermes real-image bootstrap, native/Hindsight and integrity checks passed.")
