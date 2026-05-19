# AGENTS.md — using `@getflute/sdk` from an AI agent

This file documents the machine-readable contract for autonomous
agents (Claude Code, GPT function-calling subprocesses, Cursor,
custom orchestrators) that need to integrate with Flute from a
Node.js or TypeScript runtime. Humans should read [`README.md`](README.md)
instead — it has the same information shaped for narrative reading,
plus tutorial flows, test cards, and merchant onboarding context.

The unit of work for an agent here is **writing TypeScript / Node.js
code that imports `@getflute/sdk` and runs against the Flute
backend**, not invoking a CLI. Treat this document as the contract
between the agent's planner and the SDK's runtime.

## TL;DR

```bash
npm install @getflute/sdk
```

```ts
import { Flute, FluteApiError, Environment } from '@getflute/sdk';

const flute = new Flute({
  environment: Environment.Sandbox, // 'sandbox' (UAT) or 'production'
  clientId: process.env.FLUTE_CLIENT_ID!,
  clientSecret: process.env.FLUTE_CLIENT_SECRET!,
});

await flute.sessions.authenticate(); // surface bad credentials immediately
const settings = await flute.settings.getPaymentSettings();
```

Credentials are read from env vars; never embed them in source. The
SDK caches the OAuth bearer token in-process and refreshes
transparently. Every error thrown extends `FluteError` — branch on
the subclass first, then on `httpStatus` for retry decisions.

## Install

```bash
# Production-ready install:
npm install @getflute/sdk

# Pin to exact patch for reproducible CI:
npm install @getflute/sdk@0.2.0 --save-exact
```

Engines: Node `>= 20.19.0`. The SDK ships ESM and CJS builds with full
`.d.ts` types. Provenance attestation is published to the npm registry
on every release; `npm audit signatures` will verify the chain back to
`getflute/flute-sdk-typescript@release.yml`.

## Authentication for agents

The agent-friendly path uses environment variables exclusively:

```bash
FLUTE_CLIENT_ID=…       # OAuth2 client_id provisioned on the Flute dashboard
FLUTE_CLIENT_SECRET=…   # paired secret. Never log this. Never commit it.
FLUTE_ENV=sandbox       # optional helper for the agent's own env loader
```

The SDK does not read `process.env` itself — pass the values into the
constructor. The agent (or its config layer) is responsible for
loading them from `.env`, secret manager, or the runtime environment.

```ts
const flute = new Flute({
  environment: process.env.FLUTE_ENV === 'production' ? 'production' : 'sandbox',
  clientId: process.env.FLUTE_CLIENT_ID!,
  clientSecret: process.env.FLUTE_CLIENT_SECRET!,
});
```

A bearer token is fetched on demand from `${oauth}/oauth2/token` (form-
urlencoded `client_credentials` grant), cached in-memory for the
advertised TTL minus a 60s safety margin, and refreshed once on a 401
during a normal API call. The agent does not see or need to handle
tokens directly. To force a refresh (token rotation, key compromise,
test scenarios):

```ts
await flute.sessions.refreshAccessToken();
```

For multi-process or serverless workloads where each cold start should
not re-authenticate, swap `MemoryTokenStorage` for a Redis/KV-backed
implementation:

```ts
import type { TokenStorage, StoredToken } from '@getflute/sdk';

class RedisTokenStorage implements TokenStorage {
  async get(key: string): Promise<StoredToken | undefined> {
    /* … */
  }
  async set(key: string, value: StoredToken): Promise<void> {
    /* … */
  }
  async delete(key: string): Promise<void> {
    /* … */
  }
}

const flute = new Flute({
  environment: 'sandbox',
  clientId: process.env.FLUTE_CLIENT_ID!,
  clientSecret: process.env.FLUTE_CLIENT_SECRET!,
  tokenStorage: new RedisTokenStorage(),
});
```

`StoredToken.expiresAt` is a UNIX **millisecond** timestamp (the JSDoc
clarifies this; the field name is unit-ambiguous on autocomplete).

## API surface

All resources hang off the `Flute` instance. The four namespaces are
the entire public surface; anything else is internal and may change
without a semver bump.

| Namespace               | Methods                                                                                 | Backing endpoint family                |
| ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------------- |
| `flute.sessions`        | `init`, `authenticate`, `getAccessToken`, `refreshAccessToken`, `clearStoredToken`      | `${oauth}/oauth2/token`                |
| `flute.settings`        | `getPaymentSettings`                                                                    | `${isvApi}/v2/settings/payment-config` |
| `flute.transactions`    | `list`, `retrieve`, `sale`, `authorize`, `capture`, `void`, `refund`, `calculateAmount` | `${isvApi}/v2/transactions[/...]`      |
| `flute.paymentSessions` | `create`, `retrieve`, `cancel`                                                          | `${payIntApi}/payment-sessions[/...]`  |
| `flute.webhooks`        | `verifySignature`                                                                       | (offline; no network call)             |

Every method returns a typed Promise. Field types are derived from
`openapi/isv-api-v2.json` and surfaced as named exports from the
package root. Wire format is `camelCase`; the SDK does not transform.

## Output / error contract

### Success

Resource methods return the parsed response body, typed against the
OpenAPI spec. Pagination is exposed as `{ items, total }` for
`transactions.list`. There is no envelope on success — the response is
the resource itself.

### Failure

Every error thrown by the SDK extends `FluteError`. Discriminate on
the subclass first:

| Subclass                   | When                                                                                           | Retry guidance                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FluteAuthenticationError` | OAuth handshake or 401 on resource call                                                        | Verify `clientId` / `clientSecret`. Do not retry the same call without rotating credentials.                                       |
| `FluteValidationError`     | Server returned 400 or the SDK rejected the input shape locally                                | Permanent for this request shape. Surface the `correlationId` and the validation messages to the operator.                         |
| `FluteRateLimitError`      | 429 from the gateway                                                                           | Honor `retryAfterMs`. Default `retryOn429 = false` so the SDK does NOT retry; the agent must back off.                             |
| `FluteIdempotencyError`    | 409 on a state-changing call where the same `Idempotency-Key` was reused with a different body | Pick a fresh idempotency key OR replay the original body verbatim.                                                                 |
| `FluteApiError`            | Any other non-2xx with a JSON body the SDK could decode                                        | Branch on `httpStatus`: 5xx → transient, retry with backoff; 4xx → permanent.                                                      |
| `FluteNetworkError`        | Connection reset, DNS failure, timeout                                                         | Transient; retry with backoff.                                                                                                     |
| `FluteWebhookError`        | Caller passed malformed inputs to `verifyWebhookSignature`                                     | Programming error. The function returns `false` for crypto mismatches; it throws only for empty / missing / wrong-type parameters. |
| `FluteConfigurationError`  | `new Flute(...)` rejected the config                                                           | Programming error. Fix the constructor call and re-launch.                                                                         |

Common fields available on every `FluteApiError`:

```ts
err.httpStatus; // number, the HTTP status the gateway returned
err.errorCode; // string, the Flute-defined error code (e.g. "I0000")
err.correlationId; // string, opaque id to share with support
err.requestId; // string, this SDK's per-call request id (for log search)
```

Branch on the kind first, then on `httpStatus`:

```ts
try {
  await flute.transactions.sale(/* ... */);
} catch (err) {
  if (err instanceof FluteAuthenticationError) {
    /* re-issue creds */
  } else if (err instanceof FluteRateLimitError) {
    await sleep(err.retryAfterMs ?? 1000);
    /* then optional retry */
  } else if (err instanceof FluteApiError && err.httpStatus >= 500) {
    /* transient — retry with backoff */
  } else {
    /* permanent — surface to operator with err.correlationId */
    throw err;
  }
}
```

## Idempotency

State-changing methods accept an `idempotencyKey` per call. The SDK
auto-generates one if you omit it; pass it explicitly to make the call
retry-safe across SDK invocations (e.g. consume the same key on a
webhook-driven retry job).

| Method                                     | Safe to retry without action? | Notes                                                                                   |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| `transactions.list` / `retrieve`           | yes                           | Pure read.                                                                              |
| `settings.getPaymentSettings`              | yes                           | Pure read.                                                                              |
| `transactions.calculateAmount`             | yes                           | Pure read; no transaction is created.                                                   |
| `transactions.sale` / `authorize`          | **no**                        | Pass an explicit `idempotencyKey` if your retry path is not under the SDK's auto-retry. |
| `transactions.capture` / `void` / `refund` | **no**                        | Same. Pair the key with the originating event id.                                       |
| `paymentSessions.create`                   | **no**                        | Each call without a stable idempotency key creates a new session.                       |
| `paymentSessions.retrieve` / `cancel`      | yes                           | `cancel` on an already-cancelled session is a no-op on the server.                      |
| `sessions.authenticate` / `getAccessToken` | yes                           | The SDK serialises concurrent calls and shares the result.                              |

```ts
await flute.transactions.sale(
  {
    /* params */
  },
  { idempotencyKey: `order-${order.id}` },
);
```

## Webhook verification

The Flute Notifications Service signs every delivery with HMAC-SHA256.
Verification is offline — the SDK does not hit the network.

Required headers on the inbound request:

| Header                    | Description                                 |
| ------------------------- | ------------------------------------------- |
| `Flute-Webhook-ID`        | Unique delivery identifier.                 |
| `Flute-Webhook-Timestamp` | UNIX timestamp in **seconds**, as a string. |
| `Flute-Webhook-Signature` | `v1,<base64(hmac-sha256)>`.                 |

The signed payload is `${idHeader}.${timestampHeader}.${rawRequestBody}`,
where `rawRequestBody` is the original bytes the framework received,
**not** a re-serialised JSON. Re-serialising breaks the HMAC because
key order and whitespace differ.

```ts
import { verifyWebhookSignature, FluteWebhookError } from '@getflute/sdk';

// Object form — preferred:
const ok = verifyWebhookSignature({
  signatureHeader: req.headers['flute-webhook-signature'] as string,
  idHeader: req.headers['flute-webhook-id'] as string,
  timestampHeader: req.headers['flute-webhook-timestamp'] as string,
  rawRequestBody: req.rawBody, // Buffer or string
  signatureSecret: process.env.FLUTE_WEBHOOK_SECRET!,
});
if (!ok) return res.status(401).end();
```

Returns `false` on any cryptographic mismatch, expired timestamp,
malformed scheme, or non-base64 signature payload. Throws
`FluteWebhookError` only when verification cannot be attempted at all
(missing or empty parameter). Default replay-protection window is 5
minutes; override with `{ toleranceSeconds }` if needed (set to
`Infinity` to disable, strongly discouraged in production).

## Environments

| Environment     | Core REST API                              | Pay-Int API                                            | OAuth                                        |
| --------------- | ------------------------------------------ | ------------------------------------------------------ | -------------------------------------------- |
| `sandbox` (UAT) | `https://api.uat.arise.risewithaurora.com` | `https://api.uat.arise.risewithaurora.com/pay-int-api` | `https://oauth.uat.arise.risewithaurora.com` |
| `production`    | `https://api.arise.risewithaurora.com`     | `https://api.arise.risewithaurora.com/pay-int-api`     | `https://oauth.arise.risewithaurora.com`     |

Sandbox and production credentials are **separate**. Provisioning
each pair is the operator's responsibility; the agent never creates
them.

The SDK enforces HTTPS on every base URL except `localhost`,
`127.0.0.1`, and `[::1]`, which are accepted over plain HTTP for local
development. Per-environment overrides are accepted under `baseUrls`:

```ts
const flute = new Flute({
  clientId: 'local-dev',
  clientSecret: 'local-dev',
  environment: 'sandbox',
  baseUrls: {
    isvApi: 'http://localhost:5001',
    payIntApi: 'http://localhost:5002/pay-int-api',
    oauth: 'http://localhost:5003',
  },
});
```

## Common intents → code

| Intent                                                                 | Snippet                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What payment methods is this merchant configured for?"                | `await flute.settings.getPaymentSettings()`                                                                                                                     |
| "Show me the last 25 transactions"                                     | `await flute.transactions.list({ pageSize: 25 })`                                                                                                               |
| "Look up a specific transaction by id"                                 | `await flute.transactions.retrieve(id)`                                                                                                                         |
| "Charge $10 USD on a card (auto-capture)"                              | `await flute.transactions.sale({ baseAmount: 1000, currencyCode: 'USD', transactionDetails: { /* card data */ } })`                                             |
| "Authorize $10 now, capture later"                                     | `await flute.transactions.authorize({ baseAmount: 1000, currencyCode: 'USD', transactionDetails: { /* card */ } })` then `await flute.transactions.capture(id)` |
| "Refund a settled transaction"                                         | `await flute.transactions.refund(id, { amount: 1000 })`                                                                                                         |
| "Void an authorization before capture"                                 | `await flute.transactions.void(id)`                                                                                                                             |
| "What does this $10 charge actually cost the customer with surcharge?" | `await flute.transactions.calculateAmount({ baseAmount: 1000, pricingType: 'Card', currencyCode: 'USD' })`                                                      |
| "Create a hosted payment session URL to send to the buyer"             | `await flute.paymentSessions.create({ /* params */ })`                                                                                                          |
| "Verify a webhook delivery I just received"                            | See "Webhook verification" above.                                                                                                                               |

`baseAmount` is in the merchant's smallest currency unit (`1000` =
$10.00 USD). Always pass `currencyCode` explicitly even though the
OpenAPI spec marks it optional — the live API returns HTTP 500 if it
is omitted.

## Things to avoid

- **Don't omit `currencyCode` in `calculateAmount`.** Despite the
  OpenAPI spec marking it optional with a `"USD"` default, the live
  backend returns HTTP 500 (`Validation failed: CurrencyId must be
greater than 0`) if it is missing. Always pass `currencyCode: 'USD'`
  (or the merchant's currency) explicitly.
- **Don't construct multiple `Flute` instances per process** unless
  you need different credentials. The OAuth token cache is
  per-instance; spawning N clients fans out to N concurrent token
  fetches and lets them race against the gateway's rate limit.
- **Don't ignore `FluteRateLimitError`.** `retryOn429` is `false` by
  default to keep the SDK predictable. The agent owns the backoff
  policy. Honor `err.retryAfterMs` if present.
- **Don't reuse the same `idempotencyKey` for different request
  bodies.** The server returns `FluteIdempotencyError` (HTTP 409) when
  the key is recognized but the body differs. Either replay the
  original body verbatim or pick a fresh key.
- **Don't re-serialise the webhook body before verifying.** Capture
  the raw bytes the framework received (Express: `req.rawBody` via
  `body-parser`'s `verify` callback; Fastify: `request.body` is the
  parsed object — set up a content-type parser to keep the raw
  stream).
- **Don't share `MemoryTokenStorage` across processes.** It is
  in-process only. Use a Redis / KV-backed `TokenStorage` for
  multi-replica deployments so cold starts and concurrent replicas do
  not all re-authenticate.
- **Don't log `clientSecret`, `accessToken`, or webhook secrets.** The
  SDK redacts these in its own debug output; agent-side logging is
  the agent's responsibility.
- **Don't disable HTTPS on production.** The SDK enforces it on
  non-loopback URLs by design.

## See also

- [`README.md`](README.md) — human-readable overview, install +
  quickstart, common recipes, environment guidance, test cards.
- [`src/index.ts`](src/index.ts) — public API entry point. Anything
  not re-exported there is internal.
- [`openapi/isv-api-v2.json`](openapi/isv-api-v2.json) — wire-format
  source of truth (spec the type generator consumes).
- [`src/types/generated/isv-api-v2.d.ts`](src/types/generated/isv-api-v2.d.ts) —
  generated DTO types. Regenerate with `npm run openapi:types`.
- [`src/errors.ts`](src/errors.ts) — full error class hierarchy with
  constructor signatures.
- [`CHANGELOG.md`](CHANGELOG.md) — release history; bug fixes and
  breaking changes are flagged here.
