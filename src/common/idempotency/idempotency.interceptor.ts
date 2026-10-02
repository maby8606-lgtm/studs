import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { IdempotencyRecord } from '../../entities/idempotency-record.entity';

/**
 * Client-driven idempotency for money endpoints.
 *
 * The client sends `Idempotency-Key: <uuid>` with a money-moving POST:
 *  - first sight of the key: a PENDING row is inserted, the handler runs,
 *    and the exact response body is stored on the row;
 *  - replay of the key: the stored response is returned — no second charge;
 *  - same key arriving while the first is still executing: waits briefly for
 *    the original to finish, then replays it (or 409s if it never lands).
 *
 * Endpoints without a key header behave exactly as before.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly records: Repository<IdempotencyRecord>,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    if (req.method !== 'POST') return next.handle();
    const key = req.headers['idempotency-key'];
    const userId = req.user?.sub;
    if (!key || typeof key !== 'string' || key.length > 128 || !userId) return next.handle();

    const scope = `${req.method} ${(req.baseUrl || '') + (req.route?.path || req.path || '')}`;
    const res = ctx.switchToHttp().getResponse();

    return from(this.claim(userId, scope, key)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.setHeader('Idempotency-Replayed', 'true');
          return of(existing);
        }
        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.complete(userId, scope, key, body);
            },
            error: () => {
              void this.release(userId, scope, key);
            },
          }),
        );
      }),
    );
  }

  /** Returns the stored response body if this key already completed, else null (and claims the key). */
  private async claim(userId: string, scope: string, key: string): Promise<unknown | null> {
    const found = await this.records.findOne({ where: { userId, scope, key } });
    if (found?.status === 'COMPLETED' && found.responseBody) {
      try { return JSON.parse(found.responseBody); } catch { return null; }
    }
    if (found) return this.waitForCompletion(userId, scope, key);

    try {
      await this.records.save(this.records.create({ userId, scope, key, status: 'PENDING' }));
      return null;
    } catch {
      // Unique violation: a concurrent request claimed it first.
      return this.waitForCompletion(userId, scope, key);
    }
  }

  private async waitForCompletion(userId: string, scope: string, key: string): Promise<unknown> {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const rec = await this.records.findOne({ where: { userId, scope, key } });
      if (rec?.status === 'COMPLETED' && rec.responseBody) {
        try { return JSON.parse(rec.responseBody); } catch { break; }
      }
      if (!rec) break; // released after an error — let the caller retry fresh
    }
    throw new ConflictException('A request with this Idempotency-Key is still being processed. Retry in a moment.');
  }

  private async complete(userId: string, scope: string, key: string, body: unknown): Promise<void> {
    try {
      await this.records.update(
        { userId, scope, key },
        { status: 'COMPLETED', responseBody: JSON.stringify(body ?? {}) },
      );
    } catch { /* a lost completion record only costs replay protection */ }
  }

  private async release(userId: string, scope: string, key: string): Promise<void> {
    try {
      await this.records.delete({ userId, scope, key, status: 'PENDING' });
    } catch { /* best effort */ }
  }
}
