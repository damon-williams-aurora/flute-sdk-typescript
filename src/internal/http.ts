import {
  FluteApiError,
  FluteAuthenticationError,
  FluteIdempotencyError,
  FluteNetworkError,
  FluteRateLimitError,
  FluteValidationError,
  type FluteApiErrorPayload,
} from '../errors.js';
import { buildUserAgent } from './userAgent.js';
import { generateIdempotencyKey, IDEMPOTENT_METHODS } from './idempotency.js';
import { redactHeaders, redactValue } from './redact.js';

/**
 * Methods supported by the SDK's HTTP layer.
 *
 * @internal
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Per-request options accepted by {@link HttpClient.request}.
 *
 * @internal
 */
export interface HttpRequestOptions {
  readonly method: HttpMethod;
  readonly url: string;
  /** Plain-object query params; serialised as `?k=v&...`. `undefined` and `null` are skipped. */
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  /** JSON-serialisable request body. */
  readonly body?: unknown;
  /** Override default headers (e.g. add an `Authorization` header). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Override the default `Idempotency-Key` for state-changing requests. Pass `null` to opt out. */
  readonly idempotencyKey?: string | null;
  /** Override the default per-request timeout. */
  readonly timeoutMs?: number;
  /** Override the default retry count. */
  readonly maxRetries?: number;
  /**
   * Skip the auth interceptor entirely. Used by the OAuth token
   * endpoint itself (we'd loop forever if we tried to attach a token to
   * the call that fetches a token).
   */
  readonly skipAuth?: boolean;
  /**
   * Override `Content-Type`. Defaults to `application/json` when `body` is set.
   * Used by the OAuth flow which sends `application/x-www-form-urlencoded`.
   */
  readonly contentType?: string;
  /**
   * Encode the body as form-urlencoded instead of JSON. Triggers when
   * `contentType` is `application/x-www-form-urlencoded`.
   */
  readonly formUrlEncoded?: boolean;
  /** External AbortSignal for callers that want their own cancellation. */
  readonly signal?: AbortSignal;
}

/**
 * Outcome of an HTTP request once it succeeded (2xx). Non-2xx are turned
 * into thrown errors below, never returned.
 *
 * @internal
 */
export interface HttpResponse<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly data: T;
  readonly requestId: string | undefined;
  readonly correlationId: string | undefined;
}

/**
 * Hook the HTTP client invokes before each attempt to fetch the bearer
 * token (or refresh it after a 401). The {@link TokenManager} provides
 * the implementation; the HTTP client stays unaware of OAuth.
 *
 * @internal
 */
export interface AuthProvider {
  /** Returns a valid access token, refreshing transparently if needed. */
  getAccessToken(): Promise<string>;
  /** Forces a refresh after the server rejected our token (HTTP 401). */
  invalidate(): Promise<string>;
}

/**
 * Construction parameters for {@link HttpClient}.
 *
 * @internal
 */
export interface HttpClientOptions {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly userAgentSuffix: string | undefined;
  readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> | undefined;
  /** When set, the HTTP client attaches a Bearer token to every non-`skipAuth` request. */
  readonly auth?: AuthProvider;
  /** Test-only override. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof globalThis.fetch;
  /**
   * Whether to retry HTTP 429 responses honouring `Retry-After`.
   * Off by default so callers own the backoff strategy — flip on at
   * your own risk.
   */
  readonly retryOn429: boolean;
}

/**
 * Reusable HTTP client used by every resource in the SDK.
 *
 * Responsibilities:
 *
 * - Serialise query strings and JSON / form-urlencoded request bodies.
 * - Inject `User-Agent`, `Accept`, `Idempotency-Key`, and `Authorization`.
 * - Apply per-request timeouts via `AbortController`.
 * - Retry on retriable failures (5xx, 429, network errors) with
 *   exponential backoff + full jitter.
 * - Translate non-2xx responses into typed `FluteError` subclasses
 *   that preserve the rich error envelope returned by the Arise/Flute API.
 * - Refresh the bearer token reactively on a single 401.
 *
 * @internal
 */
export class HttpClient {
  readonly #options: {
    timeoutMs: number;
    maxRetries: number;
    retryOn429: boolean;
    auth: AuthProvider | undefined;
    fetchImpl: typeof globalThis.fetch;
    logger: HttpClientOptions['logger'];
    userAgentSuffix: string | undefined;
  };

  public constructor(options: HttpClientOptions) {
    this.#options = {
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryOn429: options.retryOn429,
      auth: options.auth,
      logger: options.logger,
      userAgentSuffix: options.userAgentSuffix,
      fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    };
  }

  /** Attach an auth provider after construction (token manager wires itself in). */
  public setAuth(auth: AuthProvider | undefined): void {
    Object.assign(this.#options, { auth });
  }

  /**
   * Issue a request and return the parsed JSON body on success. Throws
   * a typed `FluteError` subclass on every other outcome.
   */
  public async request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const url = this.#buildUrl(options.url, options.query);
    const baseHeaders = this.#buildHeaders(options);
    const body = this.#encodeBody(options);

    const maxRetries = options.maxRetries ?? this.#options.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;

    let attempt = 0;
    let didReauth = false;

    for (;;) {
      const headers = await this.#withAuth(baseHeaders, options.skipAuth === true);
      try {
        const response = await this.#fetchOnce(
          url,
          options.method,
          headers,
          body,
          timeoutMs,
          options.signal,
        );

        if (response.status >= 200 && response.status < 300) {
          const parsed = await this.#parseSuccess<T>(response);
          const requestId = response.headers.get('x-request-id') ?? undefined;
          const correlationId =
            response.headers.get('x-arise-trace-correlationid') ??
            response.headers.get('x-correlation-id') ??
            undefined;
          return {
            status: response.status,
            headers: response.headers,
            data: parsed,
            requestId,
            correlationId,
          };
        }

        // 401 — try a single proactive refresh, then retry once.
        if (
          response.status === 401 &&
          this.#options.auth !== undefined &&
          options.skipAuth !== true &&
          !didReauth
        ) {
          didReauth = true;
          await this.#options.auth.invalidate();
          continue;
        }

        if (this.#shouldRetry(response.status) && attempt < maxRetries) {
          attempt += 1;
          await sleep(this.#backoff(attempt, response.headers.get('retry-after')));
          continue;
        }

        const payload = await this.#parseErrorPayload(response);
        throw mapApiError(response.status, payload, response.headers);
      } catch (err) {
        if (
          err instanceof FluteApiError ||
          err instanceof FluteAuthenticationError ||
          err instanceof FluteValidationError ||
          err instanceof FluteRateLimitError ||
          err instanceof FluteIdempotencyError
        ) {
          throw err;
        }
        if (this.#isAbort(err)) {
          throw new FluteNetworkError('Request aborted (timeout or external signal).', {
            cause: err,
          });
        }
        if (this.#isNetwork(err) && attempt < maxRetries) {
          attempt += 1;
          await sleep(this.#backoff(attempt, null));
          continue;
        }
        throw new FluteNetworkError(
          err instanceof Error ? err.message : 'Network request failed.',
          { cause: err },
        );
      }
    }
  }

  // ───────────── internals ─────────────

  #buildUrl(url: string, query: HttpRequestOptions['query']): string {
    if (query === undefined) return url;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs.length === 0) return url;
    return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
  }

  #buildHeaders(options: HttpRequestOptions): Record<string, string> {
    const out: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': buildUserAgent(this.#options.userAgentSuffix),
    };

    if (options.body !== undefined) {
      out['Content-Type'] = options.contentType ?? 'application/json';
    }

    if (IDEMPOTENT_METHODS.has(options.method) && options.idempotencyKey !== null) {
      out['Idempotency-Key'] = options.idempotencyKey ?? generateIdempotencyKey();
    }

    if (options.headers !== undefined) {
      for (const [k, v] of Object.entries(options.headers)) {
        out[k] = v;
      }
    }
    return out;
  }

  async #withAuth(
    headers: Record<string, string>,
    skipAuth: boolean,
  ): Promise<Record<string, string>> {
    if (skipAuth || this.#options.auth === undefined) return headers;
    const token = await this.#options.auth.getAccessToken();
    return { ...headers, Authorization: `Bearer ${token}` };
  }

  #encodeBody(options: HttpRequestOptions): string | undefined {
    if (options.body === undefined) return undefined;
    if (
      options.formUrlEncoded === true ||
      options.contentType === 'application/x-www-form-urlencoded'
    ) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(options.body as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          params.set(k, String(v));
        } else {
          params.set(k, JSON.stringify(v));
        }
      }
      return params.toString();
    }
    return JSON.stringify(options.body);
  }

  async #fetchOnce(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
    externalSignal: AbortSignal | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Request exceeded timeout of ${String(timeoutMs)}ms.`));
    }, timeoutMs);

    const onExternal = (): void => {
      controller.abort(externalSignal?.reason);
    };
    if (externalSignal !== undefined) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', onExternal, { once: true });
      }
    }

    this.#options.logger?.debug('flute-sdk →', method, url, {
      headers: redactHeaders(headers),
    });

    try {
      return await this.#options.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      if (externalSignal !== undefined) {
        externalSignal.removeEventListener('abort', onExternal);
      }
    }
  }

  async #parseSuccess<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status === 204 || contentType.length === 0) {
      return undefined as T;
    }
    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text.length === 0) return undefined as T;
      const parsed: unknown = JSON.parse(text);
      return parsed as T;
    }
    // Non-JSON success: surface raw text so callers can handle uncommon endpoints.
    return (await response.text()) as unknown as T;
  }

  async #parseErrorPayload(response: Response): Promise<FluteApiErrorPayload | undefined> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return undefined;
    try {
      const text = await response.text();
      if (text.length === 0) return undefined;
      const parsed: unknown = JSON.parse(text);
      return parsed as FluteApiErrorPayload;
    } catch {
      return undefined;
    }
  }

  #shouldRetry(status: number): boolean {
    if (status === 429) return this.#options.retryOn429;
    return status === 502 || status === 503 || status === 504;
  }

  #backoff(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader !== null) {
      const seconds = Number(retryAfterHeader);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
    // Exponential with full jitter, capped at 30s.
    const base = Math.min(2 ** attempt * 250, 30_000);
    return Math.floor(Math.random() * base);
  }

  #isAbort(err: unknown): boolean {
    if (err instanceof Error && err.name === 'AbortError') return true;
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }

  #isNetwork(err: unknown): boolean {
    if (this.#isAbort(err)) return false;
    if (err instanceof TypeError) return true; // fetch wraps DNS / TCP failures in TypeError
    if (err instanceof Error) {
      const code = (err as Error & { code?: string }).code;
      if (typeof code === 'string') {
        return /^(EAI_AGAIN|ECONN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ECONNRESET|EPIPE)/.test(
          code,
        );
      }
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Map an HTTP error response to the right `FluteError` subclass.
 *
 * @internal
 */
export function mapApiError(
  status: number,
  payload: FluteApiErrorPayload | undefined,
  headers: Headers,
):
  | FluteAuthenticationError
  | FluteValidationError
  | FluteRateLimitError
  | FluteIdempotencyError
  | FluteApiError {
  const summary = errorSummary(status, payload);
  const requestId = headers.get('x-request-id') ?? undefined;
  const correlationId =
    headers.get('x-arise-trace-correlationid') ??
    headers.get('x-correlation-id') ??
    payload?.correlationId ??
    undefined;
  const errorOptions = {
    httpStatus: status,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  };

  if (status === 401 || status === 403) {
    return new FluteAuthenticationError(summary, errorOptions);
  }
  if (status === 400 || status === 422) {
    return new FluteValidationError(summary, payload, errorOptions);
  }
  if (status === 409 && payload?.errorCode === 'IDEMPOTENCY_CONFLICT') {
    return new FluteIdempotencyError(summary, errorOptions);
  }
  if (status === 429) {
    return new FluteRateLimitError(
      summary,
      parseRetryAfter(headers.get('retry-after')),
      errorOptions,
    );
  }
  return new FluteApiError(summary, payload, errorOptions);
}

function errorSummary(status: number, payload: FluteApiErrorPayload | undefined): string {
  if (payload?.title !== undefined && payload.title.length > 0) {
    return `${String(status)} ${payload.title}`;
  }
  if (payload?.details !== undefined && payload.details.length > 0) {
    return `${String(status)} ${payload.details}`;
  }
  return `Flute API responded with HTTP ${String(status)}.`;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  // RFC 7231 also allows an HTTP-date; we ignore it deliberately to keep
  // the SDK's clock skew surface minimal — applications can read the raw
  // header off the response if they need that level of precision.
  return undefined;
}

export { redactValue };
