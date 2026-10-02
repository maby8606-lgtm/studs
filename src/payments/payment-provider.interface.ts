/**
 * Provider-neutral payment abstraction (Master Doc §4 — Financial Integrity).
 *
 * All real-money movement goes through this interface. The rest of the
 * codebase (WalletService, webhooks, admin flows) only ever talks to
 * `PaymentProvider`, so swapping Paystack for another gateway means writing
 * one new class — never touching money logic.
 *
 * Money invariants enforced by callers, not providers:
 * - A top-up credits the immutable ledger ONLY after a verified provider
 *   webhook (or verified status poll) confirms the money actually moved.
 * - Client callbacks / frontend redirects NEVER credit balances.
 * - Amounts are integer minor units (pesewas for GHS) end to end.
 */

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

/** Lifecycle of a customer top-up attempt. */
export type TopUpStatus = 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

/** Lifecycle of a provider payout transfer. */
export type TransferStatus = 'NOT_SENT' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';

/** Provider-neutral MoMo network names. Each implementation maps these to
 *  the gateway's own network/bank codes. */
export type MomoNetwork = 'MTN' | 'VODAFONE' | 'AIRTEL_TIGO';

export interface InitiateTopUpParams {
  /** Integer minor units, e.g. pesewas. */
  amountMinor: number;
  currency: string; // 'GHS'
  userId: string;
  email?: string;
  /** Customer's MoMo number (provider-neutral; gateways that need it use it). */
  momoNumber: string;
  /** Our unique reference — passed to the provider so webhooks can be
   *  matched back to the stored attempt. Also the idempotency key. */
  reference: string;
  /** Provider-neutral network hint, if the customer picked one. */
  network?: MomoNetwork;
  metadata?: Record<string, string>;
}

export interface InitiateTopUpResult {
  /** The reference the provider will echo back in webhooks. */
  providerReference: string;
  /** Raw provider charge status, e.g. 'pay_offline' / 'send_otp'. */
  providerStatus?: string;
  /** Hosted checkout / authorization URL, when the provider flow needs one. */
  authorizationUrl?: string;
  accessCode?: string;
  /** Human-readable next step, e.g. "Approve the prompt on your phone". */
  displayNote?: string;
}

export interface InitiateTransferParams {
  amountMinor: number;
  currency: string;
  momoNumber: string;
  network?: MomoNetwork;
  /** Our unique reference / idempotency key for this payout. */
  reference: string;
  narration?: string;
  /** Account holder's real name, for the provider's recipient record. */
  accountName?: string;
}

export interface InitiateTransferResult {
  /** Provider's transfer identifier, used for status polls + reconciliation. */
  transferCode: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
}

export interface VerifiedCharge {
  providerReference: string;
  amountMinor: number;
  currency: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  channel?: string;
}

export interface VerifiedTransfer {
  transferCode: string;
  status: TransferStatus;
  amountMinor?: number;
  /** Our idempotency reference, when the provider reports it back. */
  reference?: string;
}

export type WebhookEventKind =
  | 'CHARGE_SUCCESS'
  | 'CHARGE_FAILED'
  | 'TRANSFER_SUCCESS'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_REVERSED'
  | 'UNKNOWN';

/** Normalized provider webhook event. `parseWebhook` returns null when the
 *  signature is invalid or the payload is unparseable — callers treat that
 *  as "reject, do nothing". */
export interface NormalizedWebhookEvent {
  kind: WebhookEventKind;
  /** Provider event id for idempotency, when the gateway supplies one. */
  eventId?: string;
  /** Raw event name, e.g. 'charge.success' — kept for audit. */
  rawEvent: string;
  /** Charge reference or transfer code, depending on kind. */
  reference: string;
  /**
   * Gateway's own transfer identifier for transfer events (when different
   * from `reference`, e.g. we matched on our own idempotency reference).
   * Lets the ledger backfill the provider transfer code.
   */
  transferCode?: string;
  amountMinor?: number;
  currency?: string;
}

export interface PaymentProvider {
  readonly name: string;

  /** Request header carrying the webhook signature (e.g. 'x-paystack-signature'). */
  readonly webhookSignatureHeader: string;

  /** Start a customer top-up. Creates NO ledger entry. */
  initiateTopUp(params: InitiateTopUpParams): Promise<InitiateTopUpResult>;

  /**
   * Submit the OTP/voucher for a top-up that requires it (e.g. Telecel
   * MoMo). Returns the resulting charge status. Crediting still happens
   * only via webhook / reconciliation — never here.
   */
  submitTopUpOtp(reference: string, otp: string): Promise<{ status: 'PENDING' | 'SUCCESS' | 'FAILED' }>;

  /** Start a payout to a customer's MoMo number. Sends real money — callers
   *  must have reserved the funds and recorded intent BEFORE calling. */
  initiateTransfer(params: InitiateTransferParams): Promise<InitiateTransferResult>;

  /** Authoritative charge status, for reconciliation of stuck attempts. */
  verifyCharge(reference: string): Promise<VerifiedCharge>;

  /** Authoritative transfer status, for reconciliation of stuck payouts. */
  verifyTransfer(transferCode: string): Promise<VerifiedTransfer>;

  /**
   * Same, looked up by OUR idempotency reference — used when a transfer
   * webhook arrives without the gateway's transfer code (or the initiation
   * response was lost to a timeout and we never learned the code).
   */
  verifyTransferByReference(reference: string): Promise<VerifiedTransfer>;

  /**
   * Verify the webhook signature against the RAW request body and normalize
   * the event. Returns null on invalid signature / unparseable payload.
   * Must never throw on attacker-controlled input.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): NormalizedWebhookEvent | null;
}
