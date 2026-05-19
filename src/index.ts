/**
 * `@getflute/sdk` — Official server-side SDK for the Flute payment platform.
 *
 * Public API surface. Anything not re-exported here is considered internal
 * and may change without a semver bump. Treat this file as the contract.
 *
 * @packageDocumentation
 */

export { Flute, Environment } from './client.js';
export type { FluteConfig, FluteEnvironment } from './client.js';
export type { EnvironmentEndpoints } from './environment.js';

export {
  FluteError,
  FluteApiError,
  FluteAuthenticationError,
  FluteValidationError,
  FluteNetworkError,
  FluteRateLimitError,
  FluteIdempotencyError,
  FluteConfigurationError,
  FluteWebhookError,
} from './errors.js';
export type { FluteErrorOptions, FluteApiErrorPayload } from './errors.js';

export type { TokenStorage, StoredToken } from './auth/storage.js';
export { MemoryTokenStorage } from './auth/storage.js';
export { Sessions } from './auth/sessions.js';

export type {
  Transaction,
  TransactionStatus,
  TransactionType,
  ListTransactionsParams,
  ListTransactionsResponse,
  AuthorizeTransactionParams,
  SaleTransactionParams,
  CaptureTransactionParams,
  RefundTransactionParams,
  CalculateAmountParams,
  CalculateAmountResponse,
} from './resources/transactions.js';

export type {
  PaymentSession,
  PaymentSessionStatus,
  CreatePaymentSessionParams,
} from './resources/paymentSessions.js';

export type { PaymentSettings } from './resources/settings.js';

export { verifyWebhookSignature } from './webhooks/verifySignature.js';
export { WebhooksNamespace } from './webhooks/namespace.js';
export type {
  VerifyWebhookSignatureInput,
  VerifyWebhookSignatureOptions,
} from './webhooks/verifySignature.js';

export { getVersion } from './version.js';
