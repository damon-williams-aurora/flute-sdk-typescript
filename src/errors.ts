/**
 * Common options accepted by every {@link FluteError} subclass.
 *
 * `requestId` and `correlationId` come from the response headers when
 * available and are critical for support tickets — never strip them.
 *
 * @public
 */
export interface FluteErrorOptions {
  readonly cause?: unknown;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly httpStatus?: number;
}

/**
 * Shape of the JSON body the Flute API returns on errors. Mirrors the
 * contract documented in the OpenAPI spec.
 *
 * @public
 */
export interface FluteApiErrorPayload {
  readonly statusCode?: number;
  readonly title?: string;
  readonly details?: string;
  readonly cause?: string;
  readonly resolution?: string;
  readonly errorCode?: string;
  readonly exceptionType?: string;
  readonly entityId?: string | null;
  readonly source?: string;
  readonly correlationId?: string;
  readonly documentationUrl?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Base class for every error thrown by this SDK.
 *
 * Catch this if you want a single catch-all branch; otherwise discriminate
 * on the subclass (`instanceof FluteAuthenticationError`, etc.).
 *
 * @public
 */
export class FluteError extends Error {
  public readonly requestId?: string;
  public readonly correlationId?: string;
  public readonly httpStatus?: number;

  public constructor(message: string, options: FluteErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.correlationId !== undefined) this.correlationId = options.correlationId;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }
}

/**
 * Raised when the SDK is misconfigured (missing credentials, bad URL, etc.).
 * These are programmer errors — typically caught during boot.
 *
 * @public
 */
export class FluteConfigurationError extends FluteError {}

/**
 * Raised when the OAuth token exchange fails or a request comes back 401
 * after a refresh attempt. Likely cause: wrong env, rotated secret, or
 * disabled client.
 *
 * @public
 */
export class FluteAuthenticationError extends FluteError {}

/**
 * Raised when the API rejects a request body with 400. The original
 * field-level errors live in `payload.errors`.
 *
 * @public
 */
export class FluteValidationError extends FluteError {
  public readonly payload?: FluteApiErrorPayload;
  public constructor(
    message: string,
    payload: FluteApiErrorPayload | undefined,
    options: FluteErrorOptions = {},
  ) {
    super(message, options);
    if (payload !== undefined) this.payload = payload;
  }
}

/**
 * Raised on any non-2xx response that isn't covered by a more specific
 * subclass (auth, validation, rate limit, idempotency conflict).
 *
 * @public
 */
export class FluteApiError extends FluteError {
  public readonly payload?: FluteApiErrorPayload;
  public readonly errorCode?: string;
  public constructor(
    message: string,
    payload: FluteApiErrorPayload | undefined,
    options: FluteErrorOptions = {},
  ) {
    super(message, options);
    if (payload !== undefined) {
      this.payload = payload;
      if (payload.errorCode !== undefined) this.errorCode = payload.errorCode;
    }
  }
}

/**
 * Raised when the request never reached a successful response: socket
 * hang-up, DNS failure, timeout, abort, etc.
 *
 * @public
 */
export class FluteNetworkError extends FluteError {}

/**
 * Raised on 429 responses. `retryAfterMs` reflects the `Retry-After`
 * header when the server provides one.
 *
 * @public
 */
export class FluteRateLimitError extends FluteError {
  public readonly retryAfterMs?: number;
  public constructor(
    message: string,
    retryAfterMs: number | undefined,
    options: FluteErrorOptions = {},
  ) {
    super(message, options);
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Raised when an idempotency key has been reused for a request that
 * doesn't match the original payload (or the original is still in flight).
 *
 * @public
 */
export class FluteIdempotencyError extends FluteError {}

/**
 * Raised by the webhook helper when verification cannot even be attempted —
 * i.e. one of the required headers / parameters is missing, blank, or
 * structurally invalid.
 *
 * Note: a *valid-shape but cryptographically wrong* signature does NOT
 * raise this error; {@link verifyWebhookSignature} returns `false`
 * instead. Use this distinction to decide whether to log a 400 (caller
 * mistake) vs a 401 (signature mismatch / replay).
 *
 * @public
 */
export class FluteWebhookError extends FluteError {}
