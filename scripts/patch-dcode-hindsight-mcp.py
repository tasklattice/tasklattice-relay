"""Adapt pinned NemoClaw Dcode without opening arbitrary MCP discovery."""
from pathlib import Path
import sys
import textwrap


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Pinned Dcode MCP source changed; review the adapter')
    return source.replace(old, new, 1)


root = Path(sys.argv[1])
target = root / 'mcp_tools.py'
source = target.read_text()
source = replace_once(source, '    if no_mcp:\n        return [], None, []\n', '''    from deepagents_code._tali_hindsight_mcp import native_hindsight_config

    native_memory = await asyncio.to_thread(native_hindsight_config)
    if no_mcp:
        if native_memory is None:
            return [], None, []
        # Only the image-owned native plugin is allowed. Ignore all user/plugin
        # MCP configuration, including explicit paths and additional_configs.
        return await _load_tools_from_config(
            native_memory, stateless=stateless, session_manager=session_manager
        )
''')
source = replace_once(source, '    merged = merge_mcp_configs(configs)\n    if not merged.get("mcpServers"):', '''    if native_memory is not None:
        configs.append(native_memory)
    merged = merge_mcp_configs(configs)
    if not merged.get("mcpServers"):''')
# A managed deployment can have no other active servers.
source = replace_once(source, '    if not configs:\n        return [], None, _bad_config_infos()', '    if not configs and native_memory is None:\n        return [], None, _bad_config_infos()')
target.write_text(source)

target = root / 'server_graph.py'
source = target.read_text()
start = source.index('    if not config.no_mcp:\n')
end = source.index('\n    return tools, mcp_server_info, mcp_tools, read_only_builtins', start)
block = textwrap.dedent(source[start:end].split('\n', 1)[1])
block = replace_once(block, '''plugin_mcp_configs = await asyncio.to_thread(
    discover_plugin_mcp_configs, project_dir=project_dir
)''', '''plugin_mcp_configs = ()
if not config.no_mcp:
    plugin_mcp_configs = await asyncio.to_thread(
        discover_plugin_mcp_configs, project_dir=project_dir
    )''')
source = source[:start] + textwrap.indent(block, '    ') + '\n' + source[end:]
target.write_text(source)
