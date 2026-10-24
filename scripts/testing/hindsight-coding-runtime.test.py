"""Exercise activation and binding validation without network or credentials."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).parents[1] / 'hindsight-coding-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        (self.package / 'package.json').write_text('{"version":"0.8.2"}')
        self.payload = {'harness': 'dcode', 'enabled': True, 'bankId': 'instance-a',
                        'endpoint': 'http://bridge.project.svc.cluster.local:8080/v1/hindsight/coordinators/instance-a'}
        self.env = patch.dict(os.environ, {'TALI_PROJECT_RUNTIME_BRIDGE_TOKEN':
                                         'openshell:resolve:env:v1_TALI_PROJECT_RUNTIME_BRIDGE_TOKEN'})
        self.env.start()
        self.addCleanup(self.env.stop)

    @patch.object(runtime.subprocess, 'run')
    def test_enabled_uses_only_local_installer_and_bound_bank(self, run):
        runtime.configure(self.payload, self.root, self.package)
        config = json.loads((self.root / '.hindsight/coding-agent.json').read_text())
        self.assertFalse(config['autoUpdate'])
        self.assertFalse(config['manageBankConfig'])
        self.assertFalse(config['dynamicBankId'])
        self.assertEqual(config['bankId'], 'instance-a')
        self.assertEqual(run.call_args_list[0].args[0][:2], ['node', str(self.package / 'dist/installer.js')])
        self.assertEqual((self.root / '.hindsight/coding-agent.json').stat().st_mode & 0o777, 0o600)

    @patch.object(runtime.subprocess, 'run')
    def test_native_does_not_install_or_connect(self, run):
        runtime.configure({'harness': 'pi', 'enabled': False}, self.root, self.package)
        self.assertTrue(json.loads((self.root / '.hindsight/coding-agent.json').read_text())['disabled'])
        run.assert_not_called()

    @patch.object(runtime.subprocess, 'run')
    def test_rejects_cross_instance_endpoint_and_raw_tokens(self, run):
        for changes in ({'bankId': 'instance-b'}, {'endpoint': 'https://example.com'}, {'bankId': '../other'}):
            with self.assertRaises(ValueError):
                runtime.configure({**self.payload, **changes}, self.root, self.package)
        with patch.dict(os.environ, {'TALI_PROJECT_RUNTIME_BRIDGE_TOKEN': 'raw-secret'}):
            with self.assertRaises(ValueError):
                runtime.configure(self.payload, self.root, self.package)
        run.assert_not_called()

    def test_refuses_symlinked_state(self):
        (self.root / '.hindsight').symlink_to(self.package)
        with self.assertRaises(ValueError):
            runtime.configure(self.payload, self.root, self.package)
        self.assertFalse((self.package / 'coding-agent.json').exists())


if __name__ == '__main__':
    unittest.main()
