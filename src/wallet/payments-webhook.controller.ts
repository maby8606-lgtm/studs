import { Controller, Post, Param, Req, HttpCode, Inject, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment-provider.interface';
import { WalletService } from './wallet.service';

/**
 * Provider webhooks — PUBLIC route (no JWT).
 *
 * Authenticity comes from the HMAC signature over the exact raw request
 * body, verified inside the provider implementation. Consequences:
 * - Invalid signature ⇒ 401, ledger untouched.
 * - Duplicate/replayed delivery ⇒ 200, harmless (idempotency keys).
 * - Valid but unrecognized event ⇒ 200, no ledger action.
 *
 * Only the currently configured provider's name is accepted here.
 */
@Controller('payments')
export class PaymentsWebhookController {
  constructor(
    private walletService: WalletService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
  ) {}

  @Post('webhook/:provider')
  @HttpCode(200)
  async handleWebhook(@Param('provider') provider: string, @Req() req: Request) {
    if (provider !== this.provider.name) {
      throw new NotFoundException('Unknown payment provider');
    }
    const rawBody: Buffer = req.body as unknown as Buffer;
    const headerValue = req.headers[this.provider.webhookSignatureHeader];
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const result = await this.walletService.handleProviderWebhook(provider, rawBody, signature);
    if (result.reason === 'invalid-signature') {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return { received: true };
  }
}
