"""Memory state cannot select commands or bypass the image-owned MCP adapter."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('adapter', Path(__file__).parents[1] / 'dcode-hindsight-mcp.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class MCPBindingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'binding.json'
        self.binding = {'disabled': False, 'autoUpdate': False, 'serverMode': 'self-hosted',
                        'bankId': 'instance-a', 'apiUrl': 'http://bridge.project.svc.cluster.local:8080/v1/hindsight/coordinators/instance-a',
                        'apiToken': 'openshell:resolve:env:v1_TALI_PROJECT_RUNTIME_BRIDGE_TOKEN'}

    def write(self, **changes):
        self.path.write_text(json.dumps({**self.binding, **changes}))
        self.path.chmod(0o600)

    @patch.dict(os.environ, {'HTTP_PROXY': 'http://10.200.0.1:3128', 'OPENAI_API_KEY': 'never-forward', 'NODE_OPTIONS': '--require=evil.js'}, clear=True)
    def test_command_and_environment_are_image_owned(self):
        self.write(command='curl', args=['https://attacker.test'], env={'NODE_OPTIONS': '--require=evil.js'})
        server = adapter.native_hindsight_config(self.path)['mcpServers']['hindsight']
        self.assertEqual(server['command'], '/usr/local/bin/node')
        self.assertEqual(server['args'], [adapter.PACKAGE + '/dist/mcp-server.js'])
        self.assertEqual(server['env'], {'HINDSIGHT_CONFIG': str(adapter.CONFIG), 'HINDSIGHT_MCP_HARNESS': 'dcode',
                                         'HTTP_PROXY': 'http://10.200.0.1:3128', 'NODE_USE_ENV_PROXY': '1'})

    def test_native_mode_and_missing_state_load_no_tools(self):
        self.assertIsNone(adapter.native_hindsight_config(self.path))
        self.write(disabled=True)
        self.assertIsNone(adapter.native_hindsight_config(self.path))

    def test_rejects_raw_credentials_remote_endpoints_and_mutable_plugin(self):
        for changes in ({'apiToken': 'raw-secret'}, {'bankId': 'other-instance'},
                        {'apiUrl': 'https://public.example.com'}, {'autoUpdate': True}):
            self.write(**changes)
            with self.assertRaises(ValueError):
                adapter.native_hindsight_config(self.path)

    def test_rejects_shared_or_symlinked_config(self):
        self.write()
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            adapter.native_hindsight_config(self.path)
        other = self.path.with_name('link.json')
        other.symlink_to(self.path)
        with self.assertRaises(OSError):
            adapter.native_hindsight_config(other)


if __name__ == '__main__':
    unittest.main()
