import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  PaymentProvider,
  InitiateTopUpParams,
  InitiateTopUpResult,
  InitiateTransferParams,
  InitiateTransferResult,
  VerifiedCharge,
  VerifiedTransfer,
  NormalizedWebhookEvent,
  MomoNetwork,
  WebhookEventKind,
} from './payment-provider.interface';

/**
 * Paystack gateway (Ghana mobile money), TEST mode by default.
 *
 * Collection: POST /charge with mobile_money {phone, provider} — a direct
 * MoMo charge. MTN/AirtelTigo return `pay_offline` (customer approves the
 * prompt on their phone within ~180s); Telecel returns `send_otp`.
 * The wallet is credited only on a signature-verified `charge.success`
 * webhook (or a verified /transaction/verify poll) — never at initiation.
 *
 * Payouts: transfer recipient (type mobile_money, bank code resolved from
 * GET /bank at runtime) → POST /transfer with OUR idempotency reference →
 * `transfer.success` / `transfer.failed` / `transfer.reversed` webhooks.
 *
 * Fails closed: no secret key ⇒ throws at startup; a LIVE key without
 * PAYSTACK_ALLOW_LIVE=true ⇒ refuses to boot.
 */

/** Charge-side provider codes, per the official Paystack Charge API enum. */
const CHARGE_PROVIDER_CODES: Record<MomoNetwork, string> = {
  MTN: 'mtn',
  VODAFONE: 'vod', // Vodafone Ghana is now Telecel; code per official enum
  AIRTEL_TIGO: 'atl', // official enum value (some guides say 'tgo' — verify in test mode)
};

interface BankEntry {
  name: string;
  code: string;
}

export class PaystackPaymentProvider implements PaymentProvider {
  readonly name = 'paystack';
  readonly webhookSignatureHeader = 'x-paystack-signature';

  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly expectedDomain: 'test' | 'live';
  private bankListCache: BankEntry[] | null = null;

  constructor(config: ConfigService) {
    const secret = config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new Error(
        'PAYSTACK_SECRET_KEY is not set. Copy .env.example to .env and add your Paystack TEST secret key. ' +
          'Refusing to boot the payment provider without credentials.',
      );
    }
    this.secretKey = secret;
    this.baseUrl = config.get<string>('PAYSTACK_BASE_URL') || 'https://api.paystack.co';
    const isLive = secret.startsWith('sk_live_');
    this.expectedDomain = isLive ? 'live' : 'test';
    if (isLive && config.get<string>('PAYSTACK_ALLOW_LIVE') !== 'true') {
      throw new Error(
        'A LIVE Paystack key was supplied but PAYSTACK_ALLOW_LIVE is not "true". ' +
          'Refusing to move real money without explicit opt-in.',
      );
    }
    console.log(`[PAYMENTS] Paystack provider configured (domain=${this.expectedDomain})`);
  }

  // ---------- collection ----------

  async initiateTopUp(params: InitiateTopUpParams): Promise<InitiateTopUpResult> {
    if (!params.network) {
      throw new Error('A MoMo network is required for Paystack top-ups');
    }
    const providerCode = CHARGE_PROVIDER_CODES[params.network];
    const data = await this.request('POST', '/charge', {
      amount: params.amountMinor,
      email: params.email,
      currency: params.currency,
      reference: params.reference,
      mobile_money: { phone: params.momoNumber, provider: providerCode },
      metadata: JSON.stringify({ userId: params.userId, attemptRef: params.reference, ...(params.metadata || {}) }),
    });
    // data: { reference, status, display_text, ... }
    const status: string = data?.status;
    if (status === 'failed' || status === 'timeout') {
      throw new Error(data?.display_text || data?.message || 'MoMo charge failed at initiation');
    }
    return {
      providerReference: data?.reference || params.reference,
      providerStatus: status,
      displayNote: data?.display_text || 'Approve the MoMo prompt on your phone to complete payment.',
    };
  }

  async submitTopUpOtp(reference: string, otp: string): Promise<{ status: 'PENDING' | 'SUCCESS' | 'FAILED' }> {
    const data = await this.request('POST', '/charge/submit_otp', { otp, reference });
    const status: string = data?.status;
    if (status === 'success') return { status: 'SUCCESS' };
    if (status === 'failed') return { status: 'FAILED' };
    return { status: 'PENDING' };
  }

  async verifyCharge(reference: string): Promise<VerifiedCharge> {
    const data = await this.request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    this.assertDomain(data);
    const status: string = data?.status;
    return {
      providerReference: data?.reference || reference,
      amountMinor: Number(data?.amount) || 0,
      currency: data?.currency || 'GHS',
      channel: data?.channel,
      status: status === 'success' ? 'SUCCESS' : status === 'failed' || status === 'abandoned' ? 'FAILED' : 'PENDING',
    };
  }

  // ---------- payouts ----------

  async initiateTransfer(params: InitiateTransferParams): Promise<InitiateTransferResult> {
    const recipientCode = await this.getOrCreateRecipient(params.momoNumber, params.network, params.accountName);
    const data = await this.request('POST', '/transfer', {
      source: 'balance',
      amount: params.amountMinor,
      recipient: recipientCode,
      reason: (params.narration || 'STUDS withdrawal').slice(0, 100),
      // Our idempotency key: Paystack rejects duplicate references, so a
      // retry after a timeout can never double-send.
      reference: params.reference,
      currency: params.currency,
    });
    // data: { transfer_code, status: 'pending' | 'otp' | 'success', reference }
    const transferCode: string = data?.transfer_code;
    if (!transferCode) {
      throw new Error('Paystack did not return a transfer_code');
    }
    if (data?.status === 'otp') {
      throw new Error(
        'Paystack requires OTP confirmation for transfers. Disable transfer OTP in the Paystack dashboard ' +
          '(Settings → Preferences) or implement transfer finalization.',
      );
    }
    return {
      transferCode,
      status: data?.status === 'success' ? 'SUCCESS' : 'PENDING',
    };
  }

  async verifyTransfer(transferCode: string): Promise<VerifiedTransfer> {
    // Verify by our reference where possible; fall back to fetching by code.
    const data = await this.request('GET', `/transfer/${encodeURIComponent(transferCode)}`);
    return this.toVerifiedTransfer(data, transferCode);
  }

  async verifyTransferByReference(reference: string): Promise<VerifiedTransfer> {
    const data = await this.request('GET', `/transfer/verify/${encodeURIComponent(reference)}`);
    return this.toVerifiedTransfer(data, '');
  }

  private toVerifiedTransfer(data: any, fallbackCode: string): VerifiedTransfer {
    const status: string = data?.status;
    return {
      transferCode: data?.transfer_code || fallbackCode,
      amountMinor: Number(data?.amount) || undefined,
      reference: data?.reference,
      status:
        status === 'success'
          ? 'SUCCESS'
          : status === 'failed'
            ? 'FAILED'
            : status === 'reversed'
              ? 'REVERSED'
              : 'PENDING',
    };
  }

  // ---------- webhooks ----------

  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedWebhookEvent | null {
    try {
      if (!signature || !rawBody?.length) return null;
      const expected = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

      const payload = JSON.parse(rawBody.toString('utf8'));
      const rawEvent: string = payload?.event;
      const eventId: string | undefined = typeof payload?.id === 'string' ? payload.id : undefined;
      const data = payload?.data || {};

      // Reject events from the wrong domain (test event against live config).
      if (data?.domain && data.domain !== this.expectedDomain) return null;

      const kindMap: Record<string, WebhookEventKind> = {
        'charge.success': 'CHARGE_SUCCESS',
        'charge.failed': 'CHARGE_FAILED',
        'transfer.success': 'TRANSFER_SUCCESS',
        'transfer.failed': 'TRANSFER_FAILED',
        'transfer.reversed': 'TRANSFER_REVERSED',
      };
      const kind: WebhookEventKind = kindMap[rawEvent] || 'UNKNOWN';
      const reference: string = data?.reference;
      if (typeof reference !== 'string' || reference.length === 0) return null;

      const amountMinor = Number.isInteger(data?.amount) ? data.amount : undefined;
      return {
        kind,
        eventId,
        rawEvent,
        reference,
        transferCode: typeof data?.transfer_code === 'string' ? data.transfer_code : undefined,
        amountMinor,
        currency: typeof data?.currency === 'string' ? data.currency : undefined,
      };
    } catch {
      return null; // never throw on attacker-controlled input
    }
  }

  // ---------- internals ----------

  private assertDomain(data: any) {
    if (data?.domain && data.domain !== this.expectedDomain) {
      throw new Error(`Paystack domain mismatch: expected ${this.expectedDomain}, got ${data.domain}`);
    }
  }

  /** Minimal JSON client for the Paystack REST API. Throws on any failure. */
  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      throw new Error(`Paystack request failed (${method} ${path}): ${err instanceof Error ? err.message : err}`);
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Paystack returned non-JSON (${res.status}) for ${method} ${path}`);
    }
    if (!res.ok || json?.status === false) {
      const msg = json?.message || `HTTP ${res.status}`;
      throw new Error(`Paystack error (${method} ${path}): ${msg}`);
    }
    return json?.data;
  }

  /**
   * Transfer-recipient bank codes are NOT hardcoded: they are resolved from
   * GET /bank at runtime and cached. A duplicate account_number returns the
   * existing recipient (Paystack-side idempotency).
   */
  private async getOrCreateRecipient(momoNumber: string, network?: MomoNetwork, accountName?: string): Promise<string> {
    const bankCode = await this.resolveBankCode(network);
    const data = await this.request('POST', '/transferrecipient', {
      type: 'mobile_money',
      // The account holder's real name — never a phone-derived synthetic.
      name: (accountName || 'STUDS customer').slice(0, 100),
      account_number: momoNumber,
      bank_code: bankCode,
      currency: 'GHS',
    });
    const recipientCode: string = data?.recipient_code;
    if (!recipientCode) throw new Error('Paystack did not return a recipient_code');
    return recipientCode;
  }

  private async resolveBankCode(network?: MomoNetwork): Promise<string> {
    if (!this.bankListCache) {
      const data = await this.request('GET', '/bank?country=ghana&type=mobile_money');
      const list: BankEntry[] = Array.isArray(data) ? data : [];
      if (list.length === 0) throw new Error('Paystack returned an empty Ghana mobile_money bank list');
      this.bankListCache = list;
    }
    const needles: Record<MomoNetwork, string[]> = {
      MTN: ['mtn'],
      VODAFONE: ['vodafone', 'telecel', 'vod'],
      AIRTEL_TIGO: ['airteltigo', 'airtel tigo', 'at ', 'tigo'],
    };
    const keys = network ? needles[network] : [];
    for (const entry of this.bankListCache) {
      const hay = `${entry.name || ''} ${entry.code || ''}`.toLowerCase();
      if (keys.some((k) => hay.includes(k))) return entry.code;
    }
    const available = this.bankListCache.map((e) => `${e.name} (${e.code})`).join(', ');
    throw new Error(
      `Could not resolve a Paystack bank code for network ${network || '?'}. Available: ${available}`,
    );
  }
}
