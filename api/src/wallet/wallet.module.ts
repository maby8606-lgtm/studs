import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [WalletController],
})
export class WalletModule {}
