import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyRecord } from '../../entities/idempotency-record.entity';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord])],
  providers: [IdempotencyInterceptor],
  exports: [IdempotencyInterceptor, TypeOrmModule],
})
export class IdempotencyModule {}
