import { Injectable } from '@nestjs/common';

/**
 * In-memory sliding-window hit store for RateLimitGuard.
 *
 * Single-instance by design: STUDS runs as one API process (the same
 * assumption the ledger mutex makes). If the API is ever scaled out, this
 * store moves to Redis — the guard's interface would not change.
 */
@Injectable()
export class RateLimitStore {
  private hits = new Map<string, number[]>();

  /** Returns retry-after seconds when limited, or null when allowed. */
  hit(key: string, limit: number, windowSec: number): number | null {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const arr = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      const oldest = arr[0];
      return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    }
    arr.push(now);
    this.hits.set(key, arr);
    return null;
  }
}
