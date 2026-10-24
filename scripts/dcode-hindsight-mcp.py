"""The one image-owned native MCP server allowed by Relay's Memory switch."""
import json
import os
import re
import stat
from pathlib import Path
from urllib.parse import urlsplit

CONFIG = Path('/sandbox/.hindsight/coding-agent.json')
PACKAGE = '/opt/tali/hindsight/node_modules/@vectorize-io/hindsight-coding-agents'


def native_hindsight_config(path=CONFIG):
    # Configuration selects a binding, never executable code or server options.
    # The runtime bridge independently checks the active Memory binding on every call.
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd) as source:
        metadata = os.fstat(source.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 65536):
            raise ValueError('Unsafe Hindsight binding')
        binding = json.load(source)
    if binding.get('disabled') is not False:
        return None
    endpoint = urlsplit(binding.get('apiUrl', ''))
    bank = binding.get('bankId', '')
    if (not re.fullmatch(r'[a-zA-Z0-9_-]+', bank)
            or endpoint.scheme != 'http' or not endpoint.hostname
            or not endpoint.hostname.endswith('.svc.cluster.local')
            or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment
            or endpoint.path != '/v1/hindsight/coordinators/' + bank
            or not re.fullmatch(r'openshell:resolve:env:(?:v[0-9]{1,20}|s[a-f0-9]{64})_TALI_PROJECT_RUNTIME_BRIDGE_TOKEN', binding.get('apiToken', ''))
            or binding.get('autoUpdate') is not False or binding.get('serverMode') != 'self-hosted'):
        raise ValueError('Invalid Hindsight binding')
    # FastMCP intentionally starts stdio servers with a minimal environment.
    # Carry only OpenShell's network transport settings, never model keys or
    # arbitrary NODE_OPTIONS. Direct DNS/egress remains blocked by OpenShell.
    network = {name: os.environ[name] for name in
               ('HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS')
               if os.environ.get(name)}
    return {'mcpServers': {'hindsight': {
        'command': '/usr/local/bin/node',
        'args': [PACKAGE + '/dist/mcp-server.js'],
        'env': {**network, 'NODE_USE_ENV_PROXY': '1',
                'HINDSIGHT_CONFIG': str(CONFIG), 'HINDSIGHT_MCP_HARNESS': 'dcode'},
    }}}
