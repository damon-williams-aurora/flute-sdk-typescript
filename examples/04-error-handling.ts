/**
 * Example: discriminating Flute SDK errors and reacting correctly.
 *
 * Triggers each subclass deliberately so the pattern is easy to copy.
 *
 * Run with:
 *
 *     FLUTE_CLIENT_ID=... FLUTE_CLIENT_SECRET=... \
 *     npx tsx examples/04-error-handling.ts
 */

import {
  Flute,
  FluteApiError,
  FluteAuthenticationError,
  FluteConfigurationError,
  FluteIdempotencyError,
  FluteNetworkError,
  FluteRateLimitError,
  FluteValidationError,
  FluteWebhookError,
  verifyWebhookSignature,
} from '../src/index.js';

async function main(): Promise<void> {
  // 1. FluteConfigurationError — caught at construction time.
  try {
    new Flute({ clientId: '', clientSecret: 'shh' });
  } catch (err) {
    if (err instanceof FluteConfigurationError) {
      console.log('1. config error:', err.message);
    } else {
      throw err;
    }
  }

  const clientId = process.env['FLUTE_CLIENT_ID'] ?? 'missing';
  const clientSecret = process.env['FLUTE_CLIENT_SECRET'] ?? 'missing';
  const flute = new Flute({
    clientId,
    clientSecret,
    environment: 'sandbox',
    userAgentSuffix: 'flute-sdk-errors-example/1.0',
    timeoutMs: 5_000,
  });

  // 2. FluteAuthenticationError — bad credentials.
  if (clientId === 'missing') {
    try {
      await flute.sessions.authenticate();
    } catch (err) {
      if (err instanceof FluteAuthenticationError) {
        console.log('2. auth error:', err.message, 'requestId=', err.requestId);
      } else {
        throw err;
      }
    }
  }

  // 3. FluteValidationError — malformed request body. The SDK preserves
  //    the field-level diagnostics on `.payload.errors` so the UI can
  //    highlight the offending input.
  try {
    // Intentionally malformed body — missing card data — to trigger
    // a 400/422 response from the API.
    await flute.transactions.authorize({
      baseAmount: 100,
      currencyCode: 'USD',
      transactionDetails: { cardData: {} },
    });
  } catch (err) {
    if (err instanceof FluteValidationError) {
      console.log('3. validation error:', err.message);
      console.log('   field errors:', err.payload?.errors ?? '(none)');
    } else if (err instanceof FluteAuthenticationError) {
      console.log('3. (skipped — auth required first)');
    } else {
      throw err;
    }
  }

  // 4. FluteRateLimitError — never returned by the sandbox in this demo,
  //    but the catch shape is exactly this.
  try {
    await flute.transactions.list({ pageSize: 25 });
  } catch (err) {
    if (err instanceof FluteRateLimitError) {
      console.log('4. rate limit:', err.retryAfterMs, 'ms — will back off');
    } else if (err instanceof FluteApiError) {
      console.log('4. api error:', err.payload?.errorCode, err.message);
    } else {
      throw err;
    }
  }

  // 5. FluteIdempotencyError — reusing the same Idempotency-Key with a
  //    different body. The SDK never produces this implicitly; it surfaces
  //    when you've passed your own `idempotencyKey` and the server
  //    detected a payload mismatch.
  console.log('5. FluteIdempotencyError exists =', typeof FluteIdempotencyError === 'function');

  // 6. FluteNetworkError — DNS/connect/timeout failures.
  console.log('6. FluteNetworkError exists =', typeof FluteNetworkError === 'function');

  // 7. FluteWebhookError — malformed verification call (caller bug).
  try {
    verifyWebhookSignature({
      signatureHeader: '',
      idHeader: 'evt_x',
      timestampHeader: String(Math.floor(Date.now() / 1000)),
      rawRequestBody: '{}',
      signatureSecret: 'whsec_demo',
    });
  } catch (err) {
    if (err instanceof FluteWebhookError) {
      console.log('7. webhook error:', err.message);
    } else {
      throw err;
    }
  }
}

main().catch((err: unknown) => {
  console.error('unexpected:', err);
  process.exit(1);
});
