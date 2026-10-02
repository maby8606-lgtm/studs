import { Injectable } from '@nestjs/common';
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
  WebhookEventKind,
} from './payment-provider.interface';

/**
 * Deterministic fake gateway for automated tests and local development.
 * Mirrors the REAL money flow (initiate -> out-of-band confirmation ->
 * verified webhook -> ledger credit) without touching any network.
 *
 * Tests drive outcomes explicitly via setChargeOutcome / setTransferOutcome
 * and build signed webhook requests with signWebhook(), so the suite
 * exercises the genuine verification + idempotency path.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly webhookSignatureHeader = 'x-fake-signature';

  private charges = new Map<string, { status: 'SUCCESS' | 'PENDING' | 'FAILED'; amountMinor: number; currency: string }>();
  private transfers = new Map<string, { status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED'; amountMinor: number }>();

  constructor(private readonly webhookSecret = 'fake-webhook-secret-for-tests') {}

  // ---------- test controls (not part of the interface) ----------

  setChargeOutcome(reference: string, status: 'SUCCESS' | 'PENDING' | 'FAILED', amountMinor: number, currency = 'GHS') {
    this.charges.set(reference, { status, amountMinor, currency });
  }

  setTransferOutcome(transferCode: string, status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED', amountMinor: number) {
    this.transfers.set(transferCode, { status, amountMinor });
  }

  /** Build a correctly-signed webhook request body for tests. */
  signWebhook(event: {
    kind: WebhookEventKind;
    reference: string;
    transferCode?: string;
    amountMinor?: number;
    currency?: string;
    eventId?: string;
    rawEvent?: string;
  }): { body: Buffer; signature: string } {
    const body = Buffer.from(JSON.stringify(event), 'utf8');
    const signature = crypto.createHmac('sha256', this.webhookSecret).update(body).digest('hex');
    return { body, signature };
  }

  // ---------- PaymentProvider ----------

  async initiateTopUp(params: InitiateTopUpParams): Promise<InitiateTopUpResult> {
    // Test hook: FAKE_PROVIDER_CHARGE_STATUS=success|failed forces the
    // authoritative charge outcome (used to test reconciliation).
    const forced = process.env.FAKE_PROVIDER_CHARGE_STATUS;
    const outcome = forced === 'SUCCESS' || forced === 'FAILED' ? forced : 'PENDING';
    this.charges.set(params.reference, { status: outcome, amountMinor: params.amountMinor, currency: params.currency });
    return {
      providerReference: params.reference,
      providerStatus: 'pay_offline',
      authorizationUrl: `https://fake-gateway.local/pay/${params.reference}`,
      displayNote: 'Fake gateway: confirm via test webhook.',
    };
  }

  async submitTopUpOtp(reference: string, otp: string): Promise<{ status: 'PENDING' | 'SUCCESS' | 'FAILED' }> {
    const c = this.charges.get(reference);
    if (!c) return { status: 'FAILED' };
    if (!/^\d{4,8}$/.test(otp)) return { status: 'PENDING' };
    c.status = 'SUCCESS';
    return { status: 'SUCCESS' };
  }

  async initiateTransfer(params: InitiateTransferParams): Promise<InitiateTransferResult> {
    const transferCode = `TRF_fake_${params.reference}`;
    // Test hook: FAKE_PROVIDER_TRANSFER_STATUS=success|failed forces the
    // authoritative transfer outcome (used to test reconciliation).
    const forced = process.env.FAKE_PROVIDER_TRANSFER_STATUS;
    const outcome = forced === 'SUCCESS' ? 'SUCCESS' : forced === 'FAILED' ? 'FAILED' : 'PENDING';
    this.transfers.set(transferCode, { status: outcome, amountMinor: params.amountMinor });
    return { transferCode, status: outcome };
  }

  async verifyCharge(reference: string): Promise<VerifiedCharge> {
    const c = this.charges.get(reference);
    if (!c) return { providerReference: reference, amountMinor: 0, currency: 'GHS', status: 'FAILED' };
    return { providerReference: reference, amountMinor: c.amountMinor, currency: c.currency, status: c.status };
  }

  async verifyTransfer(transferCode: string): Promise<VerifiedTransfer> {
    const t = this.transfers.get(transferCode);
    if (!t) return { transferCode, status: 'FAILED' };
    return { transferCode, status: t.status, amountMinor: t.amountMinor };
  }

  async verifyTransferByReference(reference: string): Promise<VerifiedTransfer> {
    // Fake transfer codes are derived from the reference at initiation.
    return this.verifyTransfer(`TRF_fake_${reference}`);
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedWebhookEvent | null {
    try {
      if (!signature || !rawBody?.length) return null;
      const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

      const payload = JSON.parse(rawBody.toString('utf8'));
      const kind: WebhookEventKind = payload?.kind;
      const reference: string = payload?.reference;
      if (
        !['CHARGE_SUCCESS', 'CHARGE_FAILED', 'TRANSFER_SUCCESS', 'TRANSFER_FAILED', 'TRANSFER_REVERSED', 'UNKNOWN'].includes(kind) ||
        typeof reference !== 'string' ||
        reference.length === 0
      ) {
        return null;
      }
      return {
        kind,
        eventId: typeof payload.eventId === 'string' ? payload.eventId : undefined,
        rawEvent: typeof payload.rawEvent === 'string' ? payload.rawEvent : kind,
        reference,
        transferCode: typeof payload.transferCode === 'string' ? payload.transferCode : undefined,
        amountMinor: Number.isInteger(payload.amountMinor) ? payload.amountMinor : undefined,
        currency: typeof payload.currency === 'string' ? payload.currency : undefined,
      };
    } catch {
      return null; // never throw on attacker-controlled input
    }
  }
}
