import { describe, expect, it } from 'vitest';

import { redactHeaders, redactQuery, redactValue } from '../src/internal/redact.js';
import { buildUserAgent } from '../src/internal/userAgent.js';
import { generateIdempotencyKey, IDEMPOTENT_METHODS } from '../src/internal/idempotency.js';

describe('redactHeaders', () => {
  it('redacts sensitive headers and preserves others', () => {
    const out = redactHeaders({
      'Authorization': 'Bearer abc',
      'Content-Type': 'application/json',
      'Cookie': 'session=xyz',
      'X-API-KEY': 'k',
      'X-Request-ID': 'req_1',
    });
    expect(out).toEqual({
      'Authorization': '[REDACTED]',
      'Content-Type': 'application/json',
      'Cookie': '[REDACTED]',
      'X-API-KEY': '[REDACTED]',
      'X-Request-ID': 'req_1',
    });
  });
});

describe('redactValue', () => {
  it('redacts secrets at any depth', () => {
    const out = redactValue({
      access_token: 'leak',
      nested: {
        cardNumber: '4111111111111111',
        cvv: '123',
        keep: 'me',
      },
      list: [{ refreshToken: 'leak2' }, 'plain'],
    });
    expect(out).toEqual({
      access_token: '[REDACTED]',
      nested: {
        cardNumber: '[REDACTED]',
        cvv: '[REDACTED]',
        keep: 'me',
      },
      list: [{ refreshToken: '[REDACTED]' }, 'plain'],
    });
  });

  it('handles primitives and null', () => {
    expect(redactValue('plain')).toBe('plain');
    expect(redactValue(42)).toBe(42);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(undefined)).toBeUndefined();
  });

  it('caps recursion depth on cyclic-shaped input', () => {
    interface RedactNode {
      child?: RedactNode;
    }
    const root: RedactNode = {};
    let cur: RedactNode = root;
    for (let i = 0; i < 20; i += 1) {
      cur.child = {};
      cur = cur.child;
    }
    expect(() => redactValue(root)).not.toThrow();
  });
});

describe('redactQuery', () => {
  it('preserves non-sensitive query params and redacts the others', () => {
    const out = redactQuery('page=2&access_token=leak&q=hello');
    const parsed = new URLSearchParams(out);
    expect(parsed.get('page')).toBe('2');
    expect(parsed.get('q')).toBe('hello');
    expect(parsed.get('access_token')).toBe('[REDACTED]');
  });

  it('accepts a URLSearchParams instance', () => {
    const params = new URLSearchParams('client_secret=very-secret&page=1');
    const out = redactQuery(params);
    expect(out).toContain('client_secret=%5BREDACTED%5D');
    expect(out).toContain('page=1');
  });
});

describe('buildUserAgent', () => {
  it('returns a string starting with the SDK name', () => {
    const ua = buildUserAgent(undefined);
    expect(ua).toMatch(/^flute-sdk-typescript\/\d+\.\d+\.\d+\b/);
    expect(ua).toContain('node/');
    expect(ua).toContain(process.platform);
  });

  it('appends a non-empty suffix', () => {
    expect(buildUserAgent('my-integration/1.0')).toMatch(/my-integration\/1\.0$/);
  });

  it('omits the suffix segment when undefined or empty', () => {
    expect(buildUserAgent(undefined)).not.toMatch(/\)\s+.+$/);
    expect(buildUserAgent('')).not.toMatch(/\)\s+.+$/);
  });
});

describe('idempotency helpers', () => {
  it('generates unique flute_-prefixed keys', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).toMatch(/^flute_/);
    expect(b).toMatch(/^flute_/);
    expect(a).not.toBe(b);
  });

  it('marks the right HTTP methods as idempotent-by-default', () => {
    expect(IDEMPOTENT_METHODS.has('POST')).toBe(true);
    expect(IDEMPOTENT_METHODS.has('PUT')).toBe(true);
    expect(IDEMPOTENT_METHODS.has('PATCH')).toBe(true);
    expect(IDEMPOTENT_METHODS.has('DELETE')).toBe(true);
    expect(IDEMPOTENT_METHODS.has('GET')).toBe(false);
  });
});
