import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MemoryTokenStorage } from '../src/index.js';
import { HttpClient } from '../src/internal/http.js';
import { TokenManager } from '../src/auth/tokenManager.js';
import { http, HttpResponse, makeServer } from './_helpers/server.js';

const OAUTH_BASE = 'https://identity.example.test';
const TOKEN_URL = `${OAUTH_BASE}/oauth2/token`;

const server = makeServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function makeManager(extra?: { storage?: MemoryTokenStorage }): {
  manager: TokenManager;
  storage: MemoryTokenStorage;
} {
  const storage = extra?.storage ?? new MemoryTokenStorage();
  const httpClient = new HttpClient({
    timeoutMs: 5_000,
    maxRetries: 0,
    retryOn429: false,
    userAgentSuffix: undefined,
    logger: undefined,
  });
  const manager = new TokenManager({
    clientId: 'cid',
    clientSecret: 'shh',
    oauthBaseUrl: OAUTH_BASE,
    storage,
    http: httpClient,
    proactiveRefreshSkewMs: 30_000,
  });
  return { manager, storage };
}

describe('TokenManager', () => {
  it('exchanges client_credentials and caches the token', async () => {
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        calls += 1;
        const body = await request.text();
        expect(body).toContain('grant_type=client_credentials');
        expect(body).toContain('client_id=cid');
        expect(body).toContain('client_secret=shh');
        return HttpResponse.json({
          access_token: 'tok-1',
          refresh_token: 'rt-1',
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );

    const { manager, storage } = makeManager();
    const t1 = await manager.getAccessToken();
    expect(t1).toBe('tok-1');

    const t2 = await manager.getAccessToken();
    expect(t2).toBe('tok-1');
    expect(calls).toBe(1);

    const stored = await storage.get('cid');
    expect(stored?.accessToken).toBe('tok-1');
    expect(stored?.refreshToken).toBe('rt-1');
  });

  it('uses the refresh_token grant once a refresh token is cached', async () => {
    let lastBody = '';
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        lastBody = await request.text();
        return HttpResponse.json({
          access_token: 'tok-fresh',
          refresh_token: 'rt-fresh',
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );

    const storage = new MemoryTokenStorage();
    await storage.set('cid', {
      accessToken: 'tok-stale',
      refreshToken: 'rt-stale',
      expiresAt: Date.now() - 1, // already expired
    });

    const { manager } = makeManager({ storage });
    const t = await manager.getAccessToken();
    expect(t).toBe('tok-fresh');
    expect(lastBody).toContain('grant_type=refresh_token');
    expect(lastBody).toContain('refresh_token=rt-stale');
  });

  it('falls back to client_credentials when the refresh token is rejected', async () => {
    let nthCall = 0;
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        nthCall += 1;
        const body = await request.text();
        if (body.includes('grant_type=refresh_token')) {
          return HttpResponse.json({ title: 'Bad refresh' }, { status: 401 });
        }
        return HttpResponse.json({
          access_token: 'tok-cc',
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );

    const storage = new MemoryTokenStorage();
    await storage.set('cid', {
      accessToken: 'old',
      refreshToken: 'rt-bad',
      expiresAt: Date.now() - 1,
    });

    const { manager } = makeManager({ storage });
    const t = await manager.getAccessToken();
    expect(t).toBe('tok-cc');
    expect(nthCall).toBe(2);
  });

  it('coalesces concurrent refresh calls into a single network request', async () => {
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, async () => {
        calls += 1;
        // Simulate a slow Identity Service so the second caller arrives
        // while the first is still waiting on the wire.
        await new Promise((resolve) => setTimeout(resolve, 25));
        return HttpResponse.json({
          access_token: `tok-${String(calls)}`,
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );

    const { manager } = makeManager();
    const [a, b, c] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(calls).toBe(1);
  });

  it('refreshes proactively when the cached token is within the skew window', async () => {
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, () => {
        calls += 1;
        return HttpResponse.json({
          access_token: `tok-${String(calls)}`,
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );

    const storage = new MemoryTokenStorage();
    await storage.set('cid', {
      accessToken: 'almost-dead',
      expiresAt: Date.now() + 10_000, // < 30s skew
    });

    const { manager } = makeManager({ storage });
    const t = await manager.getAccessToken();
    expect(t).toBe('tok-1');
    expect(calls).toBe(1);
  });

  it('clear() removes the cached token', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ access_token: 'a', token_type: 'Bearer', expires_in: 900 }),
      ),
    );
    const { manager, storage } = makeManager();
    await manager.getAccessToken();
    expect(await storage.get('cid')).toBeDefined();
    await manager.clear();
    expect(await storage.get('cid')).toBeUndefined();
  });
});
