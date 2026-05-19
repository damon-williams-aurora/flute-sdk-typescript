/**
 * Quickstart — credentials → first sale in under 30 minutes.
 *
 * Run with:
 *
 *     FLUTE_CLIENT_ID=... FLUTE_CLIENT_SECRET=... npx tsx examples/01-quickstart.ts
 */

import { Flute } from '../src/index.js';

async function main(): Promise<void> {
  const clientId = process.env['FLUTE_CLIENT_ID'];
  const clientSecret = process.env['FLUTE_CLIENT_SECRET'];

  if (clientId === undefined || clientSecret === undefined) {
    console.error(
      'Missing FLUTE_CLIENT_ID or FLUTE_CLIENT_SECRET. Get sandbox credentials from your Flute dashboard.',
    );
    process.exit(1);
  }

  const flute = new Flute({
    clientId,
    clientSecret,
    environment: 'sandbox',
    userAgentSuffix: 'flute-sdk-quickstart-example/1.0',
  });

  // 1. Sanity-check credentials and merchant config.
  await flute.sessions.authenticate();
  const settings = await flute.settings.getPaymentSettings();
  console.log(
    'Connected to',
    flute.environment,
    '— company:',
    settings.companyName,
    '— processors:',
    settings.availablePaymentProcessors?.length ?? 0,
  );

  // 2. Calculate the final amount (respects ZCP / surcharge / tip rules).
  const totals = await flute.transactions.calculateAmount({
    baseAmount: 100,
    tipRate: 0.18,
  });
  console.log(
    'Credit total:',
    totals.creditCard?.totalAmount,
    'Debit total:',
    totals.debitCard?.totalAmount,
  );

  // 3. Authorize → capture flow (replace with a saved paymentMethodId in production).
  const authorization = await flute.transactions.authorize({
    baseAmount: 100,
    currencyCode: 'USD',
    transactionDetails: {
      cardData: {
        paymentMethodDetails: {
          cardNumber: '4111111111111111',
          securityCode: '123',
          expirationMonth: 12,
          expirationYear: 2030,
        },
      },
    },
  });
  console.log('Authorized:', authorization.transactionId, '→', authorization.transactionStatus);

  if (authorization.transactionId !== undefined) {
    const captured = await flute.transactions.capture(authorization.transactionId);
    console.log('Captured:', captured.transactionId, '→', captured.transactionStatus);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
