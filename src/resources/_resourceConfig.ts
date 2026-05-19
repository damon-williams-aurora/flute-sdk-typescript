import type { EnvironmentEndpoints } from '../environment.js';
import type { HttpClient } from '../internal/http.js';

/**
 * Subset of the resolved client config that resources need.
 *
 * The HTTP client carries timeouts, retries, the user-agent suffix, the
 * logger, and (once wired) the auth provider — so resources don't have
 * to know any of that. Resources stay narrow: they describe endpoints
 * and types, the transport is somebody else's problem.
 *
 * @internal
 */
export interface ResourceConfig {
  readonly baseUrls: EnvironmentEndpoints;
  readonly http: HttpClient;
}
