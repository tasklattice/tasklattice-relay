# TaskLattice Guard overlay for LiteLLM v1.87.0

This version-locked overlay adds `tasklattice_guard` as a first-class LiteLLM
Guardrail Provider. The runtime reuses LiteLLM's Generic Guardrail API protocol.
Streaming Output uses Guard's ordered output-stream API instead of the generic
sample-after-yield iterator. This is a TaskLattice-only override.
The same branded connection is listed in both the Provider picker and the
Guardrail Garden Partner catalog. The Garden, create modal, and settings page
reuse LiteLLM's native Guardrail components. Provider-specific fields come from
`TaskLatticeGuardConfigModel`; the dedicated API is limited to connection
verification and encrypted credential lifecycle.

## Provider configuration

The setup flow requires the TaskLattice Guard endpoint base URL and its one-time
secret. The base URL must end in `/runtime/v1/endpoints/{uuid}`. The Provider
derives both the Generic Guardrail callback path and the streaming WebSocket
path from that one URL; there is no separate streaming URL to configure.
Applications keep using `/v1/chat/completions` with `stream: true` and receive
standard SSE. The secret is persisted through
LiteLLM Credentials and is never copied into the Guardrail record.

The following settings are owned and enforced by the LiteLLM provider. They do
not change the TaskLattice Guard endpoint protocol:

| Setting | Accepted values | Default | Runtime effect |
| --- | --- | --- | --- |
| Protection stages (`mode`) | `pre_call`, `post_call`, or both | both | Runs input protection before the model, output protection after the model, or both. At least one stage is required. |
| Guard unavailable (`unreachable_fallback`) | `fail_closed`, `fail_open` | `fail_closed` | Non-streaming callbacks may bypass protection on network failures, timeouts, and HTTP 502/503/504. Protected streaming requires `fail_closed`. Policy blocks and other invalid responses are never bypassed. |
| Runtime timeout (`timeout_seconds`) | 1–60 seconds | 10 | Bounds each non-streaming callback and each streaming I/O or input-credit wait. Streaming timeouts terminate the SSE with an error. |
| Apply to every request (`default_on`) | `true`, `false` | `true` | Applies the Guardrail automatically, or only when a caller explicitly selects it. |

Creation verifies the Endpoint and Secret before persisting either record.
Editing policy settings does not require entering the secret again. Changing
the endpoint does require the secret again so that the new pair can be verified;
the existing credential remains unchanged for all other edits.

`fail_on_error` is intentionally not stored or exposed. LiteLLM v1.87.0's
Generic Guardrail API does not consume it, so presenting it would create a
configuration control with no runtime effect.

## Protected Output streaming

The Provider opens one authenticated WebSocket to
`/runtime/v1/endpoints/{uuid}/guardrails/output-stream`. It sends `start` with
pre-call identity and routing metadata, validates `ready`, then sends raw model
`delta` frames with at most eight unacknowledged inputs. NeMo owns the checking
windows (200 fragments, 50 overlap); no gateway character batching is used.
Only server `delta.text` reaches client SSE. A confirmed upstream completion
sends `end`; full buffering also requires its acknowledgement before releasing
text. Only a valid `completed` permits a client finish marker. `blocked`,
`error` or disconnect cancels the upstream iterator. There is no stream resume.

The immutable Runner artifact chooses `window_buffered` for eligible Content
Safety (including requested `interruptible`) or `full_buffered` for transformations
and whole-response policies. Full buffering releases no original prefix.
Guard and Relay must be upgraded together; the old POST chunk API is removed.
Reverse proxies must support WebSocket upgrades and 300-second connections.

The protected iterator produces an empty assistant-role frame before reading the
first upstream frame. This lets LiteLLM enter its disconnect-aware SSE response
even when the upstream stalls or Guard requires complete buffering. It is
protocol metadata, not an approved content token or completion;
time-to-first-content must exclude it. Client frames use one generated
`chatcmpl-guard-*` identity throughout, including completion and usage; upstream
identity changes are still validated separately. Cancellation closes the upstream
iterator even before its first frame, and an idle timeout returns 504 with no
protected text. This covers an established upstream response; DNS/TLS/HTTP
connection establishment before this callback remains governed by LiteLLM's
business-model connection/request timeout settings.

Guard-owned streaming failures are converted at the Provider boundary into
LiteLLM native API errors. This preserves 502/504 semantics and produces a
terminal SSE error after streaming starts rather than re-raising FastAPI's
HTTPException into an already-started response. Only integration-owned safe
messages are preserved; unknown exception details are replaced. A detector
outage remains an infrastructure error, not a successful Policy rejection.
Handshake timeouts preserve 504; malformed terminal events produce 502 and
cannot be recorded as valid Policy blocks.

Protected streams require `unreachable_fallback=fail_closed`. A configured
`fail_open` is rejected for streaming, rather than silently returning raw output;
its documented non-streaming behavior is unchanged. Callback/idle timeouts use
`timeout_seconds`; each stream is bounded to 300 seconds, 1,000,000 characters and
100,000 frames. Failed, interrupted or malformed streams withhold unchecked text.
Disconnect cancels the Runner check; no output buffer is stored in Redis.

LiteLLM can synthesize a `stop` frame when an upstream iterator ends without a
completion marker. The Provider checks actual completion evidence before final
release. In pinned 1.87.0, Router's `FallbackStreamWrapper` holds its active
source inside a suspended generator; the TaskLattice compatibility helper
inspects only that known wrapper and fails closed if its layout changes. Tests
exercise the real wrapper, including pre-first-chunk fallback, not just a fake
stream. This does not patch the global Router or its behavior for other Providers.

The streaming contract currently covers one text chat-completion choice and up
to 20 context messages. Tool, audio, reasoning and multi-choice channels are
explicitly rejected, never passed through as though text protection covered
them. Raw logprobs and provider-specific fields are not forwarded; completion
markers and numeric token usage are preserved. Disabling `post_call` explicitly
disables this Output protection, as for non-streaming requests.

The image build runs `tests/test_streaming.py` against the pinned LiteLLM runtime.
These isolated tests use a real loopback WebSocket peer to exercise adapter contracts;
the Guard repository's `scripts/regress_business_proxy.mjs` additionally runs a
real Relay container against real Guard/NeMo and a controlled business model,
including split PII, early/late injection, interruption and client-byte timing.
The Guard repository's opt-in `tests/e2e/test_relay_stream_delivery.py` additionally
runs this Provider over an existing local image or isolated Python environment, with frozen signed
Runner artifacts and synthetic model HTTP endpoints. It checks safe completion,
late rejection, detector failure and cancellation in all three delivery modes.
It distinguishes protocol frames from content and observes actual upstream
generator closure; it does not claim live-model accuracy.

`apply-overlay.py` refuses to patch an unexpected LiteLLM source tree. A LiteLLM
upgrade therefore requires a new version directory and an explicit review.
`verify-overlay.py` runs during the image build and rejects a patch that stops
using the native Provider fields or reintroduces the former bespoke
TaskLattice create/edit form.
