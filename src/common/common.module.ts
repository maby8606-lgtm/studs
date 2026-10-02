import { Global, Module } from '@nestjs/common';
import { LedgerMutex } from './ledger-mutex';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitStore } from './rate-limit.store';

/**
 * Global singletons that every module may inject without importing
 * anything explicitly: the ledger write mutex and the rate limiter.
 */
@Global()
@Module({
  providers: [LedgerMutex, RateLimitStore, RateLimitGuard],
  exports: [LedgerMutex, RateLimitStore, RateLimitGuard],
})
export class CommonModule {}
