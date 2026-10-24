# Version-Consistent Safety Enforcement for Agent Platforms

> Working paper draft, 2026-09-23. This is a research proposal and manuscript
> skeleton. Formal claims below concern an abstract protocol under stated
> assumptions. Relay and Guard do not yet implement the joint protocol, and no
> model-checking or end-to-end proof is claimed.

## Abstract

Agent platforms evaluate mutable definitions, publish immutable versions, deploy
instances asynchronously, and mediate effectful calls while safety policies can
change independently. This creates a version-consistency problem: a passing
evaluation may refer to an earlier agent definition; a running request may
observe different protection releases; and authorization may be revoked after
a request begins. We propose a versioned execution context that binds an
evaluated agent digest, a concrete runtime instance, and a signed protection
release, while checking mutable authorization at the admission point of each
external action. We specify four safety properties: evaluation freshness at
publication, protection-release consistency per call, authorization before
effectful admission, and checked-byte delivery for streamed output. We give an
inductive argument for no premature output in full-buffered mode. The planned
evaluation combines bounded state exploration, implementation trace checking,
fault injection, and measurements of utility and latency. The guarantees are
conditional on complete mediation and correct enforcement components; they do
not establish semantic correctness of model outputs or detector completeness.

**Keywords:** AI agents; runtime enforcement; version consistency; formal
methods; policy rollout; streaming safety.

## 1. Introduction

An agent platform has several clocks. A developer can edit an agent after its
latest successful evaluation. A control plane can publish a new protection
release while old calls are still running. A reviewer can revoke permission
during an in-flight tool invocation. A model can emit output before a detector
has seen enough context to judge it. Treating any single UI state such as
"published" or "protected" as proof of runtime safety hides these races.

We ask: **Under what assumptions can a platform guarantee that every admitted
external action and every delivered output byte is governed by an identifiable
agent version, protection release, and authorization decision?**

Our proposed contribution is a platform control contract spanning development
evidence, deployment, runtime identity, policy rollout, and output delivery.
We separate immutable configuration consistency from mutable authority:
protection releases are pinned for a call, whereas authorization is checked at
each effectful admission point. This separation allows a call to remain
reproducible without silently preserving a revoked privilege.

This is distinct from proving an LLM's reasoning correct. A platform can prove
that an action was admitted under a policy, but a policy may be incomplete; a
detector can return `allow` for harmful content. We report such semantic quality
with empirical evidence, separately from protocol invariants.

### 1.1 Current system and proposed extension

The following are repository observations, not joint-platform guarantees:

| Mechanism | Current evidence | Research status |
| --- | --- | --- |
| Relay rejects publish evidence for a stale content digest | [Relay publish-readiness predicate](../../apps/control/server/expert-agents/expert-agent-domain.ts) | Implemented local gate; formal model and runtime linkage remain to be checked |
| Relay separates immutable Version from explicit Instance creation | [Agent Developer architecture](../agent-developer-architecture.md) | Existing lifecycle; true instance identity must be carried through execution evidence |
| Guard signs compiled artifacts and stages an atomic release | [Guard architecture](../../../tasklattice-guard/docs/architecture.md), [artifact verification](../../../tasklattice-guard/runner/artifact_store.py) | Existing Guard boundary; no proven Relay-to-Guard joint identity binding |
| Guard specifies full, window, and interruptible output delivery | [Guard gateway contract](../../../tasklattice-guard/docs/gateway-integration.md) | Guard API contract; the caller must implement delivery correctly |
| Relay admits scoped capabilities and resource relations | [Authorization snapshot](../capability-authorization.md) | Current route coverage is narrower than a proof of complete tool and network mediation |

## 2. Threat model and trust assumptions

The adversary can control prompts, retrieved documents, model outputs, tool
arguments, and the timing of requests. The adversary may exploit concurrent
publishing, delayed messages, retries, Runner replacement, and policy or
authorization changes. We do not assume the Agent process follows instructions.

The initial model trusts the control plane's transaction boundary, signature
verification, digest computation, the enforcement gateway, and the isolation
mechanism that prevents bypassing that gateway. It assumes cryptographic
hashes are collision resistant and signatures and scoped runtime credentials
cannot be forged. It excludes host or cluster administrator compromise and
side channels. These assumptions must be tested or supported by deployment
controls; they cannot be inferred from a TLA+ model.

The **complete-mediation assumption** is decisive: every external effect and
every client-visible output byte must pass the modeled admission or delivery
interface. If an Agent can call a tool or external service directly, the theorem
does not apply to that path. The first implementation task is therefore an
egress and tool-surface inventory, including all Supervisor variants and A2A,
MCP, model, and direct HTTP routes.

## 3. Proposed formal model

Let an agent version `v` contain immutable content digest `digest(v)` and a
reference to evaluation evidence `eval(v)`. Let an instance `i` name one
project and one version. Let protection release `r` identify a signed artifact
set and routing revision. A call `c` starts with a proposed execution context:

```text
Context(c) = (projectId, instanceId, agentVersionId,
              agentDigest, guardReleaseId, routingRevisionId)
```

The context is a **proposed protocol object**, not a current Relay/Guard API.
Its fields are fixed at call admission. A separate authorization state
`AuthState(t)` is read at each effectful operation's admission time. If strong
revocation after admission is required, the external target must also validate
a short-lived or epoch-fenced capability; a control-plane check alone cannot
retract an already accepted external side effect.

The abstract state contains drafts, evaluation records, published versions,
instances, signed Guard releases, Runner activation state, calls, tool
admissions, stream buffers, and delivered bytes. Transitions include `Edit`,
`Evaluate`, `PublishVersion`, `CreateInstance`, `ActivateGuardRelease`,
`StartCall`, `AdmitTool`, `AppendOutput`, `CheckOutput`, `Deliver`, `Revoke`,
and failure/retry transitions. Publication and activation have separate states:
a built version is not automatically deployed, and a desired release is not
automatically active on every Runner.

### 3.1 Safety properties to verify

**P1 — Fresh publication evidence.** For every published version `v`, its
passing release-mode evidence refers to `digest(v)` and the required test
suite version. The present Relay gate checks the content digest; pinning and
checking evaluator and dataset versions is part of the proposed stronger
research contract.

```text
Published(v) => Passed(eval(v)) /\
                EvalDigest(eval(v)) = digest(v) /\
                EvalSuite(eval(v)) = RequiredSuite(v)
```

**P2 — Per-call release consistency.** Every Guard decision used by call `c`
comes from `guardReleaseId` recorded at `StartCall`. If a Runner cannot serve
that release, the call fails without substituting the newest available one.

```text
GuardDecision(c, d) => Release(d) = Context(c).guardReleaseId
```

**P3 — Authorized effect admission.** Every admitted external action has a
scoped identity and a permit decision at its admission linearization point.
This is an admission property; a stronger claim about completed remote effects
requires cooperation from the target service or a fenced capability.

```text
AdmitTool(c, op, resource, t) =>
  Permit(AuthState(t), Context(c).projectId,
         Context(c).instanceId, op, resource)
```

**P4 — Checked-byte delivery.** In full-buffered mode, no output byte is
delivered before the final Guard check completes successfully. Once complete,
newly delivered bytes are exactly bytes authorized for delivery by that check
(including any approved replacement), never the original unchecked model
chunks. Incremental modes have weaker properties: each released segment has
passed its configured cumulative check, but later context cannot retract bytes
already sent.

```text
mode(c) = full_buffered /\ not FinalCheckPassed(c)
  => Delivered(c) = empty
```

Cross-project isolation can be added as a fifth property after every relevant
data and tool path is included in the mediation inventory. Availability and
eventual rollout convergence are liveness properties and require separate
fairness and infrastructure assumptions.

### 3.2 Example proof obligation: no premature delivery

Consider an abstract full-buffered stream with state `(buffer, check, out)`.
Initially `out` is empty and `check` is pending. `AppendOutput` changes only
`buffer`; `CheckFinal` changes `check` to passed or blocked, and these check
outcomes are terminal; a `Deliver` step is
enabled only when `check` is passed and appends only the returned
`released_text`. Failure and block steps append nothing.

**Lemma (abstract protocol).** In every reachable state with a pending or
blocked final check, `out` is empty.

**Proof sketch.** Induct on the length of an execution. The initial state
satisfies the property. `AppendOutput`, failure, and block preserve `out`.
`CheckFinal` does not modify `out`. `Deliver` is disabled while the check is
pending or blocked. Thus each transition preserves the property. A companion
invariant states that, after a passed check, `out` is a prefix of the returned
`released_text`; its proof additionally requires serial, nonduplicating
delivery. These are statements about the abstract gateway protocol. A trace
conformance check is needed before claiming that a concrete gateway satisfies
the transition relation.

## 4. Verification and implementation plan

**Model exploration.** Encode the transitions in TLA+ and use TLC with small
finite sets of projects, instances, versions, releases, Runners, and calls.
Check P1–P4 under delayed activation, NACK, retries, revocation, replica
switching, missing final chunks, and duplicate responses. Keep generated
counterexample traces and mutation tests that deliberately remove a guard.
Bounded model checking is evidence about the model within chosen bounds, not
an unbounded implementation proof.

**Refinement evidence.** Define a typed event schema for the concrete
implementation: `VersionPublished`, `InstanceCreated`, `CallStarted`,
`GuardDecision`, `ToolAdmitted`, `OutputReleased`, and `CallTerminated`.
Correlate events by real `instanceId`, call ID, agent digest, and Guard release
ID. Replay deterministic scenarios through actual Relay and Guard boundaries
and reject traces that cannot be mapped to legal abstract transitions.

**Required platform changes before an end-to-end claim.** Introduce and
authenticate the joint execution context; carry the real instance ID into
runtime records and traces; connect Relay inference/Agent delivery to a Guard
enforcement point; ensure the gateway applies Guard responses; enumerate and
close bypass routes; and decide the exact revocation semantics for actions
already admitted. Relay currently records `agentId` in a field named
`instanceId` on one evaluation path
([source](../../apps/control/server/expert-agents/expert-agent-validation-service.ts));
this must not be used as evidence of concrete instance attribution.

**Proof strengthening.** If the bounded model stabilizes, prove selected
invariants over the abstract transition relation by induction in a proof
assistant or TLA+ proof system. Do not describe a checked finite model as a
machine-checked universal theorem. Verification of the production code would
still require a justified refinement relation or a much smaller trusted
enforcement kernel.

## 5. Empirical evaluation plan

| Question | Experiment | Report |
| --- | --- | --- |
| RQ1: Which races violate naive version handling? | Compare the proposed pinned-call model with a variant that resolves `latest` on every step; inject publication, NACK, and replica-switch schedules | Counterexample traces and affected decisions |
| RQ2: Does the implementation conform? | Replay model-derived event sequences through real Controller, Runner, gateway, and one Agent path; capture final client bytes | Property violations, trace coverage, environment and commit hashes |
| RQ3: What is the cost? | Compare no Guard, full-buffered, window-buffered, and interruptible modes on the same fixed inputs and detectors | First safe byte latency, p50/p95 completion latency, buffer memory, throughput, model/detector calls |
| RQ4: What does policy enforcement miss? | Independently review a held-out multilingual corpus and tool-action cases; distinguish protocol failure from detector false negatives | Precision, recall, false-positive rate, task completion, confidence intervals |

Include both successful and deliberately failing cases: stale evaluation,
cross-project resource substitution, revoked permission, late output block,
split sensitive string, transform, missing `final`, out-of-order chunk,
cancel, timeout, Redis lease expiry, and old-release call during rollout.
Publish fixtures, scripts, model-checker configuration, traces with secrets
removed, exact dependency/image versions, and an explicit list of excluded
paths. Do not infer model quality from deterministic protocol tests.

## 6. Related work and positioning

Agent-C studies formally specified temporal constraints on Agent actions and
enforces them during generation [1]. Our intended focus is the platform
boundary across evaluated releases, asynchronous rollout, runtime identity,
authorization, and output delivery; this distinction is a proposed research
position, not a priority or novelty claim. NVIDIA NeMo Guardrails documents
the stream-first tradeoff [2]. Our streaming contribution would be a concrete
delivery protocol with version pinning and failure traces, rather than the
claim that streaming rails are new. TLA+ and TLC support state exploration of
the concurrent control protocol [3].

## 7. Limitations and claim ledger

- **Already implemented in separate products:** Relay content-digest publish
  gating and scoped authorization; Guard signed artifacts, Runner activation,
  effective-release pinning, and three output delivery modes.
- **Proposed and unverified:** one authenticated context spanning Relay and
  Guard; complete mediation of all Agent effects and outputs; model-to-code
  trace conformance; bounded model-checking results; unbounded formal proof.
- **Outside formal safety claims:** factual correctness of generated answers,
  completeness of detectors, uncompromised cluster operation, and protection
  for paths that bypass the enforcement gateway.

## References

1. Kamath et al., *Enforcing Temporal Constraints for LLM Agents*, 2025.
   <https://arxiv.org/abs/2512.23738>
2. NVIDIA, *Output Rail Streaming*.
   <https://docs.nvidia.com/nemo/guardrails/latest/configure-rails/yaml-schema/streaming/output-rail-streaming.html>
3. TLA+ Foundation, *TLA+ Tools and TLC*.
   <https://github.com/tlaplus/tlaplus>

## Submission gate for the next draft

Before replacing this working draft with a research PDF, complete the
joint-path implementation inventory, one executable model with checked
invariants and saved counterexamples, one real trace-conformance run, and a
reproducible experiment package. Revise the abstract to report only results
actually obtained.
