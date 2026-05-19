import type { TokenManager } from './tokenManager.js';
import type { StoredToken } from './storage.js';

/**
 * Public auth surface attached to `flute.sessions.*`.
 *
 * The wording mirrors the iOS reference SDK so cross-platform
 * documentation stays predictable for integrators:
 *
 * - `init()` — implicit during `new Flute(...)`. Exposed as a no-op
 *   here so consumers can chain `await flute.sessions.init()` in
 *   bootstrap scripts when they want a single explicit entry-point.
 * - `authenticate()` — eagerly fetches a token. Use this in startup
 *   code so misconfigured credentials surface immediately.
 * - `getAccessToken()` — returns a valid token; the SDK normally calls
 *   this transparently. Exposed for power users who need to forward
 *   the token (e.g. pre-warming a downstream service).
 * - `refreshAccessToken()` — forces a refresh, even if the cached
 *   token is still valid.
 * - `clearStoredToken()` — wipes the cached token from
 *   {@link TokenStorage}. Useful on logout / secret rotation.
 *
 * @public
 */
export class Sessions {
  readonly #tokenManager: TokenManager;

  /** @internal */
  public constructor(tokenManager: TokenManager) {
    this.#tokenManager = tokenManager;
  }

  /**
   * Resolved when the SDK is ready to authenticate. Currently a no-op
   * because `new Flute(...)` is fully synchronous, but reserved so
   * future additions (e.g. dynamic config loading) don't break callers.
   */
  public init(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Eagerly exchange the configured client credentials for an access
   * token. Throws {@link FluteAuthenticationError} on bad credentials,
   * {@link FluteNetworkError} on transport issues.
   */
  public async authenticate(): Promise<StoredToken> {
    return this.#tokenManager.authenticate();
  }

  /** Returns a valid access token, refreshing transparently if needed. */
  public getAccessToken(): Promise<string> {
    return this.#tokenManager.getAccessToken();
  }

  /** Force a refresh, ignoring the cached lifetime. */
  public refreshAccessToken(): Promise<string> {
    return this.#tokenManager.invalidate();
  }

  /** Wipe the cached token from {@link TokenStorage}. */
  public clearStoredToken(): Promise<void> {
    return this.#tokenManager.clear();
  }
}
