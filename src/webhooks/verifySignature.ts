import { createHmac, timingSafeEqual } from 'node:crypto';
import { FluteWebhookError } from '../errors.js';

/**
 * Inputs for {@link verifyWebhookSignature}.
 *
 * Header names follow the Flute Notifications Service conventions:
 *
 * - `Flute-Webhook-ID` — unique delivery identifier.
 * - `Flute-Webhook-Timestamp` — UNIX timestamp in **seconds**.
 * - `Flute-Webhook-Signature` — `v1,<base64(hmac-sha256)>`.
 *
 * The signed payload is `${idHeader}.${timestampHeader}.${rawRequestBody}`.
 *
 * @public
 */
export interface VerifyWebhookSignatureInput {
  /** Value of the `Flute-Webhook-Signature` header (e.g. `v1,SGVsbG8=`). */
  readonly signatureHeader: string;
  /** Value of the `Flute-Webhook-ID` header. */
  readonly idHeader: string;
  /** Value of the `Flute-Webhook-Timestamp` header (UNIX seconds, as a string). */
  readonly timestampHeader: string;
  /**
   * Raw request body **bytes or original string** — NOT the parsed JSON.
   * Re-serialising the JSON breaks the HMAC because key order and
   * whitespace differ.
   */
  readonly rawRequestBody: string | Uint8Array;
  /**
   * Shared HMAC secret returned when the webhook endpoint was created
   * (it is shown to the merchant exactly once at that moment).
   */
  readonly signatureSecret: string;
}

/**
 * Tunables for {@link verifyWebhookSignature}.
 *
 * @public
 */
export interface VerifyWebhookSignatureOptions {
  /**
   * Maximum drift (in seconds) between the timestamp header and the local
   * clock. Defaults to 300 (5 minutes). Set to `Infinity` to disable
   * replay protection — strongly discouraged in production.
   */
  readonly toleranceSeconds?: number;
  /**
   * Override the current time used for replay validation. Useful in tests.
   * @internal
   */
  readonly nowEpochSeconds?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const SUPPORTED_SCHEME = 'v1';

/**
 * Verify the HMAC signature of an incoming webhook request.
 *
 * Two call shapes are supported:
 *
 * 1. **Object form (preferred, idiomatic TypeScript):**
 *    ```ts
 *    verifyWebhookSignature({
 *      signatureHeader, idHeader, timestampHeader,
 *      rawRequestBody, signatureSecret,
 *    });
 *    ```
 * 2. **Positional form (useful when porting from other Flute SDKs):**
 *    ```ts
 *    verifyWebhookSignature(
 *      signatureHeader, idHeader, timestampHeader,
 *      rawRequestBody, signatureSecret,
 *    );
 *    ```
 *
 * Returns `true` when:
 *
 * 1. The `Flute-Webhook-Signature` header parses as `v1,<base64>`.
 * 2. `HMAC-SHA256(secret, "${id}.${timestamp}.${body}")` matches the
 *    decoded signature byte-for-byte (timing-safe compare).
 * 3. The timestamp is within `toleranceSeconds` of the current clock.
 *
 * Returns `false` for any cryptographic mismatch, expired timestamp,
 * malformed scheme, or non-base64 signature payload.
 *
 * Throws {@link FluteWebhookError} when verification cannot be attempted
 * at all — i.e. a required parameter is missing, not a string, or empty.
 * This distinction lets the caller respond with `400` (client mistake)
 * vs `401` (signature failure).
 *
 * @public
 */
export function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
  options?: VerifyWebhookSignatureOptions,
): boolean;
export function verifyWebhookSignature(
  signatureHeader: string,
  idHeader: string,
  timestampHeader: string,
  rawRequestBody: string | Uint8Array,
  signatureSecret: string,
  options?: VerifyWebhookSignatureOptions,
): boolean;
export function verifyWebhookSignature(
  inputOrSignature: VerifyWebhookSignatureInput | string,
  optionsOrIdHeader?: VerifyWebhookSignatureOptions | string,
  timestampHeader?: string,
  rawRequestBody?: string | Uint8Array,
  signatureSecret?: string,
  positionalOptions?: VerifyWebhookSignatureOptions,
): boolean {
  const { input, options } = normaliseArgs(
    inputOrSignature,
    optionsOrIdHeader,
    timestampHeader,
    rawRequestBody,
    signatureSecret,
    positionalOptions,
  );

  assertNonEmptyString(input.signatureHeader, 'signatureHeader');
  assertNonEmptyString(input.idHeader, 'idHeader');
  assertNonEmptyString(input.timestampHeader, 'timestampHeader');
  assertNonEmptyString(input.signatureSecret, 'signatureSecret');
  assertRawBody(input.rawRequestBody);

  const expectedSignature = parseSignatureHeader(input.signatureHeader);
  if (expectedSignature === undefined) return false;

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (!isTimestampFresh(input.timestampHeader, tolerance, options.nowEpochSeconds)) {
    return false;
  }

  const bodyBuffer =
    typeof input.rawRequestBody === 'string'
      ? Buffer.from(input.rawRequestBody, 'utf8')
      : Buffer.from(input.rawRequestBody);

  const signedContent = Buffer.concat([
    Buffer.from(`${input.idHeader}.${input.timestampHeader}.`, 'utf8'),
    bodyBuffer,
  ]);

  const computed = createHmac('sha256', input.signatureSecret).update(signedContent).digest();

  return safeCompare(computed, expectedSignature);
}

function normaliseArgs(
  inputOrSignature: VerifyWebhookSignatureInput | string,
  optionsOrIdHeader: VerifyWebhookSignatureOptions | string | undefined,
  timestampHeader: string | undefined,
  rawRequestBody: string | Uint8Array | undefined,
  signatureSecret: string | undefined,
  positionalOptions: VerifyWebhookSignatureOptions | undefined,
): { input: VerifyWebhookSignatureInput; options: VerifyWebhookSignatureOptions } {
  if (typeof inputOrSignature === 'string') {
    if (typeof optionsOrIdHeader !== 'string') {
      throw new FluteWebhookError(
        'verifyWebhookSignature(positional): `idHeader` is required and must be a string.',
      );
    }
    if (typeof timestampHeader !== 'string') {
      throw new FluteWebhookError(
        'verifyWebhookSignature(positional): `timestampHeader` is required and must be a string.',
      );
    }
    if (rawRequestBody === undefined) {
      throw new FluteWebhookError(
        'verifyWebhookSignature(positional): `rawRequestBody` is required.',
      );
    }
    if (typeof signatureSecret !== 'string') {
      throw new FluteWebhookError(
        'verifyWebhookSignature(positional): `signatureSecret` is required and must be a string.',
      );
    }
    return {
      input: {
        signatureHeader: inputOrSignature,
        idHeader: optionsOrIdHeader,
        timestampHeader,
        rawRequestBody,
        signatureSecret,
      },
      options: positionalOptions ?? {},
    };
  }
  // The string overload is handled above; what we have left is *meant*
  // to be the object form. TypeScript narrows `inputOrSignature` to the
  // object branch but a JS caller can still pass `null` / `undefined`,
  // so we keep the runtime guard. Cast to `unknown` first so the lint
  // rule doesn't flag it as a redundant check.
  const candidate: unknown = inputOrSignature;
  if (candidate === null || typeof candidate !== 'object') {
    throw new FluteWebhookError(
      'verifyWebhookSignature: first argument must be the input object or the signatureHeader string.',
    );
  }
  const opts: unknown = optionsOrIdHeader;
  return {
    input: candidate as VerifyWebhookSignatureInput,
    options: typeof opts === 'object' && opts !== null ? opts : {},
  };
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FluteWebhookError(
      `verifyWebhookSignature: \`${field}\` is required and must be a non-empty string.`,
    );
  }
}

function assertRawBody(value: unknown): asserts value is string | Uint8Array {
  if (typeof value === 'string') return;
  if (value instanceof Uint8Array) return;
  throw new FluteWebhookError(
    'verifyWebhookSignature: `rawRequestBody` is required and must be a string or Uint8Array (the raw bytes — never the parsed JSON).',
  );
}

function parseSignatureHeader(header: string): Buffer | undefined {
  const commaIndex = header.indexOf(',');
  if (commaIndex <= 0) return undefined;
  const scheme = header.slice(0, commaIndex);
  if (scheme !== SUPPORTED_SCHEME) return undefined;
  const encoded = header.slice(commaIndex + 1);
  if (encoded.length === 0) return undefined;
  try {
    const decoded = Buffer.from(encoded, 'base64');
    // Buffer.from with base64 silently ignores invalid characters; verify
    // the encoded text is a valid base64 round-trip so we don't accept
    // garbage like `v1,not-base64`.
    if (decoded.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function isTimestampFresh(
  timestampHeader: string,
  toleranceSeconds: number,
  nowOverride: number | undefined,
): boolean {
  if (toleranceSeconds === Number.POSITIVE_INFINITY) return true;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const now = nowOverride ?? Math.floor(Date.now() / 1000);
  return Math.abs(now - ts) <= toleranceSeconds;
}

function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
