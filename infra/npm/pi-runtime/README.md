# Pi runtime dependency overlay

The source and all `@earendil-works/pi-*` packages remain at **0.84.1**,
selected by NemoClaw v0.0.138. These files replace only the installed
`pi-coding-agent` package metadata and dependency lockfile; the agent's
JavaScript, CLI, documentation, and assets come from the upstream image.

The original Pi package publishes its own npm shrinkwrap. Overrides on
NemoClaw's outer installer do not override that nested shrinkwrap. Therefore
Relay runs `npm ci --omit=dev --ignore-scripts` inside the installed Pi package
using this reviewed package-lock (npm 12 does not load the published
shrinkwrap for `npm ci`), and removes the now-obsolete outer installer lock.
Audit the installed Pi package directory, whose package-lock describes the
actual runtime graph.

Changes from the published 0.84.1 metadata:

- `undici`: 8.9.0 to 8.12.2, fixing HTTP request and cookie vulnerabilities.
- `brace-expansion`: override 5.0.9 to 5.0.12, fixing resource exhaustion.
- `zod`: override 3.25.76 to 4.6.6, fixing prototype pollution. Its runtime
  consumer, `@mistralai/mistralai`, accepts either Zod 3 or 4.
- Development dependencies are omitted; no agent source rebuild is performed.

The Docker build checks the production dependency audit, imports the Pi AI,
agent core and client modules, checks `pi --version`, and runs bootstrap tests.
Relay additionally verifies native TUI inference and session recovery after
sandbox restart against its existing Model Routing.

Sources:

- https://github.com/NVIDIA/NemoClaw/tree/v0.0.138/agents/pi
- https://github.com/advisories/GHSA-w293-vg96-wgc3
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/advisories/GHSA-q2hr-2g5m-vwhr
