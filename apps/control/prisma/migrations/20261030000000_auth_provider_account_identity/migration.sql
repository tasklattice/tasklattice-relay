-- Better Auth 1.7.14 identifies accounts by provider + subject. Keep issuer as
-- Relay profile metadata. Build the new unique key before removing the old one;
-- duplicate provider identities must block migration instead of merging users.
BEGIN;
ALTER TABLE tasklattice.auth_accounts
    ADD CONSTRAINT auth_accounts_provider_id_account_id_key
    UNIQUE (provider_id, account_id);
ALTER TABLE tasklattice.auth_accounts
    DROP CONSTRAINT auth_accounts_issuer_account_id_key;
COMMIT;
