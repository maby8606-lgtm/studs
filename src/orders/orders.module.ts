import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderTimeoutService } from './order-timeout.service';
import { Order } from '../entities/order.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Vendor } from '../entities/vendor.entity';
import { RiderShift } from '../entities/rider-shift.entity';
import { DeliveryCode } from '../entities/delivery-code.entity';
import { WalletModule } from '../wallet/wallet.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FraudModule } from '../fraud/fraud.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, MenuItem, OrderItem, Vendor, RiderShift, DeliveryCode]),
    WalletModule,
    SubscriptionsModule,
    NotificationsModule,
    FraudModule,
    IdempotencyModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderTimeoutService],
  exports: [OrdersService],
})
export class OrdersModule {}
