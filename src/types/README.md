# `src/types/`

Hand-rolled DTOs that mirror the Flute REST API contract, plus a
`generated/` subfolder produced by `npm run openapi:types`.

Naming convention:

- camelCase on the wire-facing TS side; JSON `snake_case` payloads are
  remapped at the HTTP boundary.
- Each resource has its own file (`transactions.ts`,
  `paymentSessions.ts`, `settings.ts`, `webhooks.ts`).
- Types intended for consumers are re-exported from `src/index.ts`.

The codegen strategy is hand-rolled methods on top of
`openapi-typescript`-generated DTOs.
