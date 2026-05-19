# Changelog

All notable changes to `@getflute/sdk` are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## 0.2.0

### Initial public release

First public release of the official server-side TypeScript / Node.js
SDK for the Flute payment platform under the `@getflute/sdk` scope.

**Capabilities**

- **Auth (`flute.sessions.*`)** — OAuth 2.0 `client_credentials` with
  proactive + reactive refresh, race-safe token coalescing, and a
  pluggable `TokenStorage` (default in-memory; swap for Redis / KV in
  serverless deployments).
- **Transactions (`flute.transactions.*`)** — `list`, `retrieve`,
  `sale`, `authorize`, `capture`, `void`, `refund`, `calculateAmount`.
  Idempotency keys are auto-generated for every state-changing request
  and may be overridden per call.
- **Payment Sessions (`flute.paymentSessions.*`)** — `create`,
  `retrieve`, `cancel` against the Payment Integrations v1 API.
  Accepts both string and numeric `mode`.
- **Settings (`flute.settings.getPaymentSettings`)** — returns the
  merchant's payment configuration (processors, methods, fees).
- **Webhooks (`flute.webhooks.verifySignature`)** — HMAC-SHA256 with
  timing-safe comparison and a configurable replay window.
- **Transport** — `fetch` wrapper with timeouts, exponential backoff
  with full jitter for retries (5xx + network errors), `Retry-After`
  honoring on 429, structured `FluteError` hierarchy, and
  sensitive-field redaction in logger output.
- **Types** — generated from the live `isv-api-v2.json` OpenAPI spec
  via `openapi-typescript`.
- **Tooling** — ESM + CJS dual build, `.d.ts` types, npm provenance
  attestations on every release.
