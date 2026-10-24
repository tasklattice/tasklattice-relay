"""Security and persistence checks, also runnable against the installed image."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = os.environ.get("TALI_PI_RUNTIME_PATH", str(Path(__file__).resolve().parents[1] / "pi-runtime.py"))
loader = importlib.machinery.SourceFileLoader("pi_runtime", source)
spec = importlib.util.spec_from_loader(loader.name, loader)
runtime = importlib.util.module_from_spec(spec)
loader.exec_module(runtime)


class PiRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.reference = "openshell:resolve:env:s" + "a" * 64 + "_OPENAI_API_KEY"
        self.env = patch.dict(os.environ, {"OPENAI_API_KEY": self.reference})
        self.env.start()
        self.addCleanup(self.env.stop)

    def configure(self):
        runtime.configure("http://litellm.tali.svc.cluster.local:4000/v1", "relay-model", self.root)

    def test_configuration_uses_only_an_environment_reference(self):
        self.configure()
        state = self.root / ".pi/agent"
        models = (state / "models.json").read_text()
        self.assertIn("${OPENAI_API_KEY}", models)
        self.assertNotIn(self.reference, models)
        self.assertEqual((state / "models.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((state / "settings.json").read_text())["defaultProvider"], "openshell")

    def test_restart_preserves_sessions_and_preferences(self):
        self.configure()
        state = self.root / ".pi/agent"
        (state / "sessions").mkdir()
        (state / "sessions/old.jsonl").write_text('{"message":"remember"}\n')
        (state / "settings.json").write_text('{"theme":"dark"}')
        self.configure()
        self.assertIn("remember", (state / "sessions/old.jsonl").read_text())
        self.assertEqual(json.loads((state / "settings.json").read_text())["theme"], "dark")

    def test_raw_or_unscoped_credentials_are_rejected(self):
        for value in ["raw-provider-key", "openshell:resolve:env:OPENAI_API_KEY", "openshell:resolve:env:v1_OTHER_KEY", ""]:
            with patch.dict(os.environ, {"OPENAI_API_KEY": value}):
                with self.assertRaises(RuntimeError):
                    self.configure()

    def test_unsafe_endpoints_are_rejected(self):
        for endpoint in ["https://user:pass@example.com/v1", "https://example.com/?token=x", "file:///tmp/x", "https://example.com/#x", "http://example.com/\ninjected"]:
            with self.assertRaises(ValueError):
                runtime.configure(endpoint, "relay-model", self.root)

    def test_directory_and_config_symlinks_are_rejected(self):
        (self.root / "outside").mkdir()
        (self.root / ".pi").symlink_to(self.root / "outside", target_is_directory=True)
        with self.assertRaises(OSError):
            self.configure()
        (self.root / ".pi").unlink()
        self.configure()
        target = self.root / ".pi/agent/models.json"
        target.unlink()
        outside = self.root / "outside.json"
        outside.write_text("{}")
        target.symlink_to(outside)
        with self.assertRaises(OSError):
            self.configure()
        self.assertEqual(outside.read_text(), "{}")

    def test_hardlinks_and_public_config_are_rejected(self):
        self.configure()
        target = self.root / ".pi/agent/models.json"
        os.link(target, self.root / "alias")
        with self.assertRaises(RuntimeError):
            self.configure()
        (self.root / "alias").unlink()
        target.chmod(0o666)
        with self.assertRaises(RuntimeError):
            self.configure()

    def test_launcher_overrides_stored_auth_and_preserves_resume_flags(self):
        self.configure()
        (self.root / ".pi/agent/auth.json").write_text('{"openshell":{"type":"api_key","key":"untrusted-saved-key"}}')
        arguments = runtime.launch_arguments(["--continue"], self.root)
        self.assertIn("--continue", arguments)
        self.assertEqual(arguments[-2:], ["--api-key", self.reference])
        self.assertNotIn("untrusted-saved-key", arguments)

    def test_launcher_rejects_command_credentials_and_headers(self):
        self.configure()
        target = self.root / ".pi/agent/models.json"
        original = json.loads(target.read_text())
        for key, value in [("apiKey", "!echo injected"), ("headers", {"Authorization": "untrusted"})]:
            document = json.loads(json.dumps(original))
            document["providers"]["openshell"][key] = value
            target.write_text(json.dumps(document))
            with self.assertRaises(RuntimeError):
                runtime.launch_arguments([], self.root)


if __name__ == "__main__":
    unittest.main()
