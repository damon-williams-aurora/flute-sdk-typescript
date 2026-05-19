import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Flute } from '../src/index.js';
import { http, HttpResponse, makeServer } from './_helpers/server.js';

// The v2 REST API endpoints live at the API host root, NOT under /isv-api.
// Mirror that in the test fixtures so a future regression that brings
// the prefix back fails this suite as well.
const ISV_BASE = 'https://example.test';
const PAY_INT_BASE = 'https://example.test/pay-int-api';
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
  // Always intercept the OAuth call first so resource calls have a token
  // to attach. Individual tests register additional handlers afterwards.
  server.use(
    http.post(`${OAUTH_BASE}/oauth2/token`, () =>
      HttpResponse.json({
        access_token: 'tok-test',
        token_type: 'Bearer',
        expires_in: 900,
      }),
    ),
  );
  return new Flute({
    clientId: 'cid',
    clientSecret: 'shh',
    baseUrls: { isvApi: ISV_BASE, payIntApi: PAY_INT_BASE, oauth: OAUTH_BASE },
    maxRetries: 0,
  });
}

describe('SettingsResource.getPaymentSettings', () => {
  it('GETs /v2/settings/payment-config and returns the payload verbatim', async () => {
    const sample = {
      availableCurrencies: ['USD'],
      isTipsEnabled: true,
      maxTransactionAmount: 10_000,
      defaultTipsOptions: [10, 15, 20],
    };
    server.use(
      http.get(`${ISV_BASE}/v2/settings/payment-config`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer tok-test');
        return HttpResponse.json(sample);
      }),
    );

    const flute = makeFlute();
    const settings = await flute.settings.getPaymentSettings();
    expect(settings).toEqual(sample);
  });
});

describe('TransactionsResource', () => {
  it('list() forwards page/pageSize and parses the page envelope', async () => {
    server.use(
      http.get(`${ISV_BASE}/v2/transactions`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('1');
        expect(url.searchParams.get('pageSize')).toBe('25');
        return HttpResponse.json({
          items: [{ transactionId: 'tx_1', status: 'Captured' }],
          total: 1,
        });
      }),
    );
    const flute = makeFlute();
    const result = await flute.transactions.list({ page: 1, pageSize: 25 });
    expect(result.total).toBe(1);
    expect(result.items[0]?.transactionId).toBe('tx_1');
  });

  it('retrieve() encodes the path id and returns the transaction', async () => {
    server.use(
      http.get(`${ISV_BASE}/v2/transactions/tx-abc`, () =>
        HttpResponse.json({ transactionId: 'tx-abc', status: 'Authorized' }),
      ),
    );
    const flute = makeFlute();
    const tx = await flute.transactions.retrieve('tx-abc');
    expect(tx.transactionId).toBe('tx-abc');
  });

  it('sale() POSTs to /v2/transactions and forces captureMethod=Auto', async () => {
    let captured: unknown = undefined;
    server.use(
      http.post(`${ISV_BASE}/v2/transactions`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({
          transactionId: 'tx_new',
          transactionStatus: 'Approved',
          processedAmount: 50,
        });
      }),
    );
    const flute = makeFlute();
    const result = await flute.transactions.sale({
      baseAmount: 50,
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
    expect(result.transactionId).toBe('tx_new');
    const body = captured as { transactionDetails: { cardData: { captureMethod: string } } };
    expect(body.transactionDetails.cardData.captureMethod).toBe('Auto');
  });

  it('authorize() forces captureMethod=Manual', async () => {
    let captured: unknown = undefined;
    server.use(
      http.post(`${ISV_BASE}/v2/transactions`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ transactionId: 'tx_auth' });
      }),
    );
    const flute = makeFlute();
    await flute.transactions.authorize({
      baseAmount: 50,
      transactionDetails: {
        cardData: {
          paymentMethodDetails: {
            cardNumber: '4111111111111111',
            expirationMonth: 12,
            expirationYear: 2030,
          },
        },
      },
    });
    const body = captured as { transactionDetails: { cardData: { captureMethod: string } } };
    expect(body.transactionDetails.cardData.captureMethod).toBe('Manual');
  });

  it('capture() POSTs to /capture with the optional amount', async () => {
    let receivedAmount: number | undefined;
    server.use(
      http.post(`${ISV_BASE}/v2/transactions/tx_1/capture`, async ({ request }) => {
        const body = (await request.json()) as { amount?: number };
        receivedAmount = body.amount;
        return HttpResponse.json({ transactionId: 'tx_1', transactionStatus: 'Approved' });
      }),
    );
    const flute = makeFlute();
    await flute.transactions.capture('tx_1', { amount: 25 });
    expect(receivedAmount).toBe(25);
  });

  it('void() POSTs to /reversal with an empty body', async () => {
    server.use(
      http.post(`${ISV_BASE}/v2/transactions/tx_1/reversal`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(Object.keys(body)).toHaveLength(0);
        return HttpResponse.json({ transactionId: 'tx_1', transactionStatus: 'Approved' });
      }),
    );
    const flute = makeFlute();
    await flute.transactions.void('tx_1');
  });

  it('refund() POSTs to /reversal with the optional amount', async () => {
    let receivedAmount: number | undefined;
    server.use(
      http.post(`${ISV_BASE}/v2/transactions/tx_1/reversal`, async ({ request }) => {
        const body = (await request.json()) as { amount?: number };
        receivedAmount = body.amount;
        return HttpResponse.json({ transactionId: 'tx_1' });
      }),
    );
    const flute = makeFlute();
    await flute.transactions.refund('tx_1', { amount: 10 });
    expect(receivedAmount).toBe(10);
  });

  it('calculateAmount() GETs /calculate-amount and forwards query params', async () => {
    server.use(
      http.get(`${ISV_BASE}/v2/transactions/calculate-amount`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('baseAmount')).toBe('100');
        expect(url.searchParams.get('tipRate')).toBe('0.15');
        return HttpResponse.json({
          currencyCode: 'USD',
          creditCard: { totalAmount: 115 },
        });
      }),
    );
    const flute = makeFlute();
    const result = await flute.transactions.calculateAmount({
      baseAmount: 100,
      tipRate: 0.15,
    });
    expect(result.creditCard?.totalAmount).toBe(115);
  });

  it('rejects empty ids early', async () => {
    const flute = makeFlute();
    await expect(flute.transactions.retrieve('')).rejects.toThrow(/transactionId/);
    await expect(flute.transactions.capture('')).rejects.toThrow(/transactionId/);
    await expect(flute.transactions.void('')).rejects.toThrow(/transactionId/);
    await expect(flute.transactions.refund('')).rejects.toThrow(/transactionId/);
  });
});

describe('PaymentSessionsResource', () => {
  it('create() POSTs and forwards the x-api-version header', async () => {
    server.use(
      http.post(`${PAY_INT_BASE}/payment-sessions`, async ({ request }) => {
        expect(request.headers.get('x-api-version')).toBe('1');
        const body = (await request.json()) as { amount: number; mode: number };
        expect(body.amount).toBe(64.99);
        expect(body.mode).toBe(2);
        return HttpResponse.json({ id: 'ps_1' });
      }),
    );
    const flute = makeFlute();
    const result = await flute.paymentSessions.create({
      amount: 64.99,
      mode: 'SaveMethod',
    });
    expect(result.id).toBe('ps_1');
  });

  it('create() supports numeric mode values', async () => {
    server.use(
      http.post(`${PAY_INT_BASE}/payment-sessions`, async ({ request }) => {
        const body = (await request.json()) as { mode: number };
        expect(body.mode).toBe(3);
        return HttpResponse.json({ id: 'ps_2' });
      }),
    );
    const flute = makeFlute();
    await flute.paymentSessions.create({ amount: 10, mode: 3 });
  });

  it('retrieve() returns the session record', async () => {
    server.use(
      http.get(`${PAY_INT_BASE}/payment-sessions/ps_1`, () =>
        HttpResponse.json({ statusId: 1, status: 'Created', mode: 1 }),
      ),
    );
    const flute = makeFlute();
    const session = await flute.paymentSessions.retrieve('ps_1');
    expect(session.statusId).toBe(1);
    expect(session.status).toBe('Created');
  });

  it('cancel() POSTs and resolves with no value', async () => {
    let called = false;
    server.use(
      http.post(`${PAY_INT_BASE}/payment-sessions/ps_1/cancel`, () => {
        called = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const flute = makeFlute();
    await flute.paymentSessions.cancel('ps_1');
    expect(called).toBe(true);
  });

  it('rejects invalid amounts and ids', async () => {
    const flute = makeFlute();
    await expect(flute.paymentSessions.create({ amount: Number.NaN })).rejects.toThrow(/amount/);
    await expect(flute.paymentSessions.retrieve('')).rejects.toThrow(/paymentSessionId/);
    await expect(flute.paymentSessions.cancel('')).rejects.toThrow(/paymentSessionId/);
  });
});
