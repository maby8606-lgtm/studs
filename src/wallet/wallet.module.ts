import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './wallet.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { WalletService } from './wallet.service';
import { PayoutScheduler } from './payout.scheduler';
import { PaymentsModule } from '../payments/payments.module';
import { User } from '../entities/user.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { Withdrawal } from '../entities/withdrawal.entity';
import { PaymentAttempt } from '../entities/payment-attempt.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { FraudModule } from '../fraud/fraud.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, WalletTransaction, Withdrawal, PaymentAttempt, WebhookEvent]),
    PaymentsModule,
    FraudModule,
    IdempotencyModule,
  ],
  controllers: [WalletController, PaymentsWebhookController],
  providers: [WalletService, PayoutScheduler],
  exports: [WalletService],
})
export class WalletModule {}
