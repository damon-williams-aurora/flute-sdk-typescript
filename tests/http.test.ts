import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  FluteApiError,
  FluteAuthenticationError,
  FluteNetworkError,
  FluteRateLimitError,
  FluteValidationError,
} from '../src/index.js';
import { HttpClient, type AuthProvider } from '../src/internal/http.js';
import { http, HttpResponse, makeServer } from './_helpers/server.js';

const BASE = 'https://example.test';

const server = makeServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});

function makeClient(
  overrides?: Partial<{
    timeoutMs: number;
    maxRetries: number;
    retryOn429: boolean;
    auth: AuthProvider;
  }>,
): HttpClient {
  return new HttpClient({
    timeoutMs: overrides?.timeoutMs ?? 5_000,
    maxRetries: overrides?.maxRetries ?? 0,
    retryOn429: overrides?.retryOn429 ?? false,
    userAgentSuffix: undefined,
    logger: undefined,
    ...(overrides?.auth !== undefined ? { auth: overrides.auth } : {}),
  });
}

describe('HttpClient — happy path', () => {
  it('serialises GET query params and parses JSON', async () => {
    server.use(
      http.get(`${BASE}/things`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('2');
        expect(url.searchParams.get('q')).toBe('hello');
        return HttpResponse.json({ items: [{ id: 1 }] });
      }),
    );

    const client = makeClient();
    const response = await client.request<{ items: { id: number }[] }>({
      method: 'GET',
      url: `${BASE}/things`,
      query: { page: 2, q: 'hello', skipMe: undefined },
    });
    expect(response.status).toBe(200);
    expect(response.data.items).toEqual([{ id: 1 }]);
  });

  it('attaches a User-Agent and Idempotency-Key on POST', async () => {
    let receivedUA = '';
    let receivedIdem = '';

    server.use(
      http.post(`${BASE}/charges`, ({ request }) => {
        receivedUA = request.headers.get('user-agent') ?? '';
        receivedIdem = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json({ id: 'ch_1' });
      }),
    );

    const client = makeClient();
    await client.request({
      method: 'POST',
      url: `${BASE}/charges`,
      body: { amount: 100 },
    });

    expect(receivedUA).toMatch(/^flute-sdk-typescript\//);
    expect(receivedIdem).toMatch(/^flute_/);
  });

  it('honours an explicit idempotency key', async () => {
    let received = '';
    server.use(
      http.post(`${BASE}/charges`, ({ request }) => {
        received = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json({});
      }),
    );

    const client = makeClient();
    await client.request({
      method: 'POST',
      url: `${BASE}/charges`,
      body: {},
      idempotencyKey: 'caller-supplied-key',
    });
    expect(received).toBe('caller-supplied-key');
  });

  it('omits the idempotency key when explicitly set to null', async () => {
    let received: string | null = '';
    server.use(
      http.post(`${BASE}/charges`, ({ request }) => {
        received = request.headers.get('idempotency-key');
        return HttpResponse.json({});
      }),
    );

    const client = makeClient();
    await client.request({
      method: 'POST',
      url: `${BASE}/charges`,
      body: {},
      idempotencyKey: null,
    });
    expect(received).toBeNull();
  });

  it('encodes form-urlencoded bodies for OAuth-style requests', async () => {
    server.use(
      http.post(`${BASE}/oauth2/token`, async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('application/x-www-form-urlencoded');
        const body = await request.text();
        expect(body).toContain('grant_type=client_credentials');
        expect(body).toContain('client_id=cid');
        return HttpResponse.json({ access_token: 'tok', token_type: 'Bearer', expires_in: 900 });
      }),
    );

    const client = makeClient();
    const response = await client.request<{ access_token: string }>({
      method: 'POST',
      url: `${BASE}/oauth2/token`,
      body: { grant_type: 'client_credentials', client_id: 'cid', client_secret: 'shh' },
      contentType: 'application/x-www-form-urlencoded',
      formUrlEncoded: true,
      idempotencyKey: null,
      skipAuth: true,
    });
    expect(response.data.access_token).toBe('tok');
  });
});

describe('HttpClient — error mapping', () => {
  it('maps 401 to FluteAuthenticationError', async () => {
    server.use(
      http.get(`${BASE}/x`, () => HttpResponse.json({ title: 'Unauthorized' }, { status: 401 })),
    );
    const client = makeClient();
    await expect(client.request({ method: 'GET', url: `${BASE}/x` })).rejects.toBeInstanceOf(
      FluteAuthenticationError,
    );
  });

  it('maps 400 to FluteValidationError with the payload preserved', async () => {
    server.use(
      http.post(`${BASE}/x`, () =>
        HttpResponse.json(
          {
            title: 'Validation failed',
            errors: { email: ["'Email' is not a valid email address."] },
            errorCode: 'V0000',
          },
          { status: 400 },
        ),
      ),
    );

    const client = makeClient();
    try {
      await client.request({ method: 'POST', url: `${BASE}/x`, body: {} });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FluteValidationError);
      const payload = (err as FluteValidationError).payload;
      expect(payload?.errorCode).toBe('V0000');
    }
  });

  it('maps 429 to FluteRateLimitError and honours Retry-After (without retrying by default)', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls += 1;
        return HttpResponse.json(
          { title: 'Too many' },
          { status: 429, headers: { 'Retry-After': '7' } },
        );
      }),
    );

    // maxRetries=2 is irrelevant: retryOn429 defaults to false,
    // so the SDK fails fast and surfaces retryAfterMs to the caller.
    const client = makeClient({ maxRetries: 2 });
    try {
      await client.request({ method: 'GET', url: `${BASE}/x` });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FluteRateLimitError);
      expect((err as FluteRateLimitError).retryAfterMs).toBe(7000);
    }
    expect(calls).toBe(1);
  });

  it('opt-in retryOn429 retries the configured number of times', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json(
            { title: 'Slow down' },
            { status: 429, headers: { 'Retry-After': '0' } },
          );
        }
        return HttpResponse.json({ ok: true });
      }),
    );

    const client = makeClient({ maxRetries: 3, retryOn429: true });
    const response = await client.request<{ ok: boolean }>({
      method: 'GET',
      url: `${BASE}/x`,
    });
    expect(response.data.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('maps 500 to FluteApiError with correlation id', async () => {
    server.use(
      http.get(`${BASE}/x`, () =>
        HttpResponse.json(
          { title: 'Boom', correlationId: 'corr_123' },
          { status: 500, headers: { 'x-arise-trace-correlationid': 'corr_456' } },
        ),
      ),
    );

    const client = makeClient();
    try {
      await client.request({ method: 'GET', url: `${BASE}/x` });
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FluteApiError);
      expect((err as FluteApiError).correlationId).toBe('corr_456');
    }
  });
});

describe('HttpClient — retries', () => {
  it('retries 503 up to maxRetries', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({}, { status: 503 });
        }
        return HttpResponse.json({ ok: true });
      }),
    );

    const client = makeClient({ maxRetries: 3 });
    const response = await client.request<{ ok: boolean }>({ method: 'GET', url: `${BASE}/x` });
    expect(response.data.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('does not retry on 400', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/x`, () => {
        calls += 1;
        return HttpResponse.json({}, { status: 400 });
      }),
    );

    const client = makeClient({ maxRetries: 5 });
    await expect(
      client.request({ method: 'POST', url: `${BASE}/x`, body: {} }),
    ).rejects.toBeInstanceOf(FluteValidationError);
    expect(calls).toBe(1);
  });

  it('throws FluteNetworkError after exhausting retries on transport failure', async () => {
    server.use(http.get(`${BASE}/x`, () => HttpResponse.error()));
    const client = makeClient({ maxRetries: 1 });
    await expect(client.request({ method: 'GET', url: `${BASE}/x` })).rejects.toBeInstanceOf(
      FluteNetworkError,
    );
  });
});

describe('HttpClient — auth interceptor', () => {
  it('injects a Bearer token from the auth provider', async () => {
    let received = '';
    server.use(
      http.get(`${BASE}/x`, ({ request }) => {
        received = request.headers.get('authorization') ?? '';
        return HttpResponse.json({});
      }),
    );

    const auth: AuthProvider = {
      getAccessToken: () => Promise.resolve('tok-abc'),
      invalidate: () => Promise.resolve('tok-abc'),
    };
    const client = makeClient({ auth });
    await client.request({ method: 'GET', url: `${BASE}/x` });
    expect(received).toBe('Bearer tok-abc');
  });

  it('refreshes the token once on 401, then retries', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, ({ request }) => {
        calls += 1;
        const auth = request.headers.get('authorization');
        if (auth === 'Bearer fresh') return HttpResponse.json({ ok: true });
        return HttpResponse.json({}, { status: 401 });
      }),
    );

    let stale = true;
    const auth: AuthProvider = {
      getAccessToken: () => Promise.resolve(stale ? 'stale' : 'fresh'),
      invalidate: () => {
        stale = false;
        return Promise.resolve('fresh');
      },
    };

    const client = makeClient({ auth });
    const response = await client.request<{ ok: boolean }>({ method: 'GET', url: `${BASE}/x` });
    expect(response.data.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('does not loop forever on persistent 401', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls += 1;
        return HttpResponse.json({ title: 'Nope' }, { status: 401 });
      }),
    );

    const auth: AuthProvider = {
      getAccessToken: () => Promise.resolve('x'),
      invalidate: () => Promise.resolve('y'),
    };
    const client = makeClient({ auth });
    await expect(client.request({ method: 'GET', url: `${BASE}/x` })).rejects.toBeInstanceOf(
      FluteAuthenticationError,
    );
    expect(calls).toBe(2);
  });
});
