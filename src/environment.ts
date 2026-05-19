import { FluteConfigurationError } from './errors.js';
import type { FluteEnvironment } from './client.js';

/**
 * Resolved set of base URLs the SDK talks to.
 *
 * The public surface targets three prefixes:
 *
 * - `isvApi` — the v2 REST API segment (transactions, settings) hosted
 *   under `${apiHost}` (e.g. `api.uat.arise.risewithaurora.com`).
 * - `payIntApi` — the Payment Integrations API (payment sessions),
 *   which still lives under v1 paths at the time this SDK ships.
 * - `oauth` — the Identity Service base URL. The token endpoint is
 *   `${oauth}/oauth2/token`.
 *
 * @internal
 */
export interface EnvironmentEndpoints {
  /** Base URL for the v2 REST API (transactions, settings). */
  readonly isvApi: string;
  /** Base URL for the Payment Integrations API (v1) — payment sessions live here. */
  readonly payIntApi: string;
  /** Base URL for the Identity Service. The token endpoint is `${oauth}/oauth2/token`. */
  readonly oauth: string;
}

// The v2 REST API endpoints are served under the API host root with
// the `/v2/...` paths declared in `openapi/isv-api-v2.json` (e.g.
// `/v2/transactions`, `/v2/settings/payment-config`). The Payment
// Integrations API is mounted under `/pay-int-api/`, and the OAuth
// host is a dedicated `oauth.*` subdomain (the token endpoint is
// `/oauth2/token`).
const SANDBOX_DEFAULTS: EnvironmentEndpoints = {
  isvApi: 'https://api.uat.arise.risewithaurora.com',
  payIntApi: 'https://api.uat.arise.risewithaurora.com/pay-int-api',
  oauth: 'https://oauth.uat.arise.risewithaurora.com',
};

const PRODUCTION_DEFAULTS: EnvironmentEndpoints = {
  isvApi: 'https://api.arise.risewithaurora.com',
  payIntApi: 'https://api.arise.risewithaurora.com/pay-int-api',
  oauth: 'https://oauth.arise.risewithaurora.com',
};

/**
 * Path appended to the OAuth base URL to reach the token endpoint.
 * Locked by the Identity Service config (`SetTokenEndpointUris("/oauth2/token")`).
 *
 * @internal
 */
export const TOKEN_ENDPOINT_PATH = '/oauth2/token' as const;

/**
 * Merge per-environment defaults with user overrides, validate the
 * resulting URLs, and strip trailing slashes so callers can append
 * `/v2/transactions` cleanly.
 *
 * Every base URL MUST be HTTPS — except `localhost` / `127.0.0.1`,
 * which we permit so contract tests, mock servers, and local proxies
 * can use plain HTTP without ceremony.
 *
 * @internal
 */
export function resolveEnvironment(
  environment: FluteEnvironment,
  overrides: Partial<EnvironmentEndpoints> | undefined,
): EnvironmentEndpoints {
  const defaults = environment === 'production' ? PRODUCTION_DEFAULTS : SANDBOX_DEFAULTS;
  const resolved = {
    isvApi: stripTrailingSlash(overrides?.isvApi ?? defaults.isvApi),
    payIntApi: stripTrailingSlash(overrides?.payIntApi ?? defaults.payIntApi),
    oauth: stripTrailingSlash(overrides?.oauth ?? defaults.oauth),
  };
  enforceHttps('isvApi', resolved.isvApi);
  enforceHttps('payIntApi', resolved.payIntApi);
  enforceHttps('oauth', resolved.oauth);
  return resolved;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function enforceHttps(field: keyof EnvironmentEndpoints, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FluteConfigurationError(
      `\`baseUrls.${field}\` is not a valid URL: ${JSON.stringify(value)}.`,
    );
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return;
  throw new FluteConfigurationError(
    `\`baseUrls.${field}\` must use HTTPS (got ${parsed.protocol}//${parsed.hostname}). HTTP is only allowed on localhost / 127.0.0.1 for tests.`,
  );
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
