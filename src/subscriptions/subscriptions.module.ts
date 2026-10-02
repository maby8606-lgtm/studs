import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { Subscription } from '../entities/subscription.entity';
import { WalletModule } from '../wallet/wallet.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription]), WalletModule, IdempotencyModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
