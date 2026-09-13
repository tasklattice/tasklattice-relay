# Routing-owned data boundaries (proposal, pending confirmation)

## Implemented first step

Provider registration starts with the complete, searchable Provider catalog in a product-maintained popular-first order. Credentials and endpoint configuration follow. Qwen and Moonshot expose endpoint region because API keys are regional. Provider registration and management no longer ask users to choose a compliance policy.

The existing API and stored records are preserved in this first step. New registrations use the legacy GLOBAL value (no residency restriction), except Qwen/Moonshot China endpoints use CN_MAINLAND to satisfy existing server validation. These compatibility values are not verified endpoint-location evidence. Existing Routing constraints remain unchanged until the following proposal is approved.

## Proposed interaction

Routing owns an optional “Data boundary” setting. Default: “No residency restriction”. A user may restrict a route to Mainland China, EU/EEA, US, UK, or APAC excluding Mainland China. Selecting a policy shows which primary, fallback, complex-task, semantic-route, and embedding deployments qualify, and why others do not. Existing selections that become invalid remain visible with actionable errors; never silently replace them.

An unrestricted route may combine deployments across regions. Restricted routes require every inference hop, including routing classifiers and embeddings, to satisfy the boundary. Unknown endpoint location cannot qualify for a restricted route. For custom/self-hosted deployments, location declarations and evidence are managed from the Routing validation flow rather than blocking Provider onboarding.

## Required implementation

1. Separate endpoint facts (region, provenance, verification status) from the Routing policy. Provider brand and endpoint hostname alone must not be treated as residency proof, especially for aggregators and cross-region cloud inference.
2. Replace the UI's `sameBoundary*Models` equality filters and backend `requireDeployment` equality test with one shared policy-compatibility rule. GLOBAL means no policy restriction, not a physical region.
3. Apply the rule to route creation/editing, refresh/validation, LiteLLM backing-deployment inspection, and instance binding. Reject restricted routes with incompatible or unknown hops before activation and prevent out-of-boundary fallback at runtime.
4. Preserve existing restricted routes and their enforcement during migration. Existing legacy compliance values need provenance and cannot silently become verified physical-location facts. Policy or endpoint changes invalidate the relevant validation and surface affected routes/consumers.

## Acceptance scenarios

- Provider registration never requires a data-boundary choice.
- Unrestricted Routing accepts both a China-region deployment and a global deployment.
- China-only Routing rejects a global or unknown-location fallback with an explicit reason.
- A restricted primary with an out-of-boundary embedding/classifier also fails validation.
- Editing a boundary does not silently discard models or activate an invalid route.
- Existing restricted routes retain their policy throughout migration.

This proposal controls data-residency routing, not legal certification.
