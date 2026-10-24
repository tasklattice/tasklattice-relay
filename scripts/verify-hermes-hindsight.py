#!/opt/hermes/.venv/bin/python3
"""Exercise the unmodified bundled Hindsight provider and its pinned HTTP SDK."""
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path

sys.path.insert(0, '/opt/hermes')
assert version('hindsight-client') == '0.6.1'
assert not Path('/opt/hermes/plugins/memory/tali_relay').exists()
requests = []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def respond(self, value):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())
    def do_GET(self):
        assert self.headers.get('Authorization') == 'Bearer build-probe-token'
        requests.append(('GET', self.path))
        self.respond({'version': '0.9.2'} if self.path == '/version' else {'status': 'completed', 'operation_id': 'op-test'})
    def do_POST(self):
        assert self.headers.get('Authorization') == 'Bearer build-probe-token'
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(('POST', self.path))
        if self.path.endswith('/memories/recall'):
            self.respond({'results': [{'id': 'fixture', 'text': 'The launch codename is sapphire.', 'type': 'world'}]})
        elif self.path.endswith('/reflect'):
            self.respond({'text': 'The launch codename is sapphire.'})
        elif self.path.endswith('/memories'):
            assert body['items'][0]['content']
            self.respond({'success': True, 'bank_id': 'agent-test', 'items_count': len(body['items']), 'async': True, 'operation_id': 'op-test'})
        else: raise AssertionError(self.path)

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory() as home:
    os.environ.update(HERMES_HOME=home, HINDSIGHT_MODE='local_external',
        HINDSIGHT_API_URL=f'http://127.0.0.1:{server.server_port}',
        HINDSIGHT_API_KEY='build-probe-token', HINDSIGHT_BANK_ID='agent-test')
    from plugins.memory import load_memory_provider
    provider = load_memory_provider('hindsight')
    assert provider and provider.name == 'hindsight'
    provider.initialize('build-probe')
    assert provider._mode == 'local_external'
    assert 'sapphire' in provider._do_recall('launch codename').text
    provider.sync_turn('The launch codename is sapphire.', 'Remembered.')
    provider._wait_for_retains_drained(10)
    assert ('POST', '/v1/default/banks/agent-test/memories') in requests, requests
    assert ('GET', '/v1/default/banks/agent-test/operations/op-test') in requests, requests
    provider.shutdown()
    print('Native Hindsight provider: initialize, recall, retain and async polling passed.')
server.shutdown()
