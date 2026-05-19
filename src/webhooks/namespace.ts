import { verifyWebhookSignature } from './verifySignature.js';
import type {
  VerifyWebhookSignatureInput,
  VerifyWebhookSignatureOptions,
} from './verifySignature.js';

/**
 * `flute.webhooks.*` — stateless webhook utilities.
 *
 * @public
 */
export class WebhooksNamespace {
  /**
   * Verify the HMAC-SHA256 signature of an incoming webhook request.
   *
   * Two call shapes are supported.
   *
   * @example Object form (preferred)
   * ```ts
   * const ok = flute.webhooks.verifySignature({
   *   signatureHeader: req.headers['flute-webhook-signature'] as string,
   *   idHeader: req.headers['flute-webhook-id'] as string,
   *   timestampHeader: req.headers['flute-webhook-timestamp'] as string,
   *   rawRequestBody: rawBuffer, // raw bytes, NOT the parsed JSON
   *   signatureSecret: process.env.FLUTE_WEBHOOK_SECRET!,
   * });
   * ```
   *
   * @example Positional form
   * ```ts
   * const ok = flute.webhooks.verifySignature(
   *   sigHeader, idHeader, tsHeader, rawBody, secret,
   * );
   * ```
   *
   * Throws {@link FluteWebhookError} on missing/malformed parameters.
   * Returns `false` on cryptographic mismatch or expired timestamp.
   */
  public verifySignature(
    input: VerifyWebhookSignatureInput,
    options?: VerifyWebhookSignatureOptions,
  ): boolean;
  public verifySignature(
    signatureHeader: string,
    idHeader: string,
    timestampHeader: string,
    rawRequestBody: string | Uint8Array,
    signatureSecret: string,
    options?: VerifyWebhookSignatureOptions,
  ): boolean;
  public verifySignature(...args: unknown[]): boolean {
    return (verifyWebhookSignature as (...rest: unknown[]) => boolean)(...args);
  }
}
