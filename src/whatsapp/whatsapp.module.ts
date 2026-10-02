import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappMessage } from '../entities/whatsapp-message.entity';
import { WhatsappSession } from '../entities/whatsapp-session.entity';
import { User } from '../entities/user.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { Vendor } from '../entities/vendor.entity';
import { Order } from '../entities/order.entity';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WhatsappMessage, WhatsappSession, User, MenuItem, Vendor, Order]),
    OrdersModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
