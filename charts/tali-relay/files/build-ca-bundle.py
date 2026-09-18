"""Validate custom PEM roots and append them without hiding the system store."""
from pathlib import Path
import ssl
import certifi

custom = Path("/etc/tali-ca/ca.crt")
# Fail with an actionable X.509 error before LiteLLM starts.
ssl.create_default_context(cafile=str(custom))
paths = [Path(certifi.where())]
system = ssl.get_default_verify_paths().cafile
if system and Path(system) not in paths:
    paths.append(Path(system))
bundle = b"\n".join(path.read_bytes() for path in [*paths, custom]) + b"\n"
output = Path("/var/run/tali-ca/ca-bundle.pem")
output.write_bytes(bundle)
ssl.create_default_context(cafile=str(output))
print("Validated custom CA and built a bundle retaining public roots")
