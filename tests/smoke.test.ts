import { describe, expect, it } from 'vitest';

import {
  Environment,
  Flute,
  FluteApiError,
  FluteAuthenticationError,
  FluteConfigurationError,
  FluteError,
  FluteIdempotencyError,
  FluteNetworkError,
  FluteRateLimitError,
  FluteValidationError,
  FluteWebhookError,
  MemoryTokenStorage,
  Sessions,
  getVersion,
} from '../src/index.js';

describe('Construction', () => {
  it('exports Flute as a constructor', () => {
    expect(typeof Flute).toBe('function');
  });

  it('refuses to construct without a clientId', () => {
    expect(
      () =>
        new Flute({
          clientId: '',
          clientSecret: 'shh',
        }),
    ).toThrow(FluteConfigurationError);
  });

  it('refuses to construct without a clientSecret', () => {
    expect(
      () =>
        new Flute({
          clientId: 'cid',
          clientSecret: '',
        }),
    ).toThrow(FluteConfigurationError);
  });

  it('defaults to sandbox environment with the right hosts', () => {
    const flute = new Flute({ clientId: 'cid', clientSecret: 'shh' });
    expect(flute.environment).toBe('sandbox');
    // Regression guard: the v2 REST API endpoints are served at the API host
    // root, NOT under `/isv-api/`. See comment in `src/environment.ts`.
    expect(flute.baseUrls.isvApi).toBe('https://api.uat.arise.risewithaurora.com');
    expect(flute.baseUrls.payIntApi).toBe('https://api.uat.arise.risewithaurora.com/pay-int-api');
    expect(flute.baseUrls.oauth).toBe('https://oauth.uat.arise.risewithaurora.com');
  });

  it('uses the production hosts when environment is production', () => {
    const flute = new Flute({
      clientId: 'cid',
      clientSecret: 'shh',
      environment: Environment.Production,
    });
    expect(flute.environment).toBe('production');
    expect(flute.baseUrls.isvApi).toBe('https://api.arise.risewithaurora.com');
    expect(flute.baseUrls.payIntApi).toBe('https://api.arise.risewithaurora.com/pay-int-api');
    expect(flute.baseUrls.oauth).toBe('https://oauth.arise.risewithaurora.com');
  });

  it('honours per-environment URL overrides', () => {
    const flute = new Flute({
      clientId: 'cid',
      clientSecret: 'shh',
      baseUrls: {
        isvApi: 'https://example.test/isv-api/',
      },
    });
    expect(flute.baseUrls.isvApi).toBe('https://example.test/isv-api');
  });

  it('rejects non-HTTPS base URLs except loopback (NFR-1)', () => {
    expect(
      () =>
        new Flute({
          clientId: 'cid',
          clientSecret: 'shh',
          baseUrls: { isvApi: 'http://api.example.com' },
        }),
    ).toThrow(FluteConfigurationError);

    // Loopback HTTP is allowed for tests / contract servers.
    const flute = new Flute({
      clientId: 'cid',
      clientSecret: 'shh',
      baseUrls: {
        isvApi: 'http://localhost:9000',
        payIntApi: 'http://127.0.0.1:9001',
        oauth: 'http://localhost:9002',
      },
    });
    expect(flute.baseUrls.isvApi).toBe('http://localhost:9000');
  });

  it('rejects malformed base URLs', () => {
    expect(
      () =>
        new Flute({
          clientId: 'cid',
          clientSecret: 'shh',
          baseUrls: { isvApi: 'not a url' },
        }),
    ).toThrow(FluteConfigurationError);
  });

  it('validates timeout / retries / refresh-buffer numeric inputs', () => {
    expect(() => new Flute({ clientId: 'c', clientSecret: 's', timeoutMs: -1 })).toThrow(
      FluteConfigurationError,
    );
    expect(() => new Flute({ clientId: 'c', clientSecret: 's', maxRetries: -1 })).toThrow(
      FluteConfigurationError,
    );
    expect(() => new Flute({ clientId: 'c', clientSecret: 's', maxRetries: 1.5 })).toThrow(
      FluteConfigurationError,
    );
    expect(
      () =>
        new Flute({
          clientId: 'c',
          clientSecret: 's',
          tokenRefreshBufferSeconds: -10,
        }),
    ).toThrow(FluteConfigurationError);
  });

  it('exposes Environment as a typed const enum', () => {
    expect(Environment.Sandbox).toBe('sandbox');
    expect(Environment.Production).toBe('production');
    const flute = new Flute({
      clientId: 'c',
      clientSecret: 's',
      environment: Environment.Sandbox,
    });
    expect(flute.environment).toBe('sandbox');
  });

  it('exposes all five namespaces as public properties', () => {
    const flute = new Flute({ clientId: 'cid', clientSecret: 'shh' });
    expect(flute.sessions).toBeInstanceOf(Sessions);
    expect(flute.transactions).toBeDefined();
    expect(flute.paymentSessions).toBeDefined();
    expect(flute.settings).toBeDefined();
    expect(flute.webhooks).toBeDefined();
  });
});

describe('Error hierarchy', () => {
  it('every subclass is instanceof FluteError', () => {
    expect(new FluteConfigurationError('x')).toBeInstanceOf(FluteError);
    expect(new FluteAuthenticationError('x')).toBeInstanceOf(FluteError);
    expect(new FluteApiError('x', undefined)).toBeInstanceOf(FluteError);
    expect(new FluteValidationError('x', undefined)).toBeInstanceOf(FluteError);
    expect(new FluteNetworkError('x')).toBeInstanceOf(FluteError);
    expect(new FluteRateLimitError('x', undefined)).toBeInstanceOf(FluteError);
    expect(new FluteIdempotencyError('x')).toBeInstanceOf(FluteError);
    expect(new FluteWebhookError('x')).toBeInstanceOf(FluteError);
  });

  it('preserves request and correlation ids', () => {
    const err = new FluteApiError(
      'Boom',
      { errorCode: 'X1' },
      {
        httpStatus: 500,
        requestId: 'req_1',
        correlationId: 'corr_1',
      },
    );
    expect(err.httpStatus).toBe(500);
    expect(err.requestId).toBe('req_1');
    expect(err.correlationId).toBe('corr_1');
    expect(err.errorCode).toBe('X1');
  });
});

describe('MemoryTokenStorage', () => {
  it('round-trips a token', async () => {
    const store = new MemoryTokenStorage();
    await store.set('k', { accessToken: 't', expiresAt: Date.now() + 60_000 });
    expect(await store.get('k')).toMatchObject({ accessToken: 't' });
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('keeps expired tokens — TokenManager owns lifetime decisions', async () => {
    // The storage is intentionally a dumb container so a refresh_token
    // remains accessible even after the access_token has expired.
    const store = new MemoryTokenStorage();
    await store.set('k', { accessToken: 't', expiresAt: Date.now() - 1 });
    expect(await store.get('k')).toMatchObject({ accessToken: 't' });
  });
});

describe('Version', () => {
  it('reports a non-empty SDK version', () => {
    const v = getVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});
