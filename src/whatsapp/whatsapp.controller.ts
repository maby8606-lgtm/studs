import { Controller, Get, Post, Req, Query, Res, ForbiddenException, UseGuards } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * WhatsApp Cloud API webhook + client helpers.
 *
 * The webhook endpoints are public by necessity: Meta calls them without a
 * STUDS token. Their authentication is the verify-token handshake (GET) and
 * the X-Hub-Signature-256 HMAC over the exact raw body (POST), enforced
 * whenever WHATSAPP_APP_SECRET is set. Rate limiting: Meta retries
 * deliveries, so a dropped message is retried rather than lost — the flow
 * never invents behavior the provider didn't send.
 */
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /** Meta's webhook verification handshake. */
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: any,
  ) {
    const ok = this.whatsapp.verifyWebhook(mode, token, challenge);
    if (!ok) throw new ForbiddenException('Webhook verification failed');
    return res.status(200).send(ok);
  }

  /** Inbound message webhook (Meta Cloud API shape). Always returns 200. */
  @Post('webhook')
  async inbound(@Req() req: any) {
    const rawBody: Buffer = req.body as unknown as Buffer;
    const signature = req.headers?.['x-hub-signature-256'];
    if (!this.whatsapp.signatureValid(rawBody, signature)) {
      // Reject loudly: a bad signature means someone is spoofing Meta.
      throw new ForbiddenException('Invalid webhook signature');
    }
    let payload: any = {};
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { received: true };
    }
    try {
      const entries = payload?.entry || [];
      for (const entry of entries) {
        for (const change of entry?.changes || []) {
          const value = change?.value || {};
          for (const message of value?.messages || []) {
            const phone = message?.from;
            const text = message?.text?.body;
            if (phone && typeof text === 'string') {
              await this.whatsapp.handleInbound(phone, text);
            }
          }
        }
      }
    } catch (err) {
      console.error('[WHATSAPP] inbound handling failed:', (err as Error).message);
    }
    return { received: true };
  }

  /** Deep link for the app's "Order on WhatsApp" buttons. */
  @Get('deeplink')
  @UseGuards(JwtAuthGuard)
  deeplink() {
    return this.whatsapp.deeplink();
  }

  /** Admin: read a customer's WhatsApp conversation thread. */
  @Get('admin/messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  conversation(@Query('phone') phone: string) {
    if (!phone) throw new ForbiddenException('phone is required');
    return this.whatsapp.conversation(phone);
  }
}
