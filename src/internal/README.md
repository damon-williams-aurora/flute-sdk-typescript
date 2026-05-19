# `src/internal/`

Implementation details that are NOT part of the public API:

- `http.ts` — fetch wrapper, retry policy, idempotency keys, timeouts.
- `tokenManager.ts` — OAuth client_credentials flow, proactive +
  reactive refresh.
- `logger.ts` — pluggable logger with redaction of secrets / tokens /
  PAN / CVV.

Anything in this folder may break between minor versions. Consumers
MUST NOT import from `@getflute/sdk/internal` (we don't publish that
subpath on purpose).
