import type { ResourceConfig } from './_resourceConfig.js';
import type { paths, components } from '../types/generated/isv-api-v2.js';

// ───────────── public types (re-exported from the OpenAPI surface) ─────────────

/**
 * Aggregated transaction status as exposed in list/retrieve responses.
 *
 * @public
 */
export type TransactionStatus = NonNullable<components['schemas']['AggregatedTransactionStatus']>;

/**
 * Per-event transaction type (sale, capture, void, refund, ...).
 * Returned inside `Transaction.transactionEvents[].type`.
 *
 * @public
 */
export type TransactionType = NonNullable<components['schemas']['TransactionDetailEventType']>;

/**
 * A single transaction record as returned by `list` / `retrieve`.
 *
 * @public
 */
export type Transaction = NonNullable<components['schemas']['GetTransactionResponseDto']>;

/**
 * Result envelope returned by `sale` / `authorize` / `capture` / `void` /
 * `refund`. Contains the new authoritative transaction status, the
 * processor response, and the receipt body when applicable.
 *
 * @public
 */
export type TransactionResult = NonNullable<components['schemas']['TransactionResponseDto']>;

/**
 * Query parameters accepted by {@link TransactionsResource.list}.
 *
 * @public
 */
export interface ListTransactionsParams {
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Response shape for {@link TransactionsResource.list}.
 *
 * @public
 */
export interface ListTransactionsResponse {
  readonly items: readonly Transaction[];
  readonly total: number;
}

/**
 * Body fields shared by `sale` and `authorize`. Mirrors
 * `CreateTransactionRequestDto` in the API. Card vs ACH is selected by
 * which of `transactionDetails.cardData` or `transactionDetails.achData`
 * the caller populates.
 *
 * @public
 */
export type CreateTransactionParams = Omit<
  NonNullable<components['schemas']['CreateTransactionRequestDto']>,
  // The SDK injects these — callers don't get to choose. (`captureMethod`
  // is set by `sale` vs `authorize`; the other three are mobile-app-only
  // attribution fields irrelevant to a server-side SDK.)
  never
>;

/**
 * Alias used by {@link TransactionsResource.authorize}. The SDK forces
 * `captureMethod = "Manual"` on top of whatever the caller passes.
 *
 * @public
 */
export type AuthorizeTransactionParams = CreateTransactionParams;

/**
 * Alias used by {@link TransactionsResource.sale}. The SDK forces
 * `captureMethod = "Auto"` on top of whatever the caller passes.
 *
 * @public
 */
export type SaleTransactionParams = CreateTransactionParams;

/**
 * Body for {@link TransactionsResource.capture}. Omit `amount` for a
 * full capture; pass an amount strictly less than the authorized total
 * for a partial capture.
 *
 * @public
 */
export type CaptureTransactionParams = NonNullable<components['schemas']['CaptureRequestDto']>;

/**
 * Body for {@link TransactionsResource.refund}. Omit `amount` for a
 * full refund; pass an amount for a partial card refund.
 *
 * @public
 */
export type RefundTransactionParams = NonNullable<components['schemas']['ReversalRequestDto']>;

/**
 * Query parameters for {@link TransactionsResource.calculateAmount}.
 * Server-side endpoint is GET, so all fields go on the query string.
 *
 * @public
 */
export type CalculateAmountParams = NonNullable<
  paths['/v2/transactions/calculate-amount']['get']['parameters']['query']
>;

/**
 * Response shape for {@link TransactionsResource.calculateAmount}.
 *
 * @public
 */
export type CalculateAmountResponse = NonNullable<
  components['schemas']['CalculateAmountResponseDto']
>;

/**
 * Per-request overrides accepted by every method of the Transactions resource.
 *
 * @public
 */
export interface TransactionsRequestOptions {
  /** Override the default per-request timeout. */
  readonly timeoutMs?: number;
  /** Override the default retry count. */
  readonly maxRetries?: number;
  /**
   * Override the per-call idempotency key. The SDK generates one
   * automatically for every state-changing request; pass an explicit
   * value to make the call retry-safe across SDK invocations
   * (e.g. consume the same key on a webhook-driven retry job).
   */
  readonly idempotencyKey?: string;
  /** Cancel from outside the SDK. */
  readonly signal?: AbortSignal;
}

// ───────────── implementation ─────────────

/**
 * Transactions API: card and ACH lifecycle.
 *
 * - {@link list}, {@link retrieve} — read.
 * - {@link sale}, {@link authorize}, {@link capture}, {@link void},
 *   {@link refund} — state changes; idempotent on `Idempotency-Key`.
 * - {@link calculateAmount} — pricing helper that respects the merchant's
 *   ZCP / dual-pricing / surcharge / discount configuration.
 *
 * @public
 */
export class TransactionsResource {
  readonly #config: ResourceConfig;

  /** @internal */
  public constructor(config: ResourceConfig) {
    this.#config = config;
  }

  /** Paginated list of transactions for the merchant. */
  public async list(
    params: ListTransactionsParams = {},
    options: TransactionsRequestOptions = {},
  ): Promise<ListTransactionsResponse> {
    const response = await this.#config.http.request<ListTransactionsResponse>({
      method: 'GET',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions`,
      query: {
        ...(params.page !== undefined ? { page: params.page } : {}),
        ...(params.pageSize !== undefined ? { pageSize: params.pageSize } : {}),
      },
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /** Retrieve a single transaction by id. */
  public async retrieve(
    transactionId: string,
    options: TransactionsRequestOptions = {},
  ): Promise<Transaction> {
    requireId(transactionId, 'transactionId');
    const response = await this.#config.http.request<Transaction>({
      method: 'GET',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions/${encodeURIComponent(transactionId)}`,
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /**
   * Authorize a card transaction (manual capture). The funds are placed
   * on hold; complete the charge later with {@link capture}.
   */
  public async authorize(
    params: AuthorizeTransactionParams,
    options: TransactionsRequestOptions = {},
  ): Promise<TransactionResult> {
    return this.#submit(params, 'Manual', options);
  }

  /**
   * Sale (auto-capture). One-shot charge that goes to settlement.
   */
  public async sale(
    params: SaleTransactionParams,
    options: TransactionsRequestOptions = {},
  ): Promise<TransactionResult> {
    return this.#submit(params, 'Auto', options);
  }

  /**
   * Capture an authorization, optionally partial. Pass `amount` to
   * capture a subset of the originally authorized total.
   */
  public async capture(
    transactionId: string,
    params: CaptureTransactionParams = {},
    options: TransactionsRequestOptions = {},
  ): Promise<TransactionResult> {
    requireId(transactionId, 'transactionId');
    const response = await this.#config.http.request<TransactionResult>({
      method: 'POST',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions/${encodeURIComponent(transactionId)}/capture`,
      body: params,
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /**
   * Void / reverse a transaction that has not yet settled. The API
   * auto-detects card vs ACH and chooses the right reversal flow.
   */
  public async void(
    transactionId: string,
    options: TransactionsRequestOptions = {},
  ): Promise<TransactionResult> {
    requireId(transactionId, 'transactionId');
    const response = await this.#config.http.request<TransactionResult>({
      method: 'POST',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions/${encodeURIComponent(transactionId)}/reversal`,
      body: {},
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /**
   * Refund a settled transaction, optionally partial (card only).
   * For unsettled transactions, prefer {@link void}.
   */
  public async refund(
    transactionId: string,
    params: RefundTransactionParams = {},
    options: TransactionsRequestOptions = {},
  ): Promise<TransactionResult> {
    requireId(transactionId, 'transactionId');
    const response = await this.#config.http.request<TransactionResult>({
      method: 'POST',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions/${encodeURIComponent(transactionId)}/reversal`,
      body: params,
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  /**
   * Compute the final amount to charge given a base amount and the
   * merchant's pricing config (Zero-Cost Processing, dual pricing,
   * surcharge / discount, tip). Returns one breakdown per supported
   * payment method (card credit / debit, ACH, cash).
   */
  public async calculateAmount(
    params: CalculateAmountParams,
    options: TransactionsRequestOptions = {},
  ): Promise<CalculateAmountResponse> {
    const response = await this.#config.http.request<CalculateAmountResponse>({
      method: 'GET',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions/calculate-amount`,
      query: params,
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  // ───────────── internals ─────────────

  async #submit(
    params: CreateTransactionParams,
    captureMethod: 'Auto' | 'Manual',
    options: TransactionsRequestOptions,
  ): Promise<TransactionResult> {
    const body = this.#withCaptureMethod(params, captureMethod);
    const response = await this.#config.http.request<TransactionResult>({
      method: 'POST',
      url: `${this.#config.baseUrls.isvApi}/v2/transactions`,
      body,
      ...this.#requestOverrides(options),
    });
    return response.data;
  }

  #withCaptureMethod(
    params: CreateTransactionParams,
    captureMethod: 'Auto' | 'Manual',
  ): CreateTransactionParams {
    const transactionDetails = params.transactionDetails ?? {};
    const cardData = transactionDetails.cardData;
    if (cardData === undefined) {
      // ACH path — captureMethod is irrelevant. Forward params verbatim.
      return params;
    }
    return {
      ...params,
      transactionDetails: {
        ...transactionDetails,
        cardData: { ...cardData, captureMethod },
      },
    };
  }

  #requestOverrides(options: TransactionsRequestOptions): {
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
