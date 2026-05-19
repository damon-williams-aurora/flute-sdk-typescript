/**
 * Example: server-side bootstrap for a Flute hosted-checkout flow.
 *
 * The merchant's backend creates a payment session, hands the session
 * id to its front-end, and the customer completes the payment via the
 * hosted checkout. The back-end then polls or receives a webhook to
 * confirm.
 *
 * Run with:
 *
 *     FLUTE_CLIENT_ID=... FLUTE_CLIENT_SECRET=... \
 *     npx tsx examples/03-payment-sessions.ts
 */

import { Flute, FluteApiError } from '../src/index.js';

async function main(): Promise<void> {
  const clientId = process.env['FLUTE_CLIENT_ID'];
  const clientSecret = process.env['FLUTE_CLIENT_SECRET'];
  if (clientId === undefined || clientSecret === undefined) {
    console.error('Missing FLUTE_CLIENT_ID / FLUTE_CLIENT_SECRET.');
    process.exit(1);
  }

  const flute = new Flute({
    clientId,
    clientSecret,
    environment: 'sandbox',
    userAgentSuffix: 'flute-sdk-checkout-example/1.0',
  });

  // 1. Create the session — `mode: 'Payment'` charges the card now;
  //    'SaveMethod' tokenises only; 'PaymentAndSave' does both.
  //    `amount` is in USD (not cents) per the pay-int-api v1 contract.
  const created = await flute.paymentSessions.create({
    mode: 'Payment',
    amount: 49.99,
    referenceId: 'order_1234',
  });

  console.log('session.id =', created.id);
  console.log('  → hand this id to your front-end checkout component.\n');

  // 2. Backend reconciliation: poll the session until it terminates.
  //    In production you'd react to the matching webhook instead.
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    const current = await flute.paymentSessions.retrieve(created.id);
    console.log(' …status:', current.status, '/ statusId:', current.statusId);
    if (
      current.status === 'Completed' ||
      current.status === 'Failed' ||
      current.status === 'Cancelled'
    ) {
      console.log('terminal status reached — stop polling.');
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }

  // 3. Bail-out path: if the customer abandons the flow, cancel the
  //    session so the merchant dashboard doesn't show a stale "open" row.
  try {
    await flute.paymentSessions.cancel(created.id);
    console.log('session cancelled.');
  } catch (err) {
    if (err instanceof FluteApiError && err.httpStatus === 409) {
      console.log('session already terminated, nothing to cancel.');
      return;
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
