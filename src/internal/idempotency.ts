import { randomUUID } from 'node:crypto';

/**
 * Generate a fresh idempotency key.
 *
 * Format: `flute_<uuidv4>`. The prefix is a marker so support engineers
 * can spot SDK-generated keys at a glance. Callers may pass their own
 * key via the `idempotencyKey` per-request override.
 *
 * @internal
 */
export function generateIdempotencyKey(): string {
  return `flute_${randomUUID()}`;
}

/**
 * HTTP methods that should always carry an idempotency key when the
 * caller did not provide one. Matches the documented contract for the
 * Flute API: every state-changing request is idempotent on the
 * `Idempotency-Key` header.
 *
 * @internal
 */
export const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
