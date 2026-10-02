import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmsService } from './sms.service';
import { SmsMessage } from '../entities/sms-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SmsMessage])],
  providers: [SmsService],
  exports: [SmsService],
})
export class NotificationsModule {}
