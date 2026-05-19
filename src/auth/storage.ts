/**
 * Token snapshot persisted by the {@link TokenStorage}.
 *
 * @public
 */
export interface StoredToken {
  /** Bearer JWT issued by the OAuth `/token` endpoint. */
  readonly accessToken: string;
  /**
   * Refresh token issued together with the access token. The Identity
   * Service grants one for every `client_credentials` exchange (because
   * `offline_access` is set by default). The SDK will use it to extend
   * a session without re-sending the client secret over the wire.
   */
  readonly refreshToken?: string;
  /** Absolute UNIX millisecond timestamp at which `accessToken` becomes invalid. */
  readonly expiresAt: number;
  /** Optional token type (always `Bearer` in practice). */
  readonly tokenType?: string;
  /** Optional space-separated scopes returned by the token endpoint. */
  readonly scope?: string;
}

/**
 * Pluggable persistence interface for OAuth tokens.
 *
 * The default {@link MemoryTokenStorage} is fine for single-process,
 * long-running workloads. For serverless or multi-instance deployments,
 * provide a Redis-, DB-, or KV-backed implementation so tokens survive
 * cold starts and are shared across replicas.
 *
 * Implementations MUST be safe to call concurrently.
 *
 * @public
 */
export interface TokenStorage {
  /** Returns the cached token, or `undefined` if none / expired. */
  get(key: string): Promise<StoredToken | undefined>;
  /** Persist a token under `key`. Replaces any prior value. */
  set(key: string, value: StoredToken): Promise<void>;
  /** Forget any token stored under `key`. */
  delete(key: string): Promise<void>;
}

/**
 * In-process, non-persistent storage. The default for {@link Flute}.
 *
 * The storage is intentionally a dumb container: it never evicts on its
 * own. Lifetime decisions (refresh proactively, fall back when the
 * refresh token is rejected, etc.) all live in `TokenManager`. That way
 * the storage interface stays uniform across `MemoryTokenStorage`,
 * Redis, KV, file-system, etc.
 *
 * @public
 */
export class MemoryTokenStorage implements TokenStorage {
  readonly #store = new Map<string, StoredToken>();

  public get(key: string): Promise<StoredToken | undefined> {
    return Promise.resolve(this.#store.get(key));
  }

  public set(key: string, value: StoredToken): Promise<void> {
    this.#store.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.#store.delete(key);
    return Promise.resolve();
  }
}
