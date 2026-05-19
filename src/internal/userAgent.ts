import { getVersion } from '../version.js';

/**
 * Build the `User-Agent` header value the SDK sends with every request.
 *
 * Pattern: `flute-sdk-typescript/<version> (node/<node-version>; <platform>) [suffix]`
 *
 * The `suffix` lets integrators identify their application in support
 * tickets (e.g.
 * `flute-sdk-typescript/1.2.3 (node/v20.18.0; darwin) acme-checkout/4.5`).
 *
 * @internal
 */
export function buildUserAgent(suffix: string | undefined): string {
  const base = `flute-sdk-typescript/${getVersion()}`;
  const runtime = `(node/${process.version}; ${process.platform})`;
  const tail = suffix !== undefined && suffix.length > 0 ? ` ${suffix}` : '';
  return `${base} ${runtime}${tail}`;
}
