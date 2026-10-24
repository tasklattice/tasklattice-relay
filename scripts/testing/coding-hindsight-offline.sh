#!/usr/bin/env bash
set -euo pipefail

for platform in deepagents pi; do
  harness="$platform"
  [[ "$platform" != deepagents ]] || harness=dcode
  docker run --rm -i --network none --entrypoint /bin/bash \
    -e TEST_HARNESS="$harness" \
    -e TALI_PROJECT_RUNTIME_BRIDGE_TOKEN=openshell:resolve:env:v1_TALI_PROJECT_RUNTIME_BRIDGE_TOKEN \
    "ghcr.io/tasklattice/tali-nemoclaw-${platform}-sandbox:dev" <<'SH'
set -eu
payload=$(python3 -c 'import json,base64,os; print(base64.b64encode(json.dumps({"harness":os.environ["TEST_HARNESS"],"enabled":True,"endpoint":"http://bridge.project.svc.cluster.local:8080/v1/hindsight/coordinators/agent-test","bankId":"agent-test"}).encode()).decode())')
tali-hindsight "$payload"
if [ "$TEST_HARNESS" = dcode ]; then
  dcode --version
  /opt/venv/bin/python - <<'PY'
import asyncio,json
from pathlib import Path
from deepagents_code.mcp_tools import resolve_and_load_mcp_tools

async def verify():
    tools,manager,infos=await resolve_and_load_mcp_tools(no_mcp=True,
        additional_configs=({'mcpServers':{'untrusted':{'command':'touch','args':['/tmp/untrusted-mcp']}}},))
    print('Native Hindsight tools:', [tool.name for tool in tools])
    assert len(tools) == 8 and all('hindsight' in tool.name for tool in tools)
    assert not Path('/tmp/untrusted-mcp').exists()
    assert all(info.status == 'ok' for info in infos)
    if manager:
        await manager.cleanup()
    config=Path('/sandbox/.hindsight/coding-agent.json')
    config.write_text(json.dumps({'disabled':True}))
    tools,_,_=await resolve_and_load_mcp_tools(no_mcp=True)
    assert tools == []
    print('Native mode: no MCP tools; arbitrary MCP config ignored')

asyncio.run(verify())
PY
else
  pi --version
  node -e 'import("/sandbox/.hindsight/coding-agents/dist/pi.js").then(m=>{if(typeof m.default!=="function") process.exit(1);console.log("Pi native extension imports without network")})'
fi
echo "$TEST_HARNESS: offline startup passed; no network interface"
SH
done
