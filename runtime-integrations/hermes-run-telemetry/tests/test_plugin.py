from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


PLUGIN_PATH = Path(__file__).parents[1] / "__init__.py"
SPEC = importlib.util.spec_from_file_location("tali_run_telemetry", PLUGIN_PATH)
assert SPEC is not None and SPEC.loader is not None
plugin = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(plugin)


class RunTelemetryPluginTest(unittest.TestCase):
    def setUp(self) -> None:
        plugin._started_at.clear()

    def test_reports_one_successful_run_per_turn(self) -> None:
        payloads = []
        with patch.object(plugin, "_deliver", payloads.append):
            plugin.on_pre_llm_call(turn_id="turn-1", platform="web")
            plugin.on_session_end(
                turn_id="turn-1",
                completed=True,
                interrupted=False,
            )

        self.assertEqual([item["event"] for item in payloads], ["started", "finished"])
        self.assertEqual(payloads[0]["triggerType"], "USER")
        self.assertEqual(payloads[1]["status"], "SUCCEEDED")
        self.assertGreaterEqual(payloads[1]["durationMs"], 0)

    def test_marks_interrupted_turn_as_cancelled(self) -> None:
        payloads = []
        with patch.object(plugin, "_deliver", payloads.append):
            plugin.on_pre_llm_call(turn_id="turn-2", platform="cron")
            plugin.on_session_end(
                turn_id="turn-2",
                completed=False,
                interrupted=True,
            )

        self.assertEqual(payloads[0]["triggerType"], "SCHEDULED")
        self.assertEqual(payloads[1]["status"], "CANCELLED")
        self.assertEqual(payloads[1]["terminalReason"], "CANCELLED")

    def test_registers_turn_boundary_hooks(self) -> None:
        registrations = []

        class Context:
            def register_hook(self, name, callback):
                registrations.append((name, callback))

        plugin.register(Context())
        self.assertEqual(
            [name for name, _callback in registrations],
            ["pre_llm_call", "on_session_end"],
        )


if __name__ == "__main__":
    unittest.main()
