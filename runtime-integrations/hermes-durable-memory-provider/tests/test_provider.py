from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import types
import unittest


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
# Host-side contract tests do not install Hermes. The build-time verifier runs
# against the pinned image; this tiny ABC stub lets transport behavior run in
# the ordinary repository test environment as well.
agent_module = types.ModuleType("agent")
memory_provider_module = types.ModuleType("agent.memory_provider")
memory_provider_module.MemoryProvider = type("MemoryProvider", (), {})
sys.modules.setdefault("agent", agent_module)
sys.modules.setdefault("agent.memory_provider", memory_provider_module)
spec = importlib.util.spec_from_file_location("tali_relay_test", PLUGIN_ROOT / "__init__.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RelayMemoryProvider = module.RelayMemoryProvider


class _Handler(BaseHTTPRequestHandler):
    requests: list[tuple[str, dict, str]] = []

    def log_message(self, format, *args):  # noqa: A002, ANN001
        pass

    def do_POST(self):  # noqa: N802
        size = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(size))
        type(self).requests.append((self.path, payload, self.headers.get("authorization", "")))
        if self.path.endswith("/recall"):
            self._json(200, {"context": "<tasklattice-memory-context>known fact</tasklattice-memory-context>", "degraded": False, "itemCount": 1})
        else:
            self._json(202, {"accepted": True, "conversationId": payload["conversationId"]})

    def _json(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class ProviderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        os.environ["TALI_DURABLE_MEMORY_ALLOW_LOOPBACK"] = "1"
        os.environ["TALI_DURABLE_MEMORY_ENDPOINT"] = (
            f"http://127.0.0.1:{cls.server.server_port}/v1/memory/coordinators/agent-a"
        )
        os.environ["TALI_DURABLE_MEMORY_TOKEN"] = "scoped-runtime-token"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        for key in (
            "TALI_DURABLE_MEMORY_ALLOW_LOOPBACK",
            "TALI_DURABLE_MEMORY_ENDPOINT",
            "TALI_DURABLE_MEMORY_TOKEN",
        ):
            os.environ.pop(key, None)

    def setUp(self):
        _Handler.requests.clear()
        self.provider = RelayMemoryProvider()
        self.provider.initialize("session-a", hermes_home="/tmp")

    def tearDown(self):
        self.provider.shutdown()

    def test_prefetch_and_background_retain_use_only_the_scoped_gateway(self):
        self.assertIn("known fact", self.provider.prefetch("What is known?"))
        self.provider.sync_turn(
            "User turn",
            "Assistant turn",
            session_id="session-a",
            messages=[{"role": "tool", "name": "search", "content": "evidence"}],
        )
        self.provider.shutdown()
        self.assertEqual([item[0].rsplit("/", 1)[-1] for item in _Handler.requests], ["recall", "retain"])
        self.assertTrue(all(item[2] == "Bearer scoped-runtime-token" for item in _Handler.requests))
        self.assertNotIn("bankId", json.dumps(_Handler.requests))
        self.assertEqual(_Handler.requests[1][1]["toolSummaries"], ["search: evidence"])

    def test_recall_is_fail_open(self):
        self.provider._endpoint = "http://127.0.0.1:1/v1/memory/coordinators/agent-a"
        self.assertEqual(self.provider.prefetch("query"), "")


if __name__ == "__main__":
    unittest.main()
