/**
 * SDK package version. Replaced by tsup at build-time via `define`
 * with the value from `package.json`, so it stays in sync with whatever
 * was published to npm.
 *
 * In tests and direct source execution it falls back to `0.0.0-dev`.
 *
 * @public
 */
export function getVersion(): string {
  return SDK_VERSION;
}

const SDK_VERSION: string =
  typeof globalThis.__FLUTE_SDK_VERSION__ === 'string' &&
  globalThis.__FLUTE_SDK_VERSION__.length > 0
    ? globalThis.__FLUTE_SDK_VERSION__
    : '0.0.0-dev';

declare global {
  var __FLUTE_SDK_VERSION__: string | undefined;
}
