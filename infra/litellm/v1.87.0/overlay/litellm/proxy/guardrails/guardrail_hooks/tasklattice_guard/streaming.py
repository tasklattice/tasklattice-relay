"""Release only text approved by Guard's ordered, pinned output stream API."""
import asyncio
import time
from typing import Any, AsyncGenerator
from uuid import uuid4

import aiohttp
from fastapi import HTTPException

from litellm.exceptions import GuardrailRaisedException
from litellm.proxy.guardrails.guardrail_hooks.generic_guardrail_api.generic_guardrail_api import (
    _extract_inbound_headers,
)
from litellm.proxy.guardrails.guardrail_hooks.unified_guardrail.unified_guardrail import _ensure_litellm_metadata
from litellm.types.guardrails import GuardrailEventHooks
from litellm.types.utils import ModelResponseStream

# Bound both the upstream and control-plane work, including empty-token floods.
MAX_CHARACTERS = 1_000_000
MAX_CHUNKS = 100_000
MAX_SECONDS = 300


class ProtectedStreamError(HTTPException):
    """A public-safe failure created by this integration, never upstream text."""


def _failure(message: str, status_code: int = 502) -> ProtectedStreamError:
    # Do not reflect upstream bodies, prompts, credentials or provider exceptions.
    return ProtectedStreamError(status_code=status_code, detail={
        "error": "tasklattice_output_stream_failed", "message": message,
    })


def _guard_error(event: dict) -> ProtectedStreamError:
    # Server error messages are not public content, even during the handshake.
    return _failure("Guard could not complete output protection.",
                    504 if event.get("code") == "timeout" else 502)


def _dict(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    raise _failure("Unsupported model stream frame; no unchecked content was released.")


def _verified_completion(response: Any, depth: int = 0) -> bool:
    """Distinguish upstream completion from LiteLLM's synthetic EOF stop.

    Pinned LiteLLM 1.87's Router wrapper delegates iteration without updating
    its inherited completion fields. Its active source is held by the suspended
    stream_with_fallbacks generator, not exposed as a public attribute. Inspect
    that narrowly identified wrapper while it is yielding the terminal frame;
    exhaustion closes the generator and discards this evidence. Unknown wrapper
    layouts fail closed. No global LiteLLM behavior is patched.
    """
    if depth > 4:
        return False
    cls = type(response)
    if cls.__module__ == "litellm.router" and cls.__name__ == "FallbackStreamWrapper":
        generator = getattr(response, "_async_generator", None)
        generator_frame = getattr(generator, "ag_frame", None)
        if generator_frame is None or generator_frame.f_code.co_name != "stream_with_fallbacks":
            return False
        sources = generator_frame.f_locals
        source = sources.get("fallback_response")
        if source is None:
            source = sources.get("model_response")
        return source is not None and source is not response and _verified_completion(source, depth + 1)
    if hasattr(response, "received_finish_reason"):
        return bool(response.received_finish_reason or getattr(response, "intermittent_finish_reason", None))
    # Plain provider iterators have no LiteLLM synthetic-completion behavior.
    # The caller still requires an explicit, supported finish_reason frame.
    return True


async def protected_output_stream(provider, response, request_data, user_api_key_dict) -> AsyncGenerator[Any, None]:
    stream = _protected_output_stream(provider, response, request_data, user_api_key_dict)
    try:
        async for item in stream:
            yield item
    finally:
        # Also covers setup failures, disabled post-call protection, and client
        # cancellation while the inner generator is suspended at a yield.
        try:
            await stream.aclose()
        finally:
            await _close(response)


async def _protected_output_stream(provider, response, request_data, user_api_key_dict) -> AsyncGenerator[Any, None]:
    """One duplex connection; only Runner-approved deltas reach client SSE."""
    if provider.should_run_guardrail(data=request_data, event_type=GuardrailEventHooks.post_call) is not True:
        async for item in response:
            yield item
        return

    logging_obj = request_data.get("litellm_logging_obj")
    if user_api_key_dict is not None:
        _ensure_litellm_metadata(request_data, user_api_key_dict)
    stream_id = str(uuid4())
    call_id = getattr(logging_obj, "litellm_call_id", None) or request_data.get("litellm_call_id")
    metadata = dict(provider._extract_user_api_key_metadata(request_data))
    headers = _extract_inbound_headers(request_data, logging_obj,
        extra_allowlist={h.lower() for h in provider.extra_headers if isinstance(h, str)}) or {}
    messages = request_data.get("messages") or []
    api_base = provider.api_base.removesuffix("/beta/litellm_basic_guardrail_api")
    started_at = time.time()
    deadline = time.monotonic() + MAX_SECONDS
    client_identity = {"id": f"chatcmpl-guard-{stream_id}", "created": int(started_at),
                       "model": request_data.get("model") or "unknown"}
    pinned = None
    checks = 0
    outcome = "guardrail_failed_to_respond"
    sent = acknowledged = released = output_sequence = 0
    ended = False
    finished = None
    usage = None
    producer = receiver = None

    async def timed(awaitable):
        return await asyncio.wait_for(awaitable,
            max(0, min(provider.timeout_seconds, deadline - time.monotonic())))

    def frame(text="", finish_reason=None):
        return ModelResponseStream(**client_identity, choices=[{
            "index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": finish_reason,
        }])

    try:
        if provider.unreachable_fallback != "fail_closed":
            raise _failure("Protected streaming requires unreachable_fallback=fail_closed.", 400)
        if not isinstance(messages, list) or len(messages) > 20:
            raise _failure("Protected streaming supports at most 20 context messages.", 400)
        # LiteLLM peeks once before installing its disconnect-aware SSE response.
        # This announcement contains no model text and promises no completion.
        yield frame()
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None,
                                        connect=provider.timeout_seconds)) as session:
            socket = await timed(session.ws_connect(f"{api_base}/guardrails/output-stream",
                headers=provider._build_request_headers(), max_msg_size=1_048_576))
            try:
                await timed(socket.send_json({"type": "start", "version": 1, "stream_id": stream_id,
                    "call_id": str(call_id) if call_id else None, "protocol": "litellm", "messages": messages,
                    "model": request_data.get("model"), "request_data": metadata, "request_headers": headers}))
                ready = await timed(socket.receive_json())
                if isinstance(ready, dict) and (
                    ready.get("type") == "error" and ready.get("stream_id") == stream_id
                    and type(ready.get("sequence")) is int and ready["sequence"] == 0
                    and type(ready.get("checks")) is int and ready["checks"] == 0
                ):
                    raise _guard_error(ready)
                if not isinstance(ready, dict) or (
                    ready.get("type") != "ready" or type(ready.get("version")) is not int or ready["version"] != 1
                    or ready.get("stream_id") != stream_id
                    or type(ready.get("input_credits")) is not int or ready["input_credits"] != 8
                    or ready.get("mode") not in {"full_buffered", "window_buffered"}
                    or ready.get("requested_mode") not in {"full_buffered", "window_buffered", "interruptible"}
                    or not isinstance(ready.get("effective_release_id"), str) or not ready["effective_release_id"]
                    or (ready.get("model_revision_id") is not None and (
                        not isinstance(ready["model_revision_id"], str) or not ready["model_revision_id"]))
                ):
                    raise _failure("Guard did not accept the protected stream.")
                pinned = (ready["effective_release_id"], ready.get("model_revision_id"), ready["mode"])
                credits = asyncio.Semaphore(ready["input_credits"])

                async def produce():
                    nonlocal sent, ended, finished, usage
                    identity = None
                    total = chunks = 0
                    iterator = response.__aiter__()
                    while True:
                        # At most the advertised number of frames may be ahead
                        # of NeMo; there is no gateway character batching/window.
                        await timed(credits.acquire())
                        try:
                            item = await timed(anext(iterator))
                        except StopAsyncIteration:
                            credits.release()
                            break
                        chunks += 1
                        if chunks > MAX_CHUNKS:
                            raise _failure("Protected output stream exceeded its frame limit.")
                        data = _dict(item)
                        if data.get("object") != "chat.completion.chunk" or data.get("error"):
                            raise _failure("Protected streaming requires text chat-completion frames.")
                        current = {key: data.get(key) for key in ("id", "created", "model")}
                        if identity is None:
                            identity = current
                        elif identity != current:
                            raise _failure("Model stream identity changed before completion.")
                        choices = data.get("choices")
                        if choices == [] and data.get("usage") is not None:
                            usage = {key: value for key, value in _dict(data["usage"]).items()
                                if key in {"prompt_tokens", "completion_tokens", "total_tokens"}
                                and type(value) is int and value >= 0}
                            credits.release()
                            continue
                        if not isinstance(choices, list) or len(choices) != 1 or finished is not None:
                            raise _failure("Protected streaming requires one unfinished text choice.")
                        choice = _dict(choices[0])
                        delta = _dict(choice.get("delta", {}))
                        if choice.get("index") != 0 or any(value not in (None, "", [], {})
                            for key, value in delta.items() if key not in {"role", "content"}):
                            raise _failure("Tool, audio and reasoning channels are unsupported by text protection.")
                        text = delta.get("content")
                        if text is None:
                            text = ""
                        if not isinstance(text, str):
                            raise _failure("Protected stream content must be text.")
                        total += len(text)
                        if total > MAX_CHARACTERS or len(text) > 100_000:
                            raise _failure("Protected output stream exceeded its text limit.")
                        finished = choice.get("finish_reason")
                        if finished not in {None, "stop", "length", "content_filter"}:
                            raise _failure("Unsupported model stream completion reason.")
                        if finished is not None and not _verified_completion(response):
                            raise _failure("Model stream ended without a verified completion marker.")
                        if text:
                            message = {"type": "delta", "sequence": sent, "text": text}
                            sent += 1
                            await timed(socket.send_json(message))
                        else:
                            credits.release()
                    if finished is None or identity is None:
                        raise _failure("Model stream ended without a completion marker.")
                    await timed(credits.acquire())
                    message = {"type": "end", "sequence": sent}
                    sent += 1
                    ended = True
                    await timed(socket.send_json(message))

                producer = asyncio.create_task(produce())
                while True:
                    receiver = asyncio.create_task(timed(socket.receive_json()))
                    # Producer errors (including upstream truncation) interrupt
                    # waiting for Guard, even if the engine has not filled a window.
                    done, _ = await asyncio.wait((producer, receiver), return_when=asyncio.FIRST_COMPLETED)
                    if producer in done:
                        await producer
                    result = await receiver
                    if not isinstance(result, dict) or result.get("stream_id") != stream_id:
                        raise _failure("Guard returned an invalid stream identity.")
                    kind = result.get("type")
                    if kind == "ack":
                        if type(result.get("sequence")) is not int or result["sequence"] != acknowledged or acknowledged >= sent:
                            raise _failure("Guard returned an invalid input acknowledgement.")
                        acknowledged += 1
                        credits.release()
                        continue
                    if type(result.get("sequence")) is not int or result["sequence"] != output_sequence:
                        raise _failure("Guard returned an invalid output sequence.")
                    if kind == "delta":
                        text = result.get("text")
                        if not isinstance(text, str) or not text or (
                            pinned[2] == "full_buffered" and (not ended or acknowledged != sent)
                        ):
                            raise _failure("Guard returned text before its required check completed.")
                        released += len(text)
                        if released > MAX_CHARACTERS:
                            raise _failure("Guard output exceeded its text limit.")
                        output_sequence += 1
                        yield frame(text)
                        continue
                    checks = result.get("checks")
                    if type(checks) is not int or checks < 0:
                        raise _failure("Guard returned an invalid check count.")
                    if kind == "error":
                        raise _guard_error(result)
                    if (kind not in {"blocked", "completed"} or type(result.get("transformed")) is not bool
                        or type(result.get("released_characters")) is not int or result["released_characters"] != released):
                        raise _failure("Guard returned an invalid terminal event.")
                    if kind == "blocked":
                        if checks == 0:
                            raise _failure("Guard returned a block without a completed check.")
                        raise GuardrailRaisedException(guardrail_name=provider.guardrail_name,
                            message="Model output was blocked by TaskLattice Guard.", should_wrap_with_default_message=False)
                    if not ended or acknowledged != sent or finished is None:
                        raise _failure("Guard returned an invalid completion event.")
                    await producer
                    outcome = "guardrail_intervened" if result["transformed"] else "success"
                    yield frame(finish_reason=finished)
                    if usage is not None:
                        yield ModelResponseStream(**client_identity, choices=[], usage=usage)
                    return
            finally:
                for task in (producer, receiver):
                    if task is not None:
                        task.cancel()
                await asyncio.gather(*(t for t in (producer, receiver) if t is not None), return_exceptions=True)
                await _close(socket)
    except GuardrailRaisedException:
        outcome = "guardrail_intervened"
        raise
    except HTTPException:
        raise
    except TimeoutError:
        raise _failure("Model or Guard output stream timed out; unchecked output was withheld.", 504) from None
    except Exception:
        raise _failure("Model or Guard output stream failed; unchecked output was withheld.") from None
    finally:
        provider.add_standard_logging_guardrail_information_to_request_data(
            guardrail_json_response={"checks": checks, "stream_id": stream_id,
                "effective_release_id": pinned[0] if pinned else None,
                "model_revision_id": pinned[1] if pinned else None, "output_mode": pinned[2] if pinned else None},
            request_data=request_data, guardrail_status=outcome,
            guardrail_provider="tasklattice_guard", event_type=GuardrailEventHooks.post_call,
            start_time=started_at, end_time=time.time(), duration=time.time() - started_at,
        )


async def _close(response):
    close = getattr(response, "aclose", None) or getattr(response, "close", None)
    if close is not None:
        try:
            await asyncio.wait_for(close(), timeout=2)
        except Exception:
            pass
