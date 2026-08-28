from __future__ import annotations

import importlib.util
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import ClientSession, ClientTimeout, CookieJar, WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer


MODULE_PATH = Path(__file__).with_name("hermes-webui-auth-proxy.py")
SPEC = importlib.util.spec_from_file_location("hermes_webui_auth_proxy", MODULE_PATH)
assert SPEC and SPEC.loader
proxy = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = proxy
SPEC.loader.exec_module(proxy)


class HermesWebUiAuthProxyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        upstream_app = web.Application()
        self.websocket_headers: list[dict[str, str]] = []

        async def dashboard(_request: web.Request) -> web.Response:
            return web.Response(text="dashboard")

        upstream_app.router.add_get("/", dashboard)

        async def stream(request: web.Request) -> web.StreamResponse:
            response = web.StreamResponse(headers={"content-type": "text/event-stream"})
            await response.prepare(request)
            await response.write(b"data: ready\n\n")
            await response.write_eof()
            return response

        async def websocket(request: web.Request) -> web.WebSocketResponse:
            self.websocket_headers.append(
                {
                    "origin": request.headers.get("origin", ""),
                    "x-forwarded-host": request.headers.get("x-forwarded-host", ""),
                    "x-forwarded-proto": request.headers.get("x-forwarded-proto", ""),
                }
            )
            channel = web.WebSocketResponse()
            await channel.prepare(request)
            async for message in channel:
                if message.type == WSMsgType.TEXT:
                    await channel.send_str(f"echo:{message.data}")
            return channel

        async def cookies(request: web.Request) -> web.Response:
            return web.json_response(dict(request.cookies))

        upstream_app.router.add_get("/events", stream)
        upstream_app.router.add_get("/ws", websocket)
        upstream_app.router.add_get("/cookies", cookies)
        self.upstream = TestServer(upstream_app)
        await self.upstream.start_server()

        self.secret = b"instance-secret-with-at-least-thirty-two-bytes"
        timeout = ClientTimeout(total=None, connect=5, sock_connect=5)
        upstream_client = ClientSession(timeout=timeout, auto_decompress=False)
        proxy_app = web.Application()
        proxy_app[proxy.PROXY_STATE_KEY] = proxy.ProxyState(
            secret=self.secret,
            upstream=str(self.upstream.make_url("")).rstrip("/"),
            client=upstream_client,
            secure_cookie=False,
        )
        proxy_app.router.add_route("*", "/{path:.*}", proxy._handle)
        proxy_app.on_cleanup.append(proxy._close_client)
        self.client = TestClient(
            TestServer(proxy_app), cookie_jar=CookieJar(unsafe=True)
        )
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        await self.upstream.close()

    def access_token(self, nonce: str = "one-time") -> str:
        now = int(time.time())
        return proxy._signed_token(
            self.secret,
            {
                "aud": proxy.AUDIENCE,
                "exp": now + 300,
                "iat": now,
                "jti": nonce,
                "sub": "bound-user",
                "typ": "access",
            },
        )

    async def authenticate(self) -> None:
        response = await self.client.get(
            "/", params={proxy.ACCESS_QUERY: self.access_token()}
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.text(), "dashboard")
        self.assertNotIn(proxy.ACCESS_QUERY, str(response.url))

    async def test_exchanges_once_and_forwards_streams_and_cookies(self) -> None:
        token = self.access_token()
        response = await self.client.get("/", params={proxy.ACCESS_QUERY: token})
        self.assertEqual(response.status, 200)
        self.assertEqual(await response.text(), "dashboard")

        repeated = await self.client.get("/", params={proxy.ACCESS_QUERY: token})
        self.assertEqual(repeated.status, 200)
        self.assertEqual(await repeated.text(), "dashboard")

        async with ClientSession(cookie_jar=CookieJar(unsafe=True)) as replay:
            denied = await replay.get(
                self.client.make_url("/"), params={proxy.ACCESS_QUERY: token}
            )
            self.assertEqual(denied.status, 401)

        events = await self.client.get("/events")
        self.assertEqual(events.status, 200)
        self.assertEqual(await events.text(), "data: ready\n\n")

        self.client.session.cookie_jar.update_cookies({"dashboard_pref": "compact"})
        received = await self.client.get("/cookies")
        cookies = await received.json()
        self.assertEqual(cookies, {"dashboard_pref": "compact"})

    async def test_forwards_authenticated_websockets(self) -> None:
        await self.authenticate()
        external_origin = str(self.client.make_url("/").origin())
        channel = await self.client.ws_connect("/ws", origin=external_origin)
        await channel.send_str("hello")
        message = await channel.receive(timeout=2)
        self.assertEqual(message.data, "echo:hello")
        await channel.close()
        self.assertEqual(
            self.websocket_headers,
            [
                {
                    "origin": str(self.upstream.make_url("/").origin()),
                    "x-forwarded-host": self.client.make_url("/").host_port_subcomponent,
                    "x-forwarded-proto": "http",
                }
            ],
        )

    async def test_accepts_gateway_forwarded_external_websocket_authority(
        self,
    ) -> None:
        await self.authenticate()
        external_authority = "dynamic--webui.openshell.localhost:8080"
        channel = await self.client.ws_connect(
            "/ws",
            origin=f"http://{external_authority}",
            headers={
                "x-forwarded-host": external_authority,
                # A nested localhost gateway can report a different transport
                # scheme even though the browser authority is still exact.
                "x-forwarded-proto": "https",
            },
        )
        await channel.send_str("hello")
        message = await channel.receive(timeout=2)
        self.assertEqual(message.data, "echo:hello")
        await channel.close()
        self.assertEqual(
            self.websocket_headers[-1]["origin"],
            str(self.upstream.make_url("/").origin()),
        )

    async def test_accepts_dynamic_route_for_current_sandbox_hostname(self) -> None:
        await self.authenticate()
        with patch.object(
            proxy.socket,
            "gethostname",
            return_value="project--instance",
        ):
            channel = await self.client.ws_connect(
                "/ws",
                origin=(
                    "http://project--instance--webui."
                    "openshell.localhost:8080"
                ),
            )
        await channel.send_str("hello")
        message = await channel.receive(timeout=2)
        self.assertEqual(message.data, "echo:hello")
        await channel.close()

    async def test_rejects_websocket_origin_that_does_not_match_external_host(
        self,
    ) -> None:
        await self.authenticate()
        channel = await self.client.ws_connect("/ws", origin="https://attacker.example")
        message = await channel.receive(timeout=2)
        self.assertEqual(message.type, WSMsgType.CLOSE)
        self.assertEqual(channel.close_code, 4403)
        self.assertEqual(self.websocket_headers, [])

    async def test_rejects_missing_and_expired_access(self) -> None:
        missing = await self.client.get("/")
        self.assertEqual(missing.status, 401)

        now = int(time.time())
        expired = proxy._signed_token(
            self.secret,
            {
                "aud": proxy.AUDIENCE,
                "exp": now - 1,
                "iat": now - 301,
                "jti": "expired",
                "sub": "bound-user",
                "typ": "access",
            },
        )
        denied = await self.client.get("/", params={proxy.ACCESS_QUERY: expired})
        self.assertEqual(denied.status, 401)


if __name__ == "__main__":
    unittest.main()
