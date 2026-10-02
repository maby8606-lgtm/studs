/**
 * Idempotency-Key config for money-moving POSTs.
 *
 * Generate ONE key when a submit starts and reuse it for that attempt's
 * retries: if the request was processed but the response got lost (flaky
 * campus network), the retry replays the original result instead of
 * charging twice. See IdempotencyInterceptor on the API.
 */
export function idemConfig(key?: string) {
  const k = key || (crypto?.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return { headers: { 'Idempotency-Key': k } };
}

export function newIdemKey(): string {
  return crypto?.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
