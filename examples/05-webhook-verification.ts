/**
 * Verifying a webhook signature with the Flute SDK.
 *
 * Run with: `FLUTE_WEBHOOK_SECRET=... npx tsx examples/05-webhook-verification.ts`
 *
 * The example below imitates an Express-style handler so the wiring is
 * obvious. The critical detail is that `rawRequestBody` MUST be the raw
 * request bytes — re-serialising the parsed JSON breaks the HMAC.
 */

import { verifyWebhookSignature } from '../src/index.js';

const incomingHeaders = {
  'flute-webhook-id': 'evt_demo',
  'flute-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
  'flute-webhook-signature': 'v1,REPLACE_WITH_REAL_SIGNATURE',
};

const rawBody = JSON.stringify({ type: 'transaction.captured', data: { id: 'tx_demo' } });

const ok = verifyWebhookSignature({
  signatureHeader: incomingHeaders['flute-webhook-signature'],
  idHeader: incomingHeaders['flute-webhook-id'],
  timestampHeader: incomingHeaders['flute-webhook-timestamp'],
  rawRequestBody: rawBody,
  signatureSecret: process.env['FLUTE_WEBHOOK_SECRET'] ?? 'whsec_placeholder',
});

console.log('signature ok?', ok);
if (!ok) {
  console.error(
    'Reject the request with HTTP 401. Never act on unverified webhooks — replay or forgery is trivial otherwise.',
  );
  process.exit(1);
}
