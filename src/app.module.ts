import { Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { WalletModule } from './wallet/wallet.module';
import { OrdersModule } from './orders/orders.module';
import { VendorsModule } from './vendors/vendors.module';
import { MenuItemsModule } from './menu-items/menu-items.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FraudModule } from './fraud/fraud.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

import { User } from './entities/user.entity';
import { Vendor } from './entities/vendor.entity';
import { MenuItem } from './entities/menu-item.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Withdrawal } from './entities/withdrawal.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { RiderShift } from './entities/rider-shift.entity';
import { Subscription } from './entities/subscription.entity';
import { DeliveryCode } from './entities/delivery-code.entity';
import { SmsMessage } from './entities/sms-message.entity';
import { FraudFlag } from './entities/fraud-flag.entity';
import { IdempotencyRecord } from './entities/idempotency-record.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappSession } from './entities/whatsapp-session.entity';

const ENTITIES = [
  User, Vendor, MenuItem, Order, OrderItem, WalletTransaction,
  Withdrawal, PaymentAttempt, WebhookEvent, RiderShift,
  Subscription, DeliveryCode, SmsMessage, FraudFlag, IdempotencyRecord,
  WhatsappMessage, WhatsappSession,
];

/**
 * Database selection (Master Doc §9 — PostgreSQL in production):
 * - DB_TYPE=sqlite (default): local file at DATABASE_PATH — tests & dev.
 * - DB_TYPE=postgres: DATABASE_URL (or PG* parts). Same entities, same
 *   synchronize behavior; only the dialect changes.
 */
function databaseOptions(): TypeOrmModuleOptions {
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
  if (dbType === 'postgres') {
    const url = process.env.DATABASE_URL;
    return {
      type: 'postgres',
      ...(url
        ? { url }
        : {
            host: process.env.PGHOST || 'localhost',
            port: Number(process.env.PGPORT) || 5432,
            username: process.env.PGUSER || 'studs',
            password: process.env.PGPASSWORD || '',
            database: process.env.PGDATABASE || 'studs',
          }),
      entities: ENTITIES,
      synchronize: true,
      logging: false,
    } as TypeOrmModuleOptions;
  }
  return {
    type: 'sqlite',
    database: process.env.DATABASE_PATH || 'studs.db',
    entities: ENTITIES,
    synchronize: true,
    logging: false,
  } as TypeOrmModuleOptions;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(databaseOptions()),
    CommonModule,
    AuthModule,
    WalletModule,
    OrdersModule,
    VendorsModule,
    MenuItemsModule,
    SubscriptionsModule,
    NotificationsModule,
    FraudModule,
    WhatsappModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
