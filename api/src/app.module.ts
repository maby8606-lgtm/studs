import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { WalletModule } from './wallet/wallet.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [AuthModule, WalletModule, OrdersModule],
  controllers: [AppController],
})
export class AppModule {}
