# Project Agent Runtime Bridge

## MVP decision

Hermes is the default Supervisor. OpenClaw remains the second selectable
Supervisor and Deep Agents Code remains last. A Project owns exactly one Agent
Runtime Bridge in its Runtime Namespace. The Bridge is runtime-neutral; Hermes
is its first adapter.

The Bridge publishes only eligible A2A 1.0 Instances from the Project Instance
Registry. Eligibility requires `READY`, `CALLABLE` or `HYBRID`,
`acceptsDelegation`, a validated Agent Card, and a reachable endpoint. Hermes
owns the plan and Kanban lifecycle. The Bridge does not generate a plan or
maintain Supervisor conversation memory.

## Runtime swimlane

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Hermes as Hermes Supervisor + Relay A2A plugin + Kanban
    participant Bridge as Project Runtime Bridge
    participant Control as Relay Control Plane
    participant Garden as Project Agent Garden
    participant Expert as External A2A Expert

    User->>Hermes: Submit a multi-step goal
    Hermes->>Hermes: Create Kanban plan and dependency cards
    Hermes->>Bridge: Discover peers with Coordinator-scoped bearer token
    Bridge->>Control: Project identity + forwarded Coordinator identity
    Control->>Garden: Query the Project Instance Registry
    Garden-->>Control: Eligible READY callable A2A Instances
    Control-->>Bridge: Filtered neutral capability descriptors
    Bridge-->>Hermes: a2a_agents map with Bridge proxy URLs
    Hermes->>Hermes: Create running specialist card
    Hermes->>Bridge: a2a_call(task_id) sends authenticated A2A SendMessage
    Bridge->>Control: Project + Coordinator authenticated proxy request
    Control->>Control: Re-check Instance eligibility and resolve credentials
    Control->>Expert: A2A 1.0 JSON-RPC SendMessage
    Expert-->>Control: Message or Task result
    Control-->>Bridge: Standard A2A response
    Bridge-->>Hermes: Standard A2A response
    Hermes->>Hermes: Plugin audits return/failure; Supervisor completes/blocks card
    Hermes-->>User: Synthesized result with visible scheduling state
```

## Component boundary

The Project Runtime Bridge owns:

- a stable Project-local discovery and delegation endpoint;
- Project-filtered Instance capability projection;
- per-Instance A2A proxy URLs and Agent Card URL rewriting;
- JSON-RPC `SendMessage` pass-through plus HTTP+JSON `/message:send`
  translation for A2A 1.0 provider interfaces;
- transport isolation between a Supervisor container and provider endpoints;
- a Project-scoped signed identity when calling Control;
- forwarding a separately signed Coordinator Instance identity for every
  discovery, Agent Card, and delegation request.

The Bridge is stateless: its Deployment uses only an ephemeral `/tmp` volume
and does not create or mount a PVC.

The Control Plane continues to own Agent Garden registration, the Instance
Registry, Agent credentials, capability filtering, Project ownership checks,
and audit integration. A2A `SendMessage` does not carry a mandatory skill
identifier, so the MVP advertises the validated Agent Card but does not claim
cryptographic per-skill enforcement inside a free-form delegated prompt.

The Bridge explicitly does not own LLM planning, task-graph generation, Hermes
Kanban state, global session memory, or cross-Project routing.

## Isolation and deployment

Project Runtime reconciliation server-side applies one Secret, PVC, Service,
Deployment, and NetworkPolicy into the opaque Project Namespace. The Bridge Pod
does not mount a Kubernetes service-account token, database credentials, Agent
credentials, or the global Runner token. It receives a Project Bridge HMAC token
whose signed payload fixes both `projectId` and Runtime Namespace. Each Hermes
Instance separately receives a Coordinator HMAC token fixing `projectId`,
Namespace, and `coordinatorInstanceId`; the Bridge can forward but cannot forge
that identity. Control verifies both signatures and the current Runtime Target
before serving a request. A deleted Coordinator also loses access because the
active Supervisor record and its `canDelegate` capability are resolved on every
call.

The PVC is intentionally present in the MVP although A2A discovery remains API
backed. Later reconcilers can materialize Project-approved MCP configuration,
Vector Database indexes/manifests, Skill archives, and other capability bundles
there without changing the Bridge Service contract.

## Hermes adapter

At sandbox bootstrap, Relay:

1. adds an OpenShell network rule for the Project-local Bridge only;
2. fetches the current eligible Project A2A Instances;
3. validates every peer URL remains under the Bridge origin;
4. writes only the authenticated dynamic Registry endpoint into Hermes
   configuration;
5. enables Relay's bundled `tali-a2a` outbound plugin plus the `a2a` and
   `kanban` toolsets;
6. instructs the Supervisor to create a `blocked` Kanban card assigned to the
   reserved `tali-a2a` assignee and pass its `task_id` to every A2A call.

The sandbox is pinned to Hermes v0.19.0, which includes Kanban but does not
ship the newer upstream A2A plugin. Relay therefore overlays a deliberately
small outbound-only compatibility plugin. It registers `a2a_list`,
`a2a_discover`, and `a2a_call` through Hermes' stable plugin API, supports A2A
1.0 JSON-RPC `SendMessage`, and refuses arbitrary call URLs or Agent Card
cross-origin redirects. `a2a_call` requires an existing Kanban `task_id`,
promotes and claims the reserved card as `running` through Hermes' own Kanban
APIs, and writes neutral start/return/failure audit comments itself. Starting
blocked prevents Hermes' local worker dispatcher from racing the external A2A
dispatch. The Supervisor still owns task creation, dependencies, evidence
synthesis, and final complete/block state. The image build runs the plugin against the pinned Hermes plugin
manager, performs a real loopback A2A call, and verifies the two Kanban audit
events.

The Relay A2A plugin refreshes the Project Registry whenever `a2a_list`,
`a2a_discover`, or `a2a_call` resolves a peer. Creating, removing, or changing
the readiness of an A2A Instance therefore does not require a Hermes restart.
The MVP surfaces an immediate
A2A Message or Task state from `SendMessage`; it does not yet poll a remote
long-running Task, consume streaming responses, or register push
notifications. Hermes should leave or block the corresponding Kanban card when
the returned Task is still non-terminal.

## OpenClaw compatibility

No core Control route contains Hermes concepts. The only Hermes-specific route
is the thin `/v1/hermes/a2a-agents` presentation endpoint in the Bridge.
OpenClaw can reuse the neutral `/v1/agents` directory and identical Project-local
per-Agent A2A URLs through its own plugin/config adapter. Credentials, approval
decisions, Project isolation, and provider calls remain unchanged.
