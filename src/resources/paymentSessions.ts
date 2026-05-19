import type { ResourceConfig } from './_resourceConfig.js';

// ───────────── public types (hand-rolled — pay-int-api v1) ─────────────

/**
 * Lifecycle status of a payment session.
 *
 * - `Created` — session was initialised, no payment yet.
 * - `Cancelled` — explicitly cancelled before completion.
 * - `Completed` — finished; inspect `transactionDetails` to see whether
 *   the underlying transaction was approved.
 * - `Failed` — payment attempt failed; create a new session to retry.
 *
 * @public
 */
export type PaymentSessionStatus = 'Created' | 'Cancelled' | 'Completed' | 'Failed';

/**
 * Numeric status id sent over the wire alongside {@link PaymentSessionStatus}.
 * Kept as a discrete type so consumers can switch on either form safely.
 *
 * @public
 */
export type PaymentSessionStatusId = 1 | 2 | 3 | 4;

/**
 * Intent of a payment session.
 *
 * - `Payment` — one-shot payment. Default when `mode` is omitted.
 * - `SaveMethod` — vault-only flow; `amount` MUST be `0`.
 * - `PaymentAndSave` — charge the customer and save the payment method.
 *
 * @public
 */
export type PaymentSessionMode = 'Payment' | 'SaveMethod' | 'PaymentAndSave';

/**
 * Numeric mode value as sent on the wire (used by the API for backwards
 * compatibility). The SDK accepts either form on input and always returns
 * the numeric value on output.
 *
 * @public
 */
export type PaymentSessionModeId = 1 | 2 | 3;

const MODE_TO_ID: Readonly<Record<PaymentSessionMode, PaymentSessionModeId>> = {
  Payment: 1,
  SaveMethod: 2,
  PaymentAndSave: 3,
};

/**
 * Body of `POST /pay-int-api/payment-sessions`.
 *
 * @public
 */
export interface CreatePaymentSessionParams {
  /**
   * Base amount (in USD) to charge. Must be greater than 0 for
   * `Payment` / `PaymentAndSave` modes; must be 0 for `SaveMethod`.
   */
  readonly amount: number;
  /**
   * Existing customer to attach the saved payment method to.
   * Omit to create a new customer record automatically.
   */
  readonly customerId?: string;
  /** Session intent. Defaults to `Payment` when omitted. */
  readonly mode?: PaymentSessionMode | PaymentSessionModeId;
  /** Bypass AVS in the payment gateway. Only used in payment-bearing modes. */
  readonly skipAddressVerification?: boolean;
  /**
   * Caller-provided reference identifier; participates in
   * duplicate-charge detection. Use a fresh value on legitimate
   * retries.
   */
  readonly referenceId?: string;
  /**
   * Optional tip amount (USD), in addition to `amount`. Server requires
   * a prior `auth` transaction to be present when this is set.
   */
  readonly tipAmount?: number;
}

/**
 * Response of `POST /pay-int-api/payment-sessions`.
 *
 * @public
 */
export interface CreatePaymentSessionResponse {
  readonly id: string;
}

/**
 * Detailed payment session record returned by `GET /pay-int-api/payment-sessions/{id}`.
 *
 * @public
 */
export interface PaymentSession {
  readonly statusId: PaymentSessionStatusId;
  readonly status: PaymentSessionStatus;
  readonly customerId?: string;
  readonly mode: PaymentSessionModeId;
  readonly skipAddressVerification?: boolean;
  readonly referenceId?: string | null;
  readonly vaultedPaymentMethodId?: string | null;
  /**
   * Aggregated transaction details, if any. Shape mirrors the wire
   * verbatim (`PaymentIntegrations.Contracts.PaymentSessions.Get.
   * GetPaymentSessionTransactionDetails`); we expose it as a structured
   * record without inventing semantics.
   */
  readonly transactionDetails?: PaymentSessionTransactionDetails | null;
}

/**
 * Transaction snapshot embedded in {@link PaymentSession}.
 * Pass-through of the wire shape — fields are forwarded as the API
 * returns them.
 *
 * @public
 */
export interface PaymentSessionTransactionDetails {
  readonly transactionId?: string;
  readonly transactionStatus?: string;
  readonly amount?: number;
  readonly currencyCode?: string;
  readonly history?: readonly Record<string, unknown>[];
  readonly [extraField: string]: unknown;
}

/**
 * Per-request overrides accepted by every method of the Payment Sessions resource.
 *
 * @public
 */
export interface PaymentSessionsRequestOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

// ───────────── implementation ─────────────

const X_API_VERSION = '1';

/**
 * Payment Sessions API — pay-int-api v1.
 *
 * Use payment sessions to:
 *
 * - protect against duplicate charges,
 * - manage tips/surcharges/discounts/auth flows on the same checkout,
 * - delegate fraud protection to Aurora.
 *
 * @public
 */
export class PaymentSessionsResource {
  readonly #config: ResourceConfig;

  /** @internal */
  public constructor(config: ResourceConfig) {
    this.#config = config;
  }

  /** Create a new payment session. */
  public async create(
    params: CreatePaymentSessionParams,
    options: PaymentSessionsRequestOptions = {},
  ): Promise<CreatePaymentSessionResponse> {
    if (typeof params.amount !== 'number' || Number.isNaN(params.amount)) {
      throw new TypeError('`amount` is required and must be a finite number.');
    }
    const body: Record<string, unknown> = {
      amount: params.amount,
      ...(params.customerId !== undefined ? { customerId: params.customerId } : {}),
      ...(params.mode !== undefined ? { mode: this.#normaliseMode(params.mode) } : {}),
      ...(params.skipAddressVerification !== undefined
        ? { skipAddressVerification: params.skipAddressVerification }
        : {}),
      ...(params.referenceId !== undefined ? { referenceId: params.referenceId } : {}),
      ...(params.tipAmount !== undefined ? { tipAmount: params.tipAmount } : {}),
    };

    const response = await this.#config.http.request<CreatePaymentSessionResponse>({
      method: 'POST',
      url: `${this.#config.baseUrls.payIntApi}/payment-sessions`,
      body,
      headers: { 'x-api-version': X_API_VERSION },
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /** Retrieve a payment session by id. */
  public async retrieve(
    paymentSessionId: string,
    options: PaymentSessionsRequestOptions = {},
  ): Promise<PaymentSession> {
    requireId(paymentSessionId, 'paymentSessionId');
    const response = await this.#config.http.request<PaymentSession>({
      method: 'GET',
      url: `${this.#config.baseUrls.payIntApi}/payment-sessions/${encodeURIComponent(paymentSessionId)}`,
      headers: { 'x-api-version': X_API_VERSION },
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /** Cancel a payment session that has not yet completed. */
  public async cancel(
    paymentSessionId: string,
    options: PaymentSessionsRequestOptions = {},
  ): Promise<void> {
    requireId(paymentSessionId, 'paymentSessionId');
    await this.#config.http.request({
      method: 'POST',
      url: `${this.#config.baseUrls.payIntApi}/payment-sessions/${encodeURIComponent(paymentSessionId)}/cancel`,
      headers: { 'x-api-version': X_API_VERSION },
      ...this.#requestOverrides(options),
    });
  }

  // ───────────── internals ─────────────

  #normaliseMode(mode: PaymentSessionMode | PaymentSessionModeId): PaymentSessionModeId {
    if (typeof mode === 'number') return mode;
    return MODE_TO_ID[mode];
  }

  #requestOverrides(options: PaymentSessionsRequestOptions): {
    timeoutMs?: number;
    maxRetries?: number;
    idempotencyKey?: string;
    signal?: AbortSignal;
  } {
    return {
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    };
  }
}

function requireId(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`\`${name}\` is required and must be a non-empty string.`);
  }
}
