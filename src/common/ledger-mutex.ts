/**
 * LedgerMutex — serializes ledger-mutating work across the process.
 *
 * Why this exists: the sqlite driver funnels every query through a single
 * underlying connection. When two `dataSource.transaction()` calls interleave
 * (e.g. five concurrent provider webhooks), TypeORM's per-runner SAVEPOINT
 * bookkeeping corrupts on the shared connection — producing
 * `no such savepoint`, `cannot start a transaction within a transaction`,
 * and even `SAVEPOINT typeorm_-1` (a poisoned depth counter that breaks
 * later, unrelated transactions). The database's own uniqueness constraints
 * still guard double-spend, but they can't un-poison the connection.
 *
 * The mutex makes concurrent mutators queue instead of interleave. It is
 * applied at PUBLIC service entry points only — never re-enter it from a
 * private helper or it will deadlock. On Postgres the row locks already do
 * the real isolation; the mutex is harmless belt-and-braces there.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class LedgerMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((res) => {
      release = res;
    });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
