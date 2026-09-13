"""Release only text approved by Guard's ordered, pinned output stream API."""
import asyncio
import time
from typing import Any, AsyncGenerator
from uuid import uuid4

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
FLUSH_CHARACTERS = 2_048


class ProtectedStreamError(HTTPException):
    """A public-safe failure created by this integration, never upstream text."""


def _failure(message: str, status_code: int = 502) -> ProtectedStreamError:
    # Do not reflect upstream bodies, prompts, credentials or provider exceptions.
    return ProtectedStreamError(status_code=status_code, detail={
        "error": "tasklattice_output_stream_failed", "message": message,
    })


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
    """Text chat completions only; never forward original/logprob/tool frames.

    The Runner chooses complete-response or incremental checking from its pinned
    artifact. A transport failure cannot be repaired by yielding buffered raw text.
    """
    if provider.should_run_guardrail(data=request_data, event_type=GuardrailEventHooks.post_call) is not True:
        async for item in response:
            yield item
        return

    logging_obj = request_data.get("litellm_logging_obj")
    if user_api_key_dict is not None:
        _ensure_litellm_metadata(request_data, user_api_key_dict)
    stream_id = str(uuid4())
    call_id = getattr(logging_obj, "litellm_call_id", None) or request_data.get("litellm_call_id") or stream_id
    metadata = dict(provider._extract_user_api_key_metadata(request_data))
    headers = _extract_inbound_headers(
        request_data, logging_obj,
        extra_allowlist={h.lower() for h in provider.extra_headers if isinstance(h, str)},
    ) or {}
    messages = request_data.get("messages") or []
    api_base = provider.api_base.removesuffix("/beta/litellm_basic_guardrail_api")
    sequence = 0
    pinned = None
    frame_identity = None
    finished = None
    usage = None
    total = 0
    chunks = 0
    pending = ""
    started_at = time.time()
    # Client identity belongs to the protected stream. The upstream identity is
    # still checked separately, but cannot be needed to announce a cancellable
    # empty stream before the first provider frame arrives.
    client_identity = {"id": f"chatcmpl-guard-{stream_id}", "created": int(started_at),
                       "model": request_data.get("model") or "unknown"}
    outcome = "guardrail_failed_to_respond"
    transformed = False
    deadline = time.monotonic() + MAX_SECONDS

    async def check(text: str, final: bool) -> str:
        nonlocal sequence, pinned, transformed
        payload = {
            "stream_id": stream_id, "call_id": str(call_id), "sequence": sequence,
            "text": text, "final": final, "protocol": "litellm", "messages": messages,
            "model": request_data.get("model"), "request_data": metadata, "request_headers": headers,
        }
        reply = await asyncio.wait_for(provider.async_handler.post(
            url=f"{api_base}/guardrails/output-stream", json=payload,
            headers=provider._build_request_headers(),
        ), timeout=max(0, min(provider.timeout_seconds, deadline - time.monotonic())))
        reply.raise_for_status()
        result = reply.json()
        if not isinstance(result, dict) or (
            result.get("stream_id") != stream_id
            or type(result.get("sequence")) is not int or result["sequence"] != sequence
            or type(result.get("next_sequence")) is not int or result["next_sequence"] != sequence + 1
            or result.get("mode") not in {"full_buffered", "window_buffered", "interruptible"}
            or type(result.get("terminate")) is not bool or result.get("final") is not final
            or not isinstance(result.get("released_text"), str)
            or not isinstance(result.get("effective_release_id"), str) or not result["effective_release_id"]
        ):
            raise _failure("Guard returned an invalid output stream acknowledgement.")
        identity = (result["effective_release_id"], result.get("model_revision_id"), result["mode"])
        if pinned is not None and pinned != identity:
            raise _failure("Guard changed the execution release during one output stream.")
        pinned = identity
        decision = result.get("decision") or {}
        if (decision.get("usage") or {}).get("fail_closed") is True:
            raise _failure("Guard could not complete the output check; unchecked output was withheld.")
        transformed |= (result.get("decision") or {}).get("decision") == "transform"
        if result["terminate"] or result.get("status") == "blocked":
            raise GuardrailRaisedException(guardrail_name=provider.guardrail_name,
                message="Model output was blocked by TaskLattice Guard.", should_wrap_with_default_message=False)
        if result.get("status") not in ({"completed"} if final else {"buffering", "released"}):
            raise _failure("Guard returned an invalid output stream state.")
        if result["released_text"] and (result["status"] == "buffering" or result["mode"] == "full_buffered" and not final):
            raise _failure("Guard tried to release text before the required check completed.")
        sequence += 1
        return result["released_text"]

    def frame(text: str = "", finish_reason=None):
        return ModelResponseStream(**client_identity, choices=[{
            "index": 0, "delta": {"role": "assistant", "content": text},
            "finish_reason": finish_reason,
        }])

    try:
        if provider.unreachable_fallback != "fail_closed":
            raise _failure("Protected streaming requires unreachable_fallback=fail_closed.", 400)
        if not isinstance(messages, list) or len(messages) > 20:
            raise _failure("Protected streaming supports at most 20 context messages.", 400)
        # LiteLLM peeks at the first output frame before handing off to
        # Starlette's disconnect-aware SSE response. This synthetic role-only
        # announcement carries no upstream fields or protected text and does
        # not imply that generation or a safety check has succeeded.
        yield frame()
        iterator = response.__aiter__()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _failure("Protected output stream exceeded its duration limit.", 504)
            try:
                item = await asyncio.wait_for(anext(iterator), min(provider.timeout_seconds, remaining))
            except StopAsyncIteration:
                break
            chunks += 1
            if chunks > MAX_CHUNKS:
                raise _failure("Protected output stream exceeded its frame limit.")
            data = _dict(item)
            if data.get("object") != "chat.completion.chunk" or data.get("error"):
                raise _failure("TaskLattice protected streaming requires text chat-completion frames.")
            identity = {key: data.get(key) for key in ("id", "created", "model")}
            if frame_identity is None:
                frame_identity = identity
            elif frame_identity != identity:
                raise _failure("Model stream identity changed before completion.")
            choices = data.get("choices")
            if choices == [] and data.get("usage") is not None:
                # Only numeric accounting fields; never echo provider-specific text.
                usage = {key: value for key, value in _dict(data["usage"]).items()
                         if key in {"prompt_tokens", "completion_tokens", "total_tokens"} and type(value) is int and value >= 0}
                continue
            if not isinstance(choices, list) or len(choices) != 1 or finished is not None:
                raise _failure("Protected streaming requires one unfinished text choice.")
            choice = _dict(choices[0])
            delta = _dict(choice.get("delta", {}))
            if choice.get("index") != 0 or any(value not in (None, "", [], {}) for key, value in delta.items() if key not in {"role", "content"}):
                raise _failure("Tool, audio and reasoning stream channels are not supported by text protection.")
            text = delta.get("content") or ""
            if not isinstance(text, str):
                raise _failure("Protected stream content must be text.")
            total += len(text)
            if total > MAX_CHARACTERS or len(text) > 100_000:
                raise _failure("Protected output stream exceeded its text limit.")
            pending += text
            finished = choice.get("finish_reason")
            if finished not in {None, "stop", "length", "content_filter"}:
                raise _failure("Unsupported model stream completion reason.")
            if finished is not None and not _verified_completion(response):
                raise _failure("Model stream ended without a verified upstream completion marker.")
            if finished is None and len(pending) >= FLUSH_CHARACTERS:
                approved = await check(pending, False)
                pending = ""
                if approved:
                    yield frame(approved)
        if finished is None or frame_identity is None:
            raise _failure("Model stream ended without a completion marker.")
        approved = await check(pending, True)
        outcome = "guardrail_intervened" if transformed else "success"
        if approved:
            yield frame(approved)
        yield frame(finish_reason=finished)
        if usage is not None:
            yield ModelResponseStream(**client_identity, choices=[], usage=usage)
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
        # Preserve native LiteLLM observability without logging raw response text
        # (including blocked/PII spans) or a provider's exception body.
        provider.add_standard_logging_guardrail_information_to_request_data(
            guardrail_json_response={"checks": sequence, "stream_id": stream_id,
                "effective_release_id": pinned[0] if pinned else None,
                "model_revision_id": pinned[1] if pinned else None,
                "output_mode": pinned[2] if pinned else None},
            request_data=request_data, guardrail_status=outcome,
            guardrail_provider="tasklattice_guard", event_type=GuardrailEventHooks.post_call,
            start_time=started_at, end_time=time.time(), duration=time.time() - started_at,
        )


async def _close(response):
    close = getattr(response, "aclose", None)
    if close is not None:
        try:
            await asyncio.wait_for(close(), timeout=2)
        except Exception:
            pass
