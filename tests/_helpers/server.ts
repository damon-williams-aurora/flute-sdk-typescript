import { setupServer } from 'msw/node';
import { http, HttpResponse, type DefaultBodyType, type HttpHandler } from 'msw';

export { http, HttpResponse };
export type { DefaultBodyType, HttpHandler };

/**
 * Spin up an MSW server with the supplied handlers. Returns the server
 * so the caller can use `.use()` mid-test to override behaviour.
 *
 * @internal
 */
export function makeServer(handlers: HttpHandler[] = []): ReturnType<typeof setupServer> {
  const server = setupServer(...handlers);
  return server;
}
