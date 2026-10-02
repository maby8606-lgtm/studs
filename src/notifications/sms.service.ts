import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmsMessage } from '../entities/sms-message.entity';

/**
 * SMS provider — same provider-neutral pattern as payments, so the gateway
 * can be swapped without touching order logic.
 *
 * - `log` (default): no gateway configured. Messages are recorded in the
 *   sms_message outbox and logged. Honest dev/offline behavior: nothing is
 *   actually transmitted, and the outbox row says so (status LOGGED).
 * - `arkesel`: Arkesel SMS API v2 (Ghana). Requires ARKESEL_API_KEY and
 *   ARKESEL_SENDER_ID. Implemented to the published API; it activates the
 *   moment real keys are placed in .env.
 */
export interface SmsSendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

@Injectable()
export class SmsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(SmsMessage)
    private readonly smsRepository: Repository<SmsMessage>,
  ) {}

  private get providerName(): string {
    return (this.config.get<string>('SMS_PROVIDER') || 'log').toLowerCase();
  }

  async sendSms(phone: string, message: string): Promise<SmsSendResult> {
    const provider = this.providerName;
    let result: SmsSendResult;
    let status: SmsMessage['status'] = 'LOGGED';

    if (provider === 'arkesel') {
      result = await this.sendViaArkesel(phone, message);
      status = result.ok ? 'SENT' : 'FAILED';
    } else {
      console.log(`[SMS:log] to=${phone} msg="${message}"`);
      result = { ok: true, providerRef: 'log-only' };
      status = 'LOGGED';
    }

    await this.smsRepository.save(
      this.smsRepository.create({
        phone,
        message,
        provider,
        status,
        providerRef: result.providerRef || null,
      }),
    );
    return result;
  }

  private async sendViaArkesel(phone: string, message: string): Promise<SmsSendResult> {
    const apiKey = this.config.get<string>('ARKESEL_API_KEY');
    const sender = this.config.get<string>('ARKESEL_SENDER_ID') || 'STUDS';
    if (!apiKey) {
      return { ok: false, error: 'ARKESEL_API_KEY not configured' };
    }
    try {
      const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, message, recipients: [phone] }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body?.status === 'error') {
        return { ok: false, error: body?.message || `Arkesel HTTP ${res.status}` };
      }
      return { ok: true, providerRef: body?.data?.id || body?.id || 'arkesel' };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
