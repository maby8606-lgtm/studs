import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
  /**
   * Extra key material from the request body field (e.g. 'email' on login so
   * limits apply per account, not just per IP).
   */
  byBodyField?: string;
  /** Extra key material from a route param (e.g. 'id' to limit per order). */
  byParam?: string;
}

/** Per-route rate limit, enforced by RateLimitGuard. */
export const RateLimit = (limit: number, windowSec: number, extra?: Partial<RateLimitOptions>) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSec, ...extra } as RateLimitOptions);
