import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from './payment-provider.interface';
import { FakePaymentProvider } from './fake-payment.provider';
import { PaystackPaymentProvider } from './paystack-payment.provider';

/**
 * Selects the payment gateway implementation from PAYMENT_PROVIDER.
 * Everything else in the app depends only on the PaymentProvider interface,
 * so adding a new gateway = one new class + one line here.
 */
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentProvider => {
        const name = (config.get<string>('PAYMENT_PROVIDER') || 'paystack').toLowerCase();
        if (name === 'fake') {
          console.log('[PAYMENTS] using FakePaymentProvider (no real money moves)');
          return new FakePaymentProvider();
        }
        if (name === 'paystack') {
          return new PaystackPaymentProvider(config); // fails closed without a secret key
        }
        throw new Error(
          `Unknown PAYMENT_PROVIDER=${JSON.stringify(name)}. Expected 'paystack' or 'fake'.`,
        );
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
