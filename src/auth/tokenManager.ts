import { FluteAuthenticationError, FluteConfigurationError } from '../errors.js';
import type { AuthProvider, HttpClient } from '../internal/http.js';
import { TOKEN_ENDPOINT_PATH } from '../environment.js';
import type { TokenStorage, StoredToken } from './storage.js';

/**
 * Shape of the JSON response returned by `POST /oauth2/token` on the
 * Identity Service. Confirmed by reading
 * `Arise.IdentityService/.../GetAccessTokenTests.cs` and
 * `OpenIdApplicationEntity` in the backend repo.
 *
 * @internal
 */
export interface TokenEndpointResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope?: string;
}

/**
 * Construction parameters for {@link TokenManager}.
 *
 * @internal
 */
export interface TokenManagerOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly oauthBaseUrl: string;
  readonly storage: TokenStorage;
  readonly http: HttpClient;
  /**
   * Proactive refresh window, in milliseconds. When the cached token has
   * less than this much life left, the next request will refresh it
   * synchronously instead of risking a 401. Default 60s.
   */
  readonly proactiveRefreshSkewMs?: number;
  /** Override the storage key used to namespace tokens. Default: `clientId`. */
  readonly storageKey?: string;
}

const DEFAULT_PROACTIVE_SKEW_MS = 60_000;

/**
 * Owns OAuth lifecycle for the SDK.
 *
 * Responsibilities:
 *
 * - Cache the access token in the configured {@link TokenStorage}.
 * - Refresh proactively when the cached token is about to expire.
 * - Refresh reactively when a request comes back 401 (the HTTP client
 *   calls {@link TokenManager.invalidate}).
 * - Coalesce concurrent refreshes so that a hundred parallel requests
 *   trigger exactly one network round-trip — this is what makes the SDK
 *   safe to share between async tasks.
 *
 * The class implements {@link AuthProvider} so the HTTP client can stay
 * unaware of OAuth specifics.
 *
 * @internal
 */
export class TokenManager implements AuthProvider {
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #tokenEndpoint: string;
  readonly #storage: TokenStorage;
  readonly #http: HttpClient;
  readonly #skewMs: number;
  readonly #storageKey: string;

  /** In-flight refresh promise, used to coalesce concurrent calls. */
  #pending: Promise<StoredToken> | undefined;

  public constructor(options: TokenManagerOptions) {
    if (options.clientId.length === 0) {
      throw new FluteConfigurationError('TokenManager requires a non-empty clientId.');
    }
    if (options.clientSecret.length === 0) {
      throw new FluteConfigurationError('TokenManager requires a non-empty clientSecret.');
    }
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#tokenEndpoint = `${stripTrailingSlash(options.oauthBaseUrl)}${TOKEN_ENDPOINT_PATH}`;
    this.#storage = options.storage;
    this.#http = options.http;
    this.#skewMs = options.proactiveRefreshSkewMs ?? DEFAULT_PROACTIVE_SKEW_MS;
    this.#storageKey = options.storageKey ?? options.clientId;
  }

  /**
   * Return a valid access token, refreshing transparently if the
   * cached one is missing or about to expire.
   */
  public async getAccessToken(): Promise<string> {
    const stored = await this.#storage.get(this.#storageKey);
    if (stored !== undefined && !this.#expiresSoon(stored)) {
      return stored.accessToken;
    }
    const fresh = await this.#refresh(stored);
    return fresh.accessToken;
  }

  /**
   * Force a refresh after the server rejected the current token.
   * Coalesces with any concurrent refresh.
   */
  public async invalidate(): Promise<string> {
    const fresh = await this.#refresh(undefined);
    return fresh.accessToken;
  }

  /**
   * Drop the cached token. Useful for tests and for the
   * `flute.sessions.clearStoredToken()` public method.
   */
  public async clear(): Promise<void> {
    await this.#storage.delete(this.#storageKey);
  }

  /**
   * Eagerly fetch a fresh token. Used by `flute.sessions.authenticate()`
   * — the user wants to surface configuration errors at startup, not on
   * the first transaction.
   */
  public async authenticate(): Promise<StoredToken> {
    return this.#refresh(undefined);
  }

  // ───────────── internals ─────────────

  #expiresSoon(token: StoredToken): boolean {
    return token.expiresAt - Date.now() <= this.#skewMs;
  }

  async #refresh(previous: StoredToken | undefined): Promise<StoredToken> {
    if (this.#pending !== undefined) return this.#pending;

    this.#pending = (async (): Promise<StoredToken> => {
      try {
        const tokens = await this.#exchangeTokens(previous?.refreshToken);
        const stored: StoredToken = {
          accessToken: tokens.access_token,
          ...(tokens.refresh_token !== undefined ? { refreshToken: tokens.refresh_token } : {}),
          expiresAt: Date.now() + tokens.expires_in * 1000,
          tokenType: tokens.token_type,
          ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
        };
        await this.#storage.set(this.#storageKey, stored);
        return stored;
      } finally {
        this.#pending = undefined;
      }
    })();
    return this.#pending;
  }

  async #exchangeTokens(refreshToken: string | undefined): Promise<TokenEndpointResponse> {
    const body: Record<string, string> =
      refreshToken !== undefined
        ? {
            grant_type: 'refresh_token',
            client_id: this.#clientId,
            client_secret: this.#clientSecret,
            refresh_token: refreshToken,
          }
        : {
            grant_type: 'client_credentials',
            client_id: this.#clientId,
            client_secret: this.#clientSecret,
          };

    try {
      const response = await this.#http.request<TokenEndpointResponse>({
        method: 'POST',
        url: this.#tokenEndpoint,
        body,
        contentType: 'application/x-www-form-urlencoded',
        formUrlEncoded: true,
        idempotencyKey: null,
        skipAuth: true,
      });
      const data: Partial<TokenEndpointResponse> = response.data;
      if (
        typeof data.access_token !== 'string' ||
        typeof data.expires_in !== 'number' ||
        typeof data.token_type !== 'string'
      ) {
        const errorOptions = {
          httpStatus: response.status,
          ...(response.requestId !== undefined ? { requestId: response.requestId } : {}),
          ...(response.correlationId !== undefined
            ? { correlationId: response.correlationId }
            : {}),
        };
        throw new FluteAuthenticationError(
          'Identity Service returned an unrecognised token payload.',
          errorOptions,
        );
      }
      return data as TokenEndpointResponse;
    } catch (err) {
      if (refreshToken !== undefined && err instanceof FluteAuthenticationError) {
        // Refresh token rejected — fall back to client_credentials once.
        return this.#exchangeTokens(undefined);
      }
      throw err;
    }
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
