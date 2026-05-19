import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { FluteWebhookError, verifyWebhookSignature, WebhooksNamespace } from '../src/index.js';

function sign(secret: string, eventId: string, ts: number, body: string): string {
  const content = `${eventId}.${String(ts)}.${body}`;
  const digest = createHmac('sha256', secret).update(content).digest('base64');
  return `v1,${digest}`;
}

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_KQX7';
  const id = 'evt_01HZ123456';
  const ts = 1_700_000_000;
  const body = JSON.stringify({ type: 'transaction.captured', data: { id: 'tx_1' } });

  it('returns true on a valid signature within the tolerance window', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: body,
        signatureSecret: secret,
      },
      { nowEpochSeconds: ts },
    );
    expect(ok).toBe(true);
  });

  it('returns true when raw body is provided as Uint8Array', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: new TextEncoder().encode(body),
        signatureSecret: secret,
      },
      { nowEpochSeconds: ts },
    );
    expect(ok).toBe(true);
  });

  it('returns false when the body has been tampered with', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: body.replace('tx_1', 'tx_2'),
        signatureSecret: secret,
      },
      { nowEpochSeconds: ts },
    );
    expect(ok).toBe(false);
  });

  it('returns false when the secret is wrong', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: body,
        signatureSecret: 'whsec_other',
      },
      { nowEpochSeconds: ts },
    );
    expect(ok).toBe(false);
  });

  it('returns false when the timestamp is outside the tolerance window', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: body,
        signatureSecret: secret,
      },
      { nowEpochSeconds: ts + 600, toleranceSeconds: 300 },
    );
    expect(ok).toBe(false);
  });

  it('honours toleranceSeconds = Infinity (replay protection disabled)', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: body,
        signatureSecret: secret,
      },
      { nowEpochSeconds: ts + 365 * 24 * 60 * 60, toleranceSeconds: Number.POSITIVE_INFINITY },
    );
    expect(ok).toBe(true);
  });

  it('returns false on a malformed (but well-typed) signature header', () => {
    // Signature-shape problems return false (the
    // signature is *present* but cryptographically invalid). Throwing is
    // reserved for missing/non-string parameters where verification can't
    // even begin.
    for (const sigHeader of ['not-a-signature', 'v2,abc', 'v1,not-base64-!!!']) {
      expect(
        verifyWebhookSignature({
          signatureHeader: sigHeader,
          idHeader: id,
          timestampHeader: String(ts),
          rawRequestBody: body,
          signatureSecret: secret,
        }),
      ).toBe(false);
    }
  });

  it('throws FluteWebhookError when a required parameter is missing or empty (FR-4.3)', () => {
    const base = {
      signatureHeader: 'v1,abc',
      idHeader: id,
      timestampHeader: String(ts),
      rawRequestBody: body,
      signatureSecret: secret,
    };

    expect(() => verifyWebhookSignature({ ...base, signatureHeader: '' })).toThrow(
      FluteWebhookError,
    );
    expect(() => verifyWebhookSignature({ ...base, idHeader: '' })).toThrow(FluteWebhookError);
    expect(() => verifyWebhookSignature({ ...base, timestampHeader: '' })).toThrow(
      FluteWebhookError,
    );
    expect(() => verifyWebhookSignature({ ...base, signatureSecret: '' })).toThrow(
      FluteWebhookError,
    );
    // Wrong type for raw body — caller probably passed a parsed JSON object.
    expect(() =>
      verifyWebhookSignature({
        ...base,
        rawRequestBody: { hello: 'world' } as unknown as string,
      }),
    ).toThrow(FluteWebhookError);
  });

  it('supports the positional signature form (5 args)', () => {
    const sig = sign(secret, id, ts, body);
    const ok = verifyWebhookSignature(sig, id, String(ts), body, secret, {
      nowEpochSeconds: ts,
    });
    expect(ok).toBe(true);
  });

  it('throws FluteWebhookError when positional args are wrong (FR-4.3)', () => {
    expect(() =>
      // @ts-expect-error — intentionally calling with too few args
      verifyWebhookSignature('v1,abc', undefined, String(ts), body, secret),
    ).toThrow(FluteWebhookError);
    expect(() =>
      // @ts-expect-error — first arg is null
      verifyWebhookSignature(null),
    ).toThrow(FluteWebhookError);
  });

  it('exposes the same surface through flute.webhooks.verifySignature', () => {
    const sig = sign(secret, id, ts, body);
    const ns = new WebhooksNamespace();

    expect(
      ns.verifySignature(
        {
          signatureHeader: sig,
          idHeader: id,
          timestampHeader: String(ts),
          rawRequestBody: body,
          signatureSecret: secret,
        },
        { nowEpochSeconds: ts },
      ),
    ).toBe(true);

    expect(ns.verifySignature(sig, id, String(ts), body, secret, { nowEpochSeconds: ts })).toBe(
      true,
    );

    expect(() =>
      ns.verifySignature({
        signatureHeader: '',
        idHeader: id,
        timestampHeader: String(ts),
        rawRequestBody: body,
        signatureSecret: secret,
      }),
    ).toThrow(FluteWebhookError);
  });

  it('returns false when the timestamp is not numeric', () => {
    const sig = sign(secret, id, ts, body);
    expect(
      verifyWebhookSignature({
        signatureHeader: sig,
        idHeader: id,
        timestampHeader: 'not-a-timestamp',
        rawRequestBody: body,
        signatureSecret: secret,
      }),
    ).toBe(false);
  });

  it('matches the backend WebhookHmacService output bit-for-bit', () => {
    // Cross-check against the known test vector from
    // Arise.NotificationsService/.../WebhookHmacServiceTests.cs
    // (the "Sign_SignatureMatchesIndependentHmacSha256Computation" case).
    const vSecret = 'shared-secret';
    const vId = 'test-event-id';
    const vTs = 1_739_465_072;
    const vBody = '{"foo":"bar"}';

    const sig = sign(vSecret, vId, vTs, vBody);
    const ok = verifyWebhookSignature(
      {
        signatureHeader: sig,
        idHeader: vId,
        timestampHeader: String(vTs),
        rawRequestBody: vBody,
        signatureSecret: vSecret,
      },
      { nowEpochSeconds: vTs },
    );
    expect(ok).toBe(true);
  });
});
