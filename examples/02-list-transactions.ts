/**
 * Example: paginating transactions and printing a small summary.
 *
 * Run with:
 *
 *     FLUTE_CLIENT_ID=... FLUTE_CLIENT_SECRET=... \
 *     npx tsx examples/02-list-transactions.ts
 *
 * Optional env knobs:
 *
 *     FLUTE_ENVIRONMENT=sandbox|production       # default: sandbox
 *     FLUTE_TX_PAGE_SIZE=50                       # default: 25
 *     FLUTE_TX_MAX_PAGES=4                        # safety cap; default: 4
 */

import { Environment, Flute } from '../src/index.js';

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
    environment:
      process.env['FLUTE_ENVIRONMENT'] === 'production'
        ? Environment.Production
        : Environment.Sandbox,
    userAgentSuffix: 'flute-sdk-list-example/1.0',
  });

  const pageSize = Number(process.env['FLUTE_TX_PAGE_SIZE'] ?? '25');
  const maxPages = Number(process.env['FLUTE_TX_MAX_PAGES'] ?? '4');

  let pagesVisited = 0;
  let total = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await flute.transactions.list({ page, pageSize });
    pagesVisited += 1;
    total += response.items.length;

    console.log(
      `page ${String(page)}: ${String(response.items.length)} txns ` +
        `(running total: ${String(total)} / ${String(response.total)} server-side)`,
    );
    for (const tx of response.items) {
      console.log(
        '  ',
        tx.transactionId ?? '(no id)',
        tx.status ?? '—',
        '·',
        tx.transactionDateTime ?? '—',
      );
    }

    if (response.items.length < pageSize) break;
    if (total >= response.total) break;
  }

  console.log(
    `\nDone. Visited ${String(pagesVisited)} pages, ${String(total)} transactions printed.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
