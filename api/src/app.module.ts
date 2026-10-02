import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { OrdersModule } from './orders/orders.module';
import { VendorsModule } from './vendors/vendors.module';
import { MenuItemsModule } from './menu-items/menu-items.module';

import { User } from './entities/user.entity';
import { Vendor } from './entities/vendor.entity';
import { MenuItem } from './entities/menu-item.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'studs.db',
      entities: [User, Vendor, MenuItem, Order, OrderItem],  // ← All entities included
      synchronize: true,
      logging: true,
    }),
    JwtModule.register({
      secret: 'your-super-secret-jwt-key-change-in-production',
      signOptions: { expiresIn: '24h' },
    }),
    AuthModule,
    WalletModule,
    OrdersModule,
    VendorsModule,
    MenuItemsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}