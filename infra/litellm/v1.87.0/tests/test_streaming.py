"""Run inside the pinned LiteLLM image; actual loopback WebSocket peer and real LiteLLM wrappers."""
import asyncio
import datetime
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from aiohttp import web
from fastapi import HTTPException

from litellm.exceptions import APIError, GuardrailRaisedException, MidStreamFallbackError
from litellm.litellm_core_utils.litellm_logging import Logging
from litellm.litellm_core_utils.streaming_handler import CustomStreamWrapper
from litellm.proxy.guardrails.guardrail_hooks.tasklattice_guard import streaming
from litellm.proxy.guardrails.guardrail_hooks.tasklattice_guard.tasklattice_guard import TaskLatticeGuard
from litellm.types.utils import ModelResponseStream
from litellm.router import Router


def chunk(text="", finish=None, **delta):
    return ModelResponseStream(id="chat-test", created=123, model="test-model", choices=[{
        "index": 0, "delta": {"content": text, **delta}, "finish_reason": finish,
    }])


class Upstream:
    def __init__(self, frames):
        self.frames = iter(frames)
        self.closed = False
        self.consumed = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            value = next(self.frames)
        except StopIteration:
            raise StopAsyncIteration
        self.consumed += 1
        if isinstance(value, Exception):
            raise value
        return value

    async def aclose(self):
        self.closed = True


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mode = "full_buffered"
        self.transform = lambda text: text
        self.block = False
        self.fault = None
        self.sent, self.received, self.starts = [], [], []
        self.disconnected = asyncio.Event()
        self.gate = asyncio.Event(); self.gate.set()
        async def handler(request):
            self.assertEqual(request.headers["x-api-key"], "synthetic")
            socket = web.WebSocketResponse()
            await socket.prepare(request)
            start = await socket.receive_json(); self.starts.append(start)
            self.assertEqual(start["protocol"], "litellm")
            self.assertEqual(start["call_id"], "call-1")
            self.assertEqual(start["request_data"]["user_api_key_team_id"], "team-1")
            stream_id = start["stream_id"]
            async def send(event):
                event = {"stream_id": stream_id, **event}
                if self.fault: event = self.fault(event)
                if event is None: return
                self.sent.append(event)
                await socket.send_json(event)
            await send({"type": "ready", "version": 1, "input_credits": 8, "mode": self.mode,
                        "requested_mode": self.mode, "effective_release_id": "release-1", "model_revision_id": None})
            sequence = released = 0
            text = ""
            try:
                async for raw in socket:
                    if raw.type != web.WSMsgType.TEXT: break
                    import json
                    event = json.loads(raw.data); self.received.append(event)
                    await self.gate.wait()
                    await send({"type": "ack", "sequence": event["sequence"]})
                    if self.block:
                        await send({"type": "blocked", "sequence": sequence, "checks": 1,
                                    "released_characters": released, "transformed": False})
                        break
                    text += event.get("text", "")
                    approved = self.transform(text) if self.mode == "full_buffered" and event["type"] == "end" else event.get("text", "") if self.mode == "window_buffered" else ""
                    if approved:
                        await send({"type": "delta", "sequence": sequence, "text": approved})
                        sequence += 1; released += len(approved)
                    if event["type"] == "end":
                        await send({"type": "completed", "sequence": sequence, "checks": 1,
                                    "released_characters": released, "transformed": self.transform(text) != text})
                        break
            except (ConnectionResetError, RuntimeError):
                pass
            finally:
                self.disconnected.set()
                await socket.close()
            return socket
        app = web.Application(); app.router.add_get("/endpoint/guardrails/output-stream", handler)
        self.server = web.AppRunner(app); await self.server.setup()
        site = web.TCPSite(self.server, "127.0.0.1", 0); await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.provider = TaskLatticeGuard(credential_name="test-only", api_base=f"http://127.0.0.1:{port}/endpoint",
            guardrail_name="TaskLattice Guard", default_on=True)
        self.provider.should_run_guardrail = Mock(return_value=True)
        self.provider._build_request_headers = Mock(return_value={"x-api-key": "synthetic"})
        self.provider._extract_user_api_key_metadata = Mock(return_value={"user_api_key_team_id": "team-1"})
        self.data = {"model": "test-model", "messages": [{"role": "user", "content": "safe input"}],
                     "litellm_logging_obj": SimpleNamespace(litellm_call_id="call-1")}

    async def asyncTearDown(self):
        self.gate.set()
        await self.server.cleanup()

    async def collect(self, upstream):
        return [item async for item in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)]

    def content(self, frames):
        return "".join(c.delta.content or "" for f in frames for c in f.choices)

    async def test_full_response_withholds_prefix_and_transforms(self):
        self.transform = lambda text: text.replace("alice@example.com", "[EMAIL]")
        upstream = Upstream([chunk("Contact ali"), chunk("ce@example.com"), chunk(finish="stop")])
        result = await self.collect(upstream)
        self.assertEqual(self.content(result), "Contact [EMAIL]")
        self.assertEqual([e["type"] for e in self.received], ["delta", "delta", "end"])
        self.assertEqual(len(self.starts), 1)
        self.assertTrue(upstream.closed)
        self.assertEqual(result[-1].choices[0].finish_reason, "stop")

    async def test_early_block_cancels_bounded_producer(self):
        self.block = True; self.mode = "window_buffered"
        upstream = Upstream([chunk("unsafe")]*100 + [chunk(finish="stop")])
        observed = []
        with self.assertRaises(GuardrailRaisedException):
            async for frame in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data):
                observed.append(frame)
        self.assertEqual(self.content(observed), "")
        self.assertLessEqual(upstream.consumed, 9)
        self.assertTrue(upstream.closed)

    async def test_incremental_only_emits_approved_new_text(self):
        self.mode = "window_buffered"
        result = await self.collect(Upstream([chunk("one"), chunk("two"), chunk(finish="stop")]))
        self.assertEqual(self.content(result), "onetwo")

    async def test_invalid_ack_identity_ready_or_completion_fails_closed(self):
        for kind in ("ack", "identity", "ready", "completion", "sequence", "early-text", "error"):
            with self.subTest(kind=kind):
                def fault(event):
                    if kind == "ack" and event["type"] == "ack": event["sequence"] = 99
                    if kind == "identity": event["stream_id"] = "wrong"
                    if kind == "ready": event["effective_release_id"] = None
                    if kind == "completion" and event["type"] == "completed": event["released_characters"] = 99
                    if kind == "sequence" and event["type"] == "delta": event["sequence"] = True
                    if kind == "early-text" and event["type"] == "ack": event = {"type": "completed", "stream_id": event["stream_id"], "sequence": 0, "checks": 1}
                    if kind == "error" and event["type"] == "ack": event = {"type": "error", "stream_id": event["stream_id"], "sequence": 0, "checks": 1, "message": "private backend credentials"}
                    return event
                self.fault = fault
                upstream = Upstream([chunk("secret"), chunk(finish="stop")])
                with self.assertRaises(APIError) as caught: await self.collect(upstream)
                self.assertNotIn("private", str(caught.exception))
                self.assertTrue(upstream.closed)

    async def test_ready_requires_strict_protocol_types_before_reading_model(self):
        for field, value in (("version", True), ("version", 1.0), ("input_credits", 8.0),
                             ("model_revision_id", {}), ("requested_mode", "unknown")):
            with self.subTest(field=field, value=value):
                self.fault = lambda event: {**event, field: value} if event["type"] == "ready" else event
                upstream = Upstream([chunk("private"), chunk(finish="stop")])
                with self.assertRaises(APIError): await self.collect(upstream)
                self.assertEqual(upstream.consumed, 0)
                self.assertTrue(upstream.closed)

    async def test_handshake_error_preserves_timeout_without_exposing_backend_details(self):
        for code, status in (("timeout", 504), ("routing_failed", 502), ("protection_failed", 502)):
            with self.subTest(code=code):
                self.fault = lambda event: {"type": "error", "stream_id": event["stream_id"],
                    "sequence": 0, "checks": 0, "code": code, "message": "private backend credentials"}
                upstream = Upstream([chunk("private"), chunk(finish="stop")])
                with self.assertRaises(APIError) as caught: await self.collect(upstream)
                self.assertEqual(caught.exception.status_code, status)
                self.assertNotIn("private", str(caught.exception))
                self.assertEqual(upstream.consumed, 0)
                self.assertTrue(upstream.closed)

    async def test_full_buffered_text_requires_acknowledgement_of_end(self):
        # Sending end is insufficient: the engine must have consumed it before
        # whole-response approval. Without that ACK, no content may escape.
        self.fault = lambda event: None if (event["type"] == "ack"
            and self.received[-1]["type"] == "end") else event
        upstream = Upstream([chunk("private"), chunk(finish="stop")])
        observed = []
        with self.assertRaises(APIError):
            async for frame in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data):
                observed.append(frame)
        self.assertEqual(self.content(observed), "")
        self.assertFalse(any(c.finish_reason for f in observed for c in f.choices))
        self.assertTrue(upstream.closed)

    async def test_invalid_block_is_infrastructure_failure_not_policy_intervention(self):
        self.block = True; self.mode = "window_buffered"
        for field, value in (("checks", 0), ("released_characters", 10), ("transformed", "false")):
            with self.subTest(field=field, value=value):
                self.fault = lambda event: {**event, field: value} if event["type"] == "blocked" else event
                upstream = Upstream([chunk("unsafe")]*20 + [chunk(finish="stop")])
                with self.assertRaises(APIError) as caught: await self.collect(upstream)
                self.assertEqual(caught.exception.status_code, 502)
                self.assertTrue(upstream.closed)
                entries = self.data["metadata"]["standard_logging_guardrail_information"]
                self.assertEqual(entries[-1]["guardrail_status"], "guardrail_failed_to_respond")

    async def test_guard_disconnect_never_becomes_successful_completion(self):
        self.mode = "window_buffered"
        self.fault = lambda event: None if event["type"] == "completed" else event
        upstream = Upstream([chunk("approved"), chunk(finish="stop")])
        observed = []
        with self.assertRaises(APIError):
            async for frame in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data):
                observed.append(frame)
        self.assertEqual(self.content(observed), "approved")
        self.assertFalse(any(c.finish_reason for f in observed for c in f.choices))
        self.assertTrue(upstream.closed)

    async def test_credit_backpressure_bounds_model_reads(self):
        self.gate.clear()
        upstream = Upstream([chunk("safe")]*50 + [chunk(finish="stop")])
        task = asyncio.create_task(self.collect(upstream))
        try:
            async with asyncio.timeout(2):
                while upstream.consumed < 8: await asyncio.sleep(.01)
            await asyncio.sleep(.05)
            self.assertEqual(upstream.consumed, 8)
            self.gate.set()
            self.assertEqual(self.content(await task), "safe"*50)
        finally:
            self.gate.set(); task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_limits_and_timeouts_fail_closed(self):
        upstream = Upstream([chunk("12345"), chunk(finish="stop")])
        with patch.object(streaming, "MAX_CHARACTERS", 4), self.assertRaises(APIError):
            await self.collect(upstream)
        self.assertTrue(upstream.closed)
        self.gate.clear(); self.provider.timeout_seconds = .05
        upstream = Upstream([chunk("safe"), chunk(finish="stop")])
        try:
            with self.assertRaises(APIError) as caught: await self.collect(upstream)
            self.assertEqual(caught.exception.status_code, 504)
            self.assertTrue(upstream.closed)
        finally: self.gate.set()

    async def test_cancellation_closes_connection_and_upstream(self):
        self.mode = "window_buffered"
        upstream = Upstream([chunk("safe")]*100 + [chunk(finish="stop")])
        stream = self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)
        self.assertEqual(self.content([await anext(stream)]), "")
        self.assertEqual(self.content([await anext(stream)]), "safe")
        await stream.aclose()
        await asyncio.wait_for(self.disconnected.wait(), 2)
        self.assertTrue(upstream.closed)
        self.assertLess(upstream.consumed, 100)

    async def test_unfinished_or_unsupported_stream_is_rejected(self):
        variants = [
            [chunk("partial")],
            [chunk("partial"), RuntimeError("upstream raw content")],
            [chunk(reasoning_content="unchecked reasoning"), chunk(finish="stop")],
            [chunk(tool_calls=[{"index": 0, "function": {"arguments": "unchecked"}}])],
            [ModelResponseStream(id="chat-test", model="test-model", created=123, choices=[
                {"index": 0, "delta": {"content": "first"}}, {"index": 1, "delta": {"content": "second"}},
            ])],
        ]
        for frames in variants:
            upstream = Upstream(frames)
            with self.assertRaises(APIError):
                await self.collect(upstream)
            self.assertTrue(upstream.closed)


    async def test_synthesized_finish_frame_is_not_upstream_completion_evidence(self):
        upstream = Upstream([chunk("partial"), chunk(finish="stop")])
        upstream.received_finish_reason = None
        with self.assertRaises(APIError):
            await self.collect(upstream)
        self.assertFalse(any(e["type"] == "end" for e in self.received))
        self.assertTrue(upstream.closed)


    async def test_generic_adapter_finish_reason_is_valid_before_usage_completion(self):
        upstream = Upstream([chunk("safe"), chunk(finish="stop")])
        upstream.received_finish_reason = None
        upstream.intermittent_finish_reason = "stop"
        self.assertEqual(self.content(await self.collect(upstream)), "safe")


    async def test_real_router_wrapper_distinguishes_upstream_finish_from_synthetic_eof(self):
        # Exercise the actual pinned Router wrapper and CustomStreamWrapper,
        # rather than a fake wrapper whose completion fields always agree.
        for complete in (True, False):
            for with_router in (True, False):
                with self.subTest(complete=complete, with_router=with_router):
                    self.received.clear()

                    frames = [chunk("safe")]
                    if complete:
                        frames.append(chunk(finish="stop"))
                    upstream = Upstream(frames)
                    logging = Logging(model="test-model", messages=self.data["messages"], stream=True,
                        call_type="acompletion", start_time=datetime.datetime.now(),
                        litellm_call_id="call-1", function_id="test")
                    # No external observability callbacks are needed in this test.
                    logging._on_deferred_stream_complete = Mock()
                    logging.model_call_details["custom_llm_provider"] = "openai"
                    source = CustomStreamWrapper(completion_stream=upstream, model="test-model",
                        custom_llm_provider="openai", logging_obj=logging)
                    source.created = 123  # Match the fixture's wire timestamp, including synthetic frames.
                    wrapped = await Router._acompletion_streaming_iterator(SimpleNamespace(), source,
                        self.data["messages"], {}) if with_router else source
                    if complete:
                        self.assertEqual(self.content(await self.collect(wrapped)), "safe")
                        self.assertEqual(self.received[-1]["type"], "end")
                    else:
                        with self.assertRaises(APIError) as caught:
                            await self.collect(wrapped)
                        self.assertIn("verified completion", str(caught.exception))
                        self.assertFalse(any(e["type"] == "end" for e in self.received))
                    self.assertTrue(upstream.closed)


    async def test_real_router_pre_first_chunk_fallback_checks_the_active_source(self):
        for complete in (True, False):
            with self.subTest(complete=complete):
                self.received.clear()

                logging = Logging(model="test-model", messages=self.data["messages"], stream=True,
                    call_type="acompletion", start_time=datetime.datetime.now(),
                    litellm_call_id="call-1", function_id="test")
                logging._on_deferred_stream_complete = Mock()
                logging.model_call_details["custom_llm_provider"] = "openai"
                primary = Upstream([MidStreamFallbackError(message="synthetic unavailable model", model="test-model",
                    llm_provider="openai", is_pre_first_chunk=True)])
                # Router only needs the source identity and chunk accumulator.
                primary.model, primary.custom_llm_provider, primary.logging_obj = "test-model", "openai", logging
                primary.chunks = []
                secondary_frames = [chunk("fallback safe")]
                if complete:
                    secondary_frames.append(chunk(finish="stop"))
                secondary = Upstream(secondary_frames)
                source = CustomStreamWrapper(completion_stream=secondary, model="test-model",
                    custom_llm_provider="openai", logging_obj=logging)
                source.created = 123
                router = SimpleNamespace(fallbacks=[], context_window_fallbacks=[], content_policy_fallbacks=[],
                    _acompletion=Mock(), _update_kwargs_before_fallbacks=Mock(),
                    async_function_with_fallbacks_common_utils=AsyncMock(return_value=source))
                wrapped = await Router._acompletion_streaming_iterator(router, primary,
                    self.data["messages"], {"model": "test-model"})
                if complete:
                    self.assertEqual(self.content(await self.collect(wrapped)), "fallback safe")
                else:
                    with self.assertRaises(APIError) as caught:
                        await self.collect(wrapped)
                    self.assertIn("verified completion", str(caught.exception))
                    self.assertFalse(any(e["type"] == "end" for e in self.received))
                router.async_function_with_fallbacks_common_utils.assert_awaited_once()
                self.assertTrue(primary.closed)
                self.assertTrue(secondary.closed)


    async def test_private_output_is_absent_from_native_guardrail_log(self):
        await self.collect(Upstream([chunk("private test response"), chunk(finish="stop")]))
        entries = self.data["metadata"]["standard_logging_guardrail_information"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["guardrail_status"], "success")
        self.assertNotIn("private test response", str(entries))
        self.assertIn("release-1", str(entries))


    async def test_full_buffered_role_frame_is_empty_and_cancellable_before_check(self):
        upstream = Upstream([chunk("private output"), chunk("later"), chunk(finish="stop")])
        stream = self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)
        initial = await anext(stream)
        self.assertEqual(self.content([initial]), "")
        self.assertEqual(initial.choices[0].delta.role, "assistant")
        self.assertIsNone(initial.choices[0].finish_reason)
        self.assertFalse(any(e["type"] == "end" for e in self.received))
        await stream.aclose()
        self.assertTrue(upstream.closed)
        self.assertEqual(upstream.consumed, 0)


    async def test_first_frame_stall_is_announced_then_times_out_without_content(self):
        class Stalled(Upstream):
            async def __anext__(self):
                await asyncio.Event().wait()

        upstream = Stalled([])
        self.provider.timeout_seconds = 0.01
        stream = self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)
        initial = await asyncio.wait_for(anext(stream), 0.2)
        self.assertEqual(self.content([initial]), "")
        self.assertTrue(initial.id.startswith("chatcmpl-guard-"))
        self.assertIsNone(initial.choices[0].finish_reason)
        with self.assertRaises(APIError) as caught:
            await anext(stream)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertFalse(any(e["type"] == "end" for e in self.received))
        self.assertTrue(upstream.closed)


    async def test_usage_survives_but_raw_logprobs_do_not(self):
        first = chunk("safe")
        first.choices[0].logprobs = {"content": [{"token": "do not disclose"}]}
        result = await self.collect(Upstream([first, chunk(finish="stop"),
            ModelResponseStream(id="chat-test", created=123, model="test-model", choices=[], usage={"total_tokens": 5})]))
        self.assertEqual(self.content(result), "safe")
        self.assertEqual(result[-1].usage.total_tokens, 5)
        self.assertNotIn("do not disclose", str(result))
        self.assertEqual(len({(frame.id, frame.created, frame.model) for frame in result}), 1)
        self.assertNotEqual(result[0].id, "chat-test")


    async def test_disabled_output_does_not_change_other_stage_selection(self):
        self.provider.should_run_guardrail.return_value = False
        original = [chunk("unprotected by explicit configuration"), chunk(finish="stop")]
        upstream = Upstream(original)
        self.assertEqual(await self.collect(upstream), original)
        self.assertTrue(upstream.closed)
        self.assertFalse(any(e["type"] == "end" for e in self.received))


    async def test_setup_failure_and_passthrough_cancellation_close_upstream(self):
        upstream = Upstream([chunk("raw"), chunk(finish="stop")])
        self.provider._extract_user_api_key_metadata.side_effect = ValueError("synthetic invalid metadata")
        with self.assertRaises(ValueError):
            await self.collect(upstream)
        self.assertTrue(upstream.closed)
        self.assertEqual(upstream.consumed, 0)
        self.provider.should_run_guardrail.return_value = False
        upstream = Upstream([chunk("explicit passthrough"), chunk("later")])
        stream = self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)
        await anext(stream)
        await stream.aclose()
        self.assertTrue(upstream.closed)
        self.assertEqual(upstream.consumed, 1)


    async def test_fail_open_setting_cannot_silently_bypass_protected_streaming(self):
        self.provider.unreachable_fallback = "fail_open"
        upstream = Upstream([chunk("raw"), chunk(finish="stop")])
        with self.assertRaises(APIError) as caught:
            await self.collect(upstream)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(upstream.consumed, 0)
        self.assertTrue(upstream.closed)
