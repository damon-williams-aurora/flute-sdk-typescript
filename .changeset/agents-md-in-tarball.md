---
'@getflute/sdk': patch
---

Ship `AGENTS.md` in the published npm tarball and expand it with three new sections: `Method-by-method request shapes` documents the literal request body for every mutating method (including the `transactionDetails.cardData` nesting on `sale` / `authorize` and the partial-amount rules on `capture` / `refund`), `Sandbox test cards` lists the deterministic PANs for the SandboxCard and TSYS sandbox processors with their expected response codes, and `UI integration patterns` captures the settings-prefetch flow for `paymentProcessorId`, last-id chaining, two-stage confirms for production-environment mutating calls, the test-card preset selector, and sensitive-field masking. No runtime changes.
