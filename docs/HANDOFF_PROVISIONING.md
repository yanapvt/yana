# Handoff operator and provider provisioning

Keep all capabilities disabled until staging approval. Generate operator tokens
with an approved secret manager, SHA-256 hash them offline, and place only the
JSON identity set in the secret manager value mapped to
`HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON`. Use unique UUIDs, the smallest role,
an expiry, and a documented owner. The example under `config/` is shape-only.

For rotation, add the new hash, deploy and verify authentication, then mark the
old identity revoked before removing it in a later deployment. Never transmit or
log the plaintext token. Emergency revocation skips the overlap period.

Staff and alert provider selection is `none` by default. The currently supported
adapter name is `http`; endpoints must be HTTPS outside local tests. Store auth
tokens in the deployment secret manager and map them to their named environment
variables. Enable one capability at a time in staging, verify idempotency-key
handling and sanitized receipts, then obtain a separate production approval.

No provider is selected or provisioned by this repository checkpoint.
