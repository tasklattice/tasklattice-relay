# Model Routing interaction design

Status: Implemented full-stack domain

## Product definition

Inference configuration uses three explicit resources:

- A **Provider** is a configured model source owned by one Department or
  Project. It contains the credentials, endpoint, compliance boundary, and
  connection health needed to discover and call models.
- A **Model** is one callable model registration supplied by a Provider. The
  same logical model can be registered more than once when it comes from
  different Providers, endpoints, regions, or commercial agreements.
- A **Routing** is the stable inference contract consumed by an Instance. It
  selects from registered Models and applies retries and fallback policy.

```text
Provider → registered Models
  → LiteLLM public alias and routing behavior
  → compliance, isolated credentials, audit, and lifecycle
  → consuming Instances
```

Instances consume Routing and do not select Provider credentials directly.

## Information architecture

Department and Project settings use the same ordered navigation:

1. **Providers** — configure scope-owned model sources and connection health.
2. **Models** — register callable models from those Providers.
3. **Routing** — compose registered Models into stable choices for Instances.

Providers are never inherited or assigned from a Department to a Project.
Credentials and endpoint ownership remain inside the scope where the Provider
was configured. Departments can assign Models or Routing to Projects as live,
read-only references; a Project can also configure its own Providers, Models,
and Routing.

The Routing detail page contains:

- **Overview** — stable contract, end-to-end inference path, readiness.
- **Routing & upstream** — public alias, detected capabilities, and available
  upstream inventory.
- **Access & policy** — identity, credentials, compliance, audit, lifecycle.
- **Consumers** — Instances and their isolated key fingerprints.
- **Audit** — control-plane history.

## Domain boundaries

TaskLattice Relay owns the Routing identity, readiness boundary, compliance gate,
per-Instance Virtual Key lifecycle, consumer relationship, and audit trail.

LiteLLM remains the source of truth for actual router candidates, weights,
tiers, retries, cooldowns, fallbacks, and provider selection. The current API
does not expose a trustworthy Routing-to-deployment candidate graph, so the UI
labels registered Provider models as an **available upstream pool** and never
claims that every registered model belongs to the selected Routing.

## Primary workflows

### Create a Routing

1. Define the consumer-facing name and description.
2. Select a validated, compliance-compatible model from the upstream pool.
   TaskLattice Relay uses its registered LiteLLM model name as the Routing binding.
   Binding an existing router alias remains available as an advanced option.
3. Review inherited routing boundary, upstream readiness, compliance,
   per-Instance credentials, and audit policy.
4. Create and validate the Routing.

### Add a Provider

Adding a Provider configures new credentials, validates the endpoint, discovers
its catalog, and registers at least one Model in one progressive flow. This
keeps the Provider useful at creation time and preserves transactional cleanup
when registration fails.

### Register more Models

An existing Provider can be reused to discover and register additional Models
without asking for its credentials again. The Model list identifies the
supplying Provider so identical model IDs from different Providers remain
distinct.

### Consume a Routing

A READY Routing can start the Create Instance flow. Instance creation and
Instance detail consistently display **Model Routing**, including its routing,
compliance, and failover summary.

## API and persistence

Model Routings are first-class resources across contracts, control-plane
services, REST routes, LiteLLM metadata, audit events, Agent bindings, and
PostgreSQL persistence. The canonical collection is
`/api/v1/model-routings`; resource routes use `{routingId}`. There are no
legacy aliases.

Development databases created from the earlier schema must be recreated; the
initial migration is intentionally destructive during this development phase.
