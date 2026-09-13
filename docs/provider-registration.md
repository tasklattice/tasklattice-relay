# Provider registration

Provider creation and model registration run external discovery, creation and
capability probes before opening the database transaction. The final transaction
persists the Provider, model records, cost mappings and registration receipt,
and releases their cleanup reservations together. Department Providers use the
same transaction boundary with the Department resource store.

Model probe failures return an API error without inserting a FAILED model or a
cost mapping. Multi-model Provider creation can still return partial success:
only validated models are committed and the response reports failed selections.
The registration drawer also reports each result when adding several models to
an existing Provider.

## Retries and concurrent requests

- An identical Provider creation request replays its stored receipt. The receipt
  key hashes the canonical request; raw credentials are never stored in the
  receipt. A deleted Provider does not prevent a fresh registration.
- Model identity is scoped to Provider, upstream model ID and model type. A retry
  with the same settings returns the existing validated model. Different settings
  require an explicit update, rather than silently replacing the working model.
  Existing unhealthy deployments must be revalidated or explicitly removed; a
  new registration never silently replaces their remote deployment.
- Short PostgreSQL advisory locks serialize commits across control replicas.
  Partial unique indexes independently enforce active model identity.
- Each remote registration attempt gets its own caller-assigned LiteLLM model ID
  and alias. A losing concurrent attempt only cleans its own resources.
- Newly registered models retain their LiteLLM model ID for later deletion.
  Legacy alias deletion refuses ambiguous matches.

## Cleanup after failures

Before an external model or credential write, the control plane persists a cleanup
reservation containing its exact ID/reference. No credential value is recorded.
Successful commits remove the reservations in the same transaction as the local
records. A failed commit therefore cannot leave committed local models with an
untracked cleanup operation, including when the commit response is lost.

Failed requests accelerate cleanup. An uncertain create response delays cleanup
by one minute so a remotely completed write can be found. Failed cleanup remains
in the database and is retried by the existing minute-based control maintenance
job. Each run claims at most five resources, with a one-minute retry lease, to
bound time spent on an unavailable external service. Cleanup treats the pinned
LiteLLM API's specific "model not found" 400 response and 404 as already absent;
other errors remain retryable.

Abandoned in-flight reservations expire after two hours. Long batch registrations
renew reservations as they progress. A registration whose reservation has been
claimed or expired cannot commit. Maintenance and registration use conditional
writes so a completed local commit cannot subsequently be cleaned by a stale
worker.

The receipt/cleanup tables and model-identity indexes are included in the single
initial Prisma migration, following the project's fresh-database development
baseline. This change does not split the shared control/LiteLLM database or claim
to resolve an environment-specific login outage.

## Verification

Use a disposable pgvector PostgreSQL database named
`tali_provider_registration_test`, and apply the current Prisma migration first.
Set `TALI_PROVIDER_TEST_DATABASE_URL` to that database's connection URL, then run:

```sh
npm test --workspace @tali/control -- --maxWorkers=2
```

Without the environment variable, the PostgreSQL-specific suite is skipped.
It uses the real transaction manager and advisory locks, injects database write
failures, tests concurrent requests and compensation retries, and exercises actual
Better Auth sign-in after registration rollback. The suite performs fixture cleanup
and must only be pointed at that disposable test database. Ordinary service tests
still use pg-mem; they cannot prove transaction rollback or lock exclusion.
