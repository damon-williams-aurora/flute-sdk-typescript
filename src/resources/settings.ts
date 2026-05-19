import type { ResourceConfig } from './_resourceConfig.js';
import type { paths } from '../types/generated/isv-api-v2.js';

/**
 * Merchant payment configuration as exposed by the v2 REST API
 * (`GET /v2/settings/payment-config`).
 *
 * Field semantics are documented inline by the OpenAPI spec; we re-export
 * the wire shape verbatim so that consumers always see the freshest
 * documentation as the spec evolves. We only rename `unknown`-typed
 * shapes when absolutely needed.
 *
 * @public
 */
export type PaymentSettings = NonNullable<
  paths['/v2/settings/payment-config']['get']['responses'][200]['content']['application/json']
>;

/**
 * Per-request overrides accepted by every method of the Settings resource.
 *
 * @public
 */
export interface SettingsRequestOptions {
  /** Override the default per-request timeout. */
  readonly timeoutMs?: number;
  /** Override the default retry count. */
  readonly maxRetries?: number;
  /** Cancel from outside the SDK. */
  readonly signal?: AbortSignal;
}

/**
 * Read-only access to merchant-level payment configuration.
 *
 * @public
 */
export class SettingsResource {
  readonly #config: ResourceConfig;

  /** @internal */
  public constructor(config: ResourceConfig) {
    this.#config = config;
  }

  /**
   * Retrieve the merchant payment configuration.
   *
   * Required permission on the credential: `General Configurations`.
   *
   * @example
   * ```ts
   * const settings = await flute.settings.getPaymentSettings();
   * console.log(settings.availableCurrencies, settings.maxTransactionAmount);
   * ```
   */
  public async getPaymentSettings(options: SettingsRequestOptions = {}): Promise<PaymentSettings> {
    const response = await this.#config.http.request<PaymentSettings>({
      method: 'GET',
      url: `${this.#config.baseUrls.isvApi}/v2/settings/payment-config`,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    return response.data;
  }
}
