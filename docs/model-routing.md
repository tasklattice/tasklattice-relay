# Model Routings

A Model Routing is TaskLattice Relay's stable access contract for routing managed in LiteLLM. TaskLattice Relay owns the Gateway binding, compliance gate, per-Instance Virtual Key lifecycle, audit trail, and cost attribution. LiteLLM remains the source of truth for Auto Router tiers, deployments, routing policy, affinity, retries, cooldowns, fallbacks, and provider selection.

## Gateway configuration

The built-in Gateway connection is configured under **Platform Setting ->
Infrastructure**. The URL is the LiteLLM API base URL without `/v1`; the master
key is an encrypted control-plane credential and is never returned by the API
or passed to an Instance. The draft must pass LiteLLM's authenticated health
probe before it can be saved. The administrator UI URL is derived by appending
`/ui`.

Every Instance receives a separate Team-scoped Virtual Key restricted to the routing's public model alias. Only the key fingerprint and LiteLLM token identifier are persisted; plaintext key material exists only while the Sandbox is being created.

## Operator interaction

The Model Routing detail page is the readiness boundary. A `READY` routing is shown as **Configured correctly and ready for Instances** only after its LiteLLM binding, Gateway, compliance metadata, and supported capabilities pass validation. The page exposes the stable alias and a concise capability summary, while routing tiers, weights, retries, fallbacks, and provider selection remain in LiteLLM.

Operators can start **Use in new Instance** from a READY routing. TaskLattice Relay carries that routing ID into the Instance workflow, displays the selected routing name and compliance domain, and sends the routing ID in the create request. The control plane then creates the Team-scoped Virtual Key and injects the selected Gateway endpoint and public model alias into the Sandbox. It never silently replaces an explicitly selected unavailable routing with another default.

Opening the general Instance creation flow remains low-friction: TaskLattice Relay selects the single READY default Model Routing automatically. The created Instance detail links back to the exact routing that supplied its inference binding.

## Compliance boundary

Compliance is fail closed. Every effective LiteLLM Router candidate must match
the Model Routing domain. Missing candidate metadata or a CN/Global mixture
prevents the routing from becoming `READY` and blocks new bindings.

For strict deployments, run CN Mainland and Global traffic through separate LiteLLM Gateways, databases, secrets, and network egress. Do not treat request tags, user agents, or client-supplied routing fields as a compliance boundary.

Each backing LiteLLM model must declare `model_info.compliance_domain`. TaskLattice Relay Provider registration writes this metadata explicitly; provider names are never used to infer it.

## LiteLLM version capability

Development and release deployments use LiteLLM 1.106.4 with the TaskLattice
Guard Provider, published by `tasklattice-litellm-guard` as
`ghcr.io/tasklattice/tali-litellm:1.106.4-guard.1` and pinned in `values.yaml`.
Relay reads the Gateway version from the authenticated
`/health/readiness/details` endpoint. Routing capabilities that cannot be
verified remain `UNSUPPORTED` or `UNKNOWN`.

TaskLattice Relay inspects public management APIs and does not read LiteLLM's private PostgreSQL schema. Capabilities that cannot be established from the effective configuration are reported as `UNKNOWN`, never inferred as enabled.
