"""Run inside the pinned LiteLLM image; only Guard's HTTP responses are mocked."""
import asyncio
import datetime
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
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
    def setUp(self):
        self.provider = TaskLatticeGuard(credential_name="test-only", api_base="http://guard/runtime/v1/integrations/test",
            guardrail_name="TaskLattice Guard", default_on=True)
        self.provider.should_run_guardrail = Mock(return_value=True)
        self.provider._build_request_headers = Mock(return_value={"x-api-key": "synthetic"})
        self.provider._extract_user_api_key_metadata = Mock(return_value={"user_api_key_team_id": "team-1"})
        self.data = {"model": "test-model", "messages": [{"role": "user", "content": "safe input"}],
                     "litellm_logging_obj": SimpleNamespace(litellm_call_id="call-1")}
        self.text = ""
        self.mode = "full_buffered"
        self.replies = []
        self.transform = lambda text: text
        self.block = False

        async def post(*, url, json, headers):
            self.assertTrue(url.endswith("/guardrails/output-stream"))
            self.assertEqual(json["protocol"], "litellm")
            self.assertEqual(json["call_id"], "call-1")
            self.assertEqual(json["request_data"]["user_api_key_team_id"], "team-1")
            self.assertEqual(json["sequence"], len(self.replies))
            self.text += json["text"]
            final = json["final"]
            result = {"stream_id": json["stream_id"], "sequence": json["sequence"], "next_sequence": json["sequence"] + 1,
                      "mode": self.mode, "status": "blocked" if self.block else "completed" if final else "released" if self.mode == "interruptible" else "buffering",
                      "terminate": self.block, "final": final,
                      "released_text": "" if self.block else self.transform(self.text) if final and self.mode == "full_buffered" else json["text"] if self.mode == "interruptible" else "",
                      "effective_release_id": "release-1", "model_revision_id": None}
            self.replies.append(result)
            return httpx.Response(200, json=result, request=httpx.Request("POST", url))
        self.post = post
        self.provider.async_handler = SimpleNamespace(post=AsyncMock(side_effect=post))

    async def collect(self, upstream):
        return [item async for item in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)]

    def content(self, frames):
        return "".join(c.delta.content or "" for f in frames for c in f.choices)

    async def test_full_response_withholds_every_prefix_and_delivers_transformed_text(self):
        self.transform = lambda text: text.replace("alice@example.com", "[EMAIL]")
        upstream = Upstream([chunk("Contact ali"), chunk("ce@example.com"), chunk(finish="stop")])
        with patch.object(streaming, "FLUSH_CHARACTERS", 1):
            result = await self.collect(upstream)
        self.assertEqual(self.content(result), "Contact [EMAIL]")
        self.assertTrue(all(r["released_text"] == "" for r in self.replies[:-1]))
        self.assertTrue(upstream.closed)
        self.assertEqual(result[-1].choices[0].finish_reason, "stop")

    async def test_reject_stops_upstream_and_never_yields_attack(self):
        self.block = True
        upstream = Upstream([chunk("unsafe"), chunk("must not be consumed"), chunk(finish="stop")])
        observed = []
        with patch.object(streaming, "FLUSH_CHARACTERS", 1):
            with self.assertRaises(GuardrailRaisedException):
                async for frame in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data):
                    observed.append(frame)
        self.assertEqual(len(observed), 1)
        self.assertEqual(self.content(observed), "")
        self.assertIsNone(observed[0].choices[0].finish_reason)
        self.assertEqual(upstream.consumed, 1)
        self.assertTrue(upstream.closed)

    async def test_incremental_only_emits_approved_new_text(self):
        self.mode = "interruptible"
        upstream = Upstream([chunk("one"), chunk("two"), chunk(finish="stop")])
        with patch.object(streaming, "FLUSH_CHARACTERS", 1):
            result = await self.collect(upstream)
        self.assertEqual(self.content(result), "onetwo")
        self.assertEqual(len(self.replies), 3)

    async def test_failures_and_invalid_acknowledgements_never_fall_back_to_original(self):
        async def fail(**kwargs):
            raise RuntimeError("secret must not be reflected")
        for kind in ("http", "sequence", "release", "buffer-leak", "final", "state"):
            with self.subTest(kind=kind):
                self.replies = []
                async def bad(**kwargs):
                    if kind == "http":
                        return await fail(**kwargs)
                    response = await self.post(**kwargs)
                    body = response.json()
                    if kind == "sequence": body["next_sequence"] = 99
                    if kind == "release": body["effective_release_id"] = None
                    if kind == "buffer-leak": body.update(status="buffering", released_text="raw")
                    if kind == "final": body["final"] = not body["final"]
                    if kind == "state": body["status"] = "unknown"
                    return httpx.Response(200, json=body, request=response.request)
                self.provider.async_handler.post = AsyncMock(side_effect=bad)
                upstream = Upstream([chunk("secret"), chunk(finish="stop")])
                with self.assertRaises(APIError) as caught:
                    await self.collect(upstream)
                self.assertNotIn("secret", str(caught.exception))
                self.assertTrue(upstream.closed)

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

    async def test_detector_failure_is_not_reported_as_a_policy_match(self):
        for transport in ("http-error", "failed-check-ack"):
            with self.subTest(transport=transport):
                self.replies = []
                async def failed(**kwargs):
                    if transport == "http-error":
                        return httpx.Response(502, json={"detail": "private backend failure"},
                                              request=httpx.Request("POST", kwargs["url"]))
                    response = await self.post(**kwargs)
                    body = response.json()
                    body.update(status="blocked", terminate=True, released_text="",
                                decision={"decision": "block", "usage": {"fail_closed": True}, "reason": "private backend failure"})
                    return httpx.Response(200, json=body, request=response.request)
                self.provider.async_handler.post = AsyncMock(side_effect=failed)
                upstream = Upstream([chunk("private output"), chunk(finish="stop")])
                emitted = []
                with self.assertRaises(APIError) as caught:
                    async for frame in self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data):
                        emitted.append(frame)
                self.assertEqual(caught.exception.status_code, 502)
                self.assertNotIn("private", str(caught.exception))
                self.assertEqual(len(emitted), 1)
                self.assertEqual(self.content(emitted), "")
                self.assertIsNone(emitted[0].choices[0].finish_reason)
                self.assertTrue(upstream.closed)

    async def test_unknown_http_failure_is_sanitized_for_native_stream_error_path(self):
        self.provider.async_handler.post = AsyncMock(side_effect=HTTPException(
            status_code=503, detail="private provider response with credentials"))
        upstream = Upstream([chunk("private output"), chunk(finish="stop")])
        with self.assertRaises(APIError) as caught:
            await self.collect(upstream)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn("private", str(caught.exception))
        self.assertNotIn("credentials", str(caught.exception))
        self.assertTrue(upstream.closed)

    async def test_limits_and_timeouts_fail_closed(self):
        upstream = Upstream([chunk("12345"), chunk(finish="stop")])
        with patch.object(streaming, "MAX_CHARACTERS", 4), self.assertRaises(APIError):
            await self.collect(upstream)
        self.assertTrue(upstream.closed)
        async def slow(**kwargs):
            await asyncio.sleep(1)
        self.provider.timeout_seconds = 0.01
        self.provider.async_handler.post = AsyncMock(side_effect=slow)
        upstream = Upstream([chunk("safe"), chunk(finish="stop")])
        with self.assertRaises(APIError) as caught:
            await self.collect(upstream)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertTrue(upstream.closed)

    async def test_synthesized_finish_frame_is_not_upstream_completion_evidence(self):
        upstream = Upstream([chunk("partial"), chunk(finish="stop")])
        upstream.received_finish_reason = None
        with self.assertRaises(APIError):
            await self.collect(upstream)
        self.provider.async_handler.post.assert_not_called()
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
                    self.replies = []
                    self.text = ""
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
                        self.assertTrue(self.replies[-1]["final"])
                    else:
                        with self.assertRaises(APIError) as caught:
                            await self.collect(wrapped)
                        self.assertIn("verified upstream completion", str(caught.exception))
                        self.assertEqual(self.replies, [])
                    self.assertTrue(upstream.closed)

    async def test_changed_pinned_release_is_rejected_without_leaking_buffers(self):
        async def changed(**kwargs):
            response = await self.post(**kwargs)
            body = response.json()
            if body["sequence"] > 0: body["effective_release_id"] = "different-release"
            return httpx.Response(200, json=body, request=response.request)
        self.provider.async_handler.post = AsyncMock(side_effect=changed)
        upstream = Upstream([chunk("first"), chunk("second"), chunk(finish="stop")])
        with patch.object(streaming, "FLUSH_CHARACTERS", 1), self.assertRaises(APIError):
            await self.collect(upstream)
        self.assertTrue(upstream.closed)

    async def test_real_router_pre_first_chunk_fallback_checks_the_active_source(self):
        for complete in (True, False):
            with self.subTest(complete=complete):
                self.replies = []
                self.text = ""
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
                    self.assertIn("verified upstream completion", str(caught.exception))
                    self.assertEqual(self.replies, [])
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

    async def test_cancellation_closes_upstream(self):
        self.mode = "interruptible"
        upstream = Upstream([chunk("safe"), chunk("later"), chunk(finish="stop")])
        stream = self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)
        with patch.object(streaming, "FLUSH_CHARACTERS", 1):
            self.assertEqual(self.content([await anext(stream)]), "")
            self.assertEqual(self.content([await anext(stream)]), "safe")
            await stream.aclose()
        self.assertTrue(upstream.closed)
        self.assertEqual(upstream.consumed, 1)

    async def test_full_buffered_role_frame_is_empty_and_cancellable_before_check(self):
        upstream = Upstream([chunk("private output"), chunk("later"), chunk(finish="stop")])
        stream = self.provider.async_post_call_streaming_iterator_hook(None, upstream, self.data)
        initial = await anext(stream)
        self.assertEqual(self.content([initial]), "")
        self.assertEqual(initial.choices[0].delta.role, "assistant")
        self.assertIsNone(initial.choices[0].finish_reason)
        self.provider.async_handler.post.assert_not_called()
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
        self.provider.async_handler.post.assert_not_called()
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
        self.provider.async_handler.post.assert_not_called()

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


if __name__ == "__main__":
    unittest.main()
