#!/opt/hermes/.venv/bin/python3
"""Build-time ABI and transport probe for Relay's Hermes MemoryProvider."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading


class _Handler(BaseHTTPRequestHandler):
    retained = threading.Event()

    def log_message(self, format, *args):  # noqa: A002, ANN001
        pass

    def do_POST(self):  # noqa: N802
        size = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(size))
        if self.headers.get("authorization") != "Bearer build-probe-token":
            self._send(401, {"error": "unauthorized"})
        elif self.path.endswith("/recall"):
            self._send(200, {"context": "build probe context", "degraded": False, "itemCount": 1})
        elif self.path.endswith("/retain") and body.get("conversationId"):
            type(self).retained.set()
            self._send(202, {"accepted": True, "conversationId": body["conversationId"]})
        else:
            self._send(400, {"error": "bad request"})

    def _send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        os.environ["TALI_DURABLE_MEMORY_ALLOW_LOOPBACK"] = "1"
        os.environ["TALI_DURABLE_MEMORY_ENDPOINT"] = (
            f"http://127.0.0.1:{server.server_port}/v1/memory/coordinators/build"
        )
        os.environ["TALI_DURABLE_MEMORY_TOKEN"] = "build-probe-token"
        from plugins.memory import load_memory_provider

        provider = load_memory_provider("tali_relay")
        if provider is None or provider.name != "tali_relay":
            raise RuntimeError("Relay MemoryProvider failed the pinned Hermes ABI probe")
        provider.initialize("build-session", hermes_home="/tmp", platform="build")
        if provider.prefetch("probe") != "build probe context":
            raise RuntimeError("Relay MemoryProvider recall probe failed")
        provider.sync_turn("user", "assistant", session_id="build-session")
        if not _Handler.retained.wait(timeout=3):
            raise RuntimeError("Relay MemoryProvider retain probe failed")
        provider.shutdown()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
