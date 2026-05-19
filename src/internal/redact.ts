/**
 * Sensitive field redaction for safe logging.
 *
 * The SDK never logs raw secrets, but if a consumer wires a logger via
 * `FluteConfig.logger` we still pass through bodies, headers, and URLs.
 * Anything matching the patterns below is replaced with `[REDACTED]`
 * before it leaves the SDK.
 *
 * @internal
 */

/** Header names whose values are always redacted (lower-cased compare). */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-flute-secret',
]);

/** JSON keys whose values are always redacted (case-insensitive compare). */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    'access_token',
    'accessToken',
    'refresh_token',
    'refreshToken',
    'id_token',
    'idToken',
    'client_secret',
    'clientSecret',
    'password',
    'pin',
    'cvv',
    'cvc',
    'cvv2',
    'cardSecurityCode',
    'pan',
    'cardNumber',
    'card_number',
    'accountNumber',
    'routingNumber',
    'signature',
    'signatureSecret',
    'webhookSecret',
    'apiKey',
    'apiSecret',
    'authorization',
  ].map((s) => s.toLowerCase()),
);

const REDACTED = '[REDACTED]';

/** Redact a single header bag. */
export function redactHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Recursively redact sensitive keys in any JSON-shaped value. Strings,
 * numbers, booleans, and `null` are returned unchanged unless they
 * appear under a sensitive key in an object. Arrays are walked.
 *
 * Cycles are not expected (we receive plain JSON), but a depth guard is
 * applied as defence-in-depth.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, depth + 1);
    }
  }
  return out;
}

/** Redact a query string while keeping non-sensitive params readable. */
export function redactQuery(query: URLSearchParams | string): string {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const out = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    out.set(k, SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : v);
  }
  return out.toString();
}
