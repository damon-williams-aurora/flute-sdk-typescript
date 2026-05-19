import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Flute } from '../src/index.js';
import { http, HttpResponse, makeServer } from './_helpers/server.js';

const OAUTH_BASE = 'https://example.test/identity';

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

function makeFlute(): Flute {
  return new Flute({
    clientId: 'cid',
    clientSecret: 'shh',
    baseUrls: { oauth: OAUTH_BASE },
    maxRetries: 0,
  });
}

describe('Sessions', () => {
  it('init() resolves immediately (no-op for forward compatibility)', async () => {
    const flute = makeFlute();
    await expect(flute.sessions.init()).resolves.toBeUndefined();
  });

  it('authenticate() exchanges client_credentials and returns the stored token', async () => {
    server.use(
      http.post(`${OAUTH_BASE}/oauth2/token`, () =>
        HttpResponse.json({
          access_token: 'tok-1',
          refresh_token: 'rt-1',
          token_type: 'Bearer',
          expires_in: 900,
        }),
      ),
    );
    const flute = makeFlute();
    const token = await flute.sessions.authenticate();
    expect(token.accessToken).toBe('tok-1');
    expect(token.refreshToken).toBe('rt-1');
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it('getAccessToken() returns the live token string', async () => {
    server.use(
      http.post(`${OAUTH_BASE}/oauth2/token`, () =>
        HttpResponse.json({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }),
      ),
    );
    const flute = makeFlute();
    expect(await flute.sessions.getAccessToken()).toBe('tok-1');
  });

  it('refreshAccessToken() forces a refresh', async () => {
    let calls = 0;
    server.use(
      http.post(`${OAUTH_BASE}/oauth2/token`, () => {
        calls += 1;
        return HttpResponse.json({
          access_token: `tok-${String(calls)}`,
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );
    const flute = makeFlute();
    await flute.sessions.getAccessToken();
    await flute.sessions.refreshAccessToken();
    expect(calls).toBe(2);
  });

  it('clearStoredToken() forgets the cached token', async () => {
    let calls = 0;
    server.use(
      http.post(`${OAUTH_BASE}/oauth2/token`, () => {
        calls += 1;
        return HttpResponse.json({
          access_token: `tok-${String(calls)}`,
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );
    const flute = makeFlute();
    await flute.sessions.getAccessToken();
    await flute.sessions.clearStoredToken();
    await flute.sessions.getAccessToken();
    expect(calls).toBe(2);
  });

  it('surfaces 401s from the OAuth endpoint as FluteAuthenticationError', async () => {
    server.use(
      http.post(`${OAUTH_BASE}/oauth2/token`, () =>
        HttpResponse.json({ title: 'Unauthorized client' }, { status: 401 }),
      ),
    );
    const flute = makeFlute();
    await expect(flute.sessions.authenticate()).rejects.toThrow();
  });
});

describe('webhooks namespace', () => {
  it('forwards to verifyWebhookSignature', () => {
    const flute = makeFlute();
    const result = flute.webhooks.verifySignature({
      signatureHeader: 'malformed',
      idHeader: 'id',
      timestampHeader: '0',
      rawRequestBody: '',
      signatureSecret: 's',
    });
    expect(result).toBe(false);
  });
});
