import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../entities/user.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { Withdrawal } from '../entities/withdrawal.entity';
import { PaymentAttempt } from '../entities/payment-attempt.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { LedgerMutex } from '../common/ledger-mutex';
import { FraudService } from '../fraud/fraud.service';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
  MomoNetwork,
  NormalizedWebhookEvent,
  InitiateTransferResult,
} from '../payments/payment-provider.interface';

export type TxReason =
  | 'TOPUP'
  | 'WITHDRAWAL'
  | 'WITHDRAWAL_REVERSAL'
  | 'ORDER_PAYMENT'
  | 'ORDER_REFUND'
  | 'RIDER_PAYOUT'
  | 'VENDOR_PAYOUT'
  | 'PLATFORM_COMMISSION'
  | 'VENDOR_PAYOUT_REVERSAL'
  | 'RIDER_PAYOUT_REVERSAL'
  | 'PLATFORM_COMMISSION_REVERSAL'
  | 'SUBSCRIPTION'
  | 'SUBSCRIPTION_REVENUE'
  | 'PLATFORM_DELIVERY_SUBSIDY'
  | 'PLATFORM_DELIVERY_SUBSIDY_REVERSAL';

const MAX_TOPUP_GHS = 100000;

const MOMO_NETWORKS = ['MTN', 'VODAFONE', 'AIRTEL_TIGO'] as const;

/** Internal account that accumulates platform commission. Never logs in. */
const PLATFORM_ACCOUNT_EMAIL = 'platform@studs.internal';

function assertPositiveAmount(amount: any, label = 'Amount') {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`${label} must be a positive number`);
  }
  return Math.round(n * 100) / 100; // normalize to 2dp
}

function assertNetwork(network: any): MomoNetwork | undefined {
  if (network === undefined || network === null || network === '') return undefined;
  const up = String(network).toUpperCase();
  if (!(MOMO_NETWORKS as readonly string[]).includes(up)) {
    throw new BadRequestException(`network must be one of: ${MOMO_NETWORKS.join(', ')}`);
  }
  return up as MomoNetwork;
}

/** Short, safe error text for logs/records. Never logs full provider payloads. */
function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 200);
}

/**
 * Mask a MoMo number for logs/notes: show only the last 3 digits.
 * Never log full phone numbers, OTPs, secrets, or raw webhook bodies.
 */
function maskMomo(momoNumber: string): string {
  const digits = String(momoNumber || '').replace(/\D/g, '');
  if (digits.length <= 3) return '***';
  return `***${digits.slice(-3)}`;
}

function isUniqueViolation(err: any): boolean {
  const code = err?.code || err?.errno;
  const message = String(err?.message || '');
  return (
    code === 'SQLITE_CONSTRAINT' ||
    code === '23505' ||
    message.includes('UNIQUE constraint failed') ||
    message.includes('duplicate key')
  );
}

/**
 * Real wallet ledger (Master Doc §4).
 * - Every movement of money is an immutable WalletTransaction row.
 * - The row insert and the User.balance cache update happen in ONE database
 *   transaction, so balance can never drift from the ledger.
 * - Top-ups credit ONLY after a verified provider webhook confirms money moved.
 * - Withdrawals: request (reserve) → admin approves (provider sends) →
 *   provider confirms (debit posted). Reservations are derived from the
 *   withdrawal rows themselves, so they can never drift.
 */
@Injectable()
export class WalletService {
  constructor(
    private dataSource: DataSource,
    private configService: ConfigService,
    @Inject(PAYMENT_PROVIDER)
    private provider: PaymentProvider,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(WalletTransaction)
    private txRepository: Repository<WalletTransaction>,
    @InjectRepository(Withdrawal)
    private withdrawalRepository: Repository<Withdrawal>,
    @InjectRepository(PaymentAttempt)
    private attemptRepository: Repository<PaymentAttempt>,
    @InjectRepository(WebhookEvent)
    private webhookEventRepository: Repository<WebhookEvent>,
    private ledgerMutex: LedgerMutex,
    private fraudService: FraudService,
  ) {}

  /**
   * Platform commission rate on the product total (Master Doc 10–20% model).
   * Configurable via PLATFORM_COMMISSION_RATE (e.g. 0.15 = 15%).
   * Fails closed on invalid config — money math must never silently misbehave.
   */
  getCommissionRate(): number {
    const raw = this.configService.get<string>('PLATFORM_COMMISSION_RATE');
    const rate = raw === undefined || raw === '' ? 0.15 : Number(raw);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(
        `Invalid PLATFORM_COMMISSION_RATE=${JSON.stringify(raw)}. Must be a decimal between 0 and 1 (e.g. 0.15 for 15%).`,
      );
    }
    return rate;
  }

  // ---------- reads ----------

  async getWallet(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const reserved = await this.reservedAmount(this.dataSource.manager, userId);
    const balance = Number(user.balance) || 0;
    return {
      balance,
      reserved: Math.round(reserved * 100) / 100,
      available: Math.round((balance - reserved) * 100) / 100,
      currency: 'GHS',
    };
  }

  async getTransactions(userId: string) {
    return this.txRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * Earnings summary, read from the immutable ledger (the source of truth)
   * rather than recomputed from orders: gross = payout credits, clawed back
   * = payout-reversal debits (settled-then-refunded deliveries). Works for
   * both vendors (VENDOR_PAYOUT) and riders (RIDER_PAYOUT) — a user is one
   * or the other, never both. Wallet figures come from the reservation-aware
   * balance, so the user always sees exactly what can be withdrawn now.
   */
  async getEarningsSummary(userId: string) {
    const [credits, debits] = await Promise.all([
      this.txRepository.find({
        where: [
          { userId, reason: 'VENDOR_PAYOUT', type: 'CREDIT' },
          { userId, reason: 'RIDER_PAYOUT', type: 'CREDIT' },
        ],
      }),
      this.txRepository.find({
        where: [
          { userId, reason: 'VENDOR_PAYOUT_REVERSAL', type: 'DEBIT' },
          { userId, reason: 'RIDER_PAYOUT_REVERSAL', type: 'DEBIT' },
        ],
      }),
    ]);
    const sum = (rows: typeof credits) =>
      Math.round(rows.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100;
    const grossEarned = sum(credits);
    const clawedBack = sum(debits);
    const w = await this.getWallet(userId);
    return {
      userId,
      payoutCount: credits.length,
      grossEarnedGHS: grossEarned.toFixed(2),
      clawedBackGHS: clawedBack.toFixed(2),
      netEarnedGHS: (Math.round((grossEarned - clawedBack) * 100) / 100).toFixed(2),
      walletBalanceGHS: w.balance.toFixed(2),
      reservedGHS: w.reserved.toFixed(2),
      availableToWithdrawGHS: w.available.toFixed(2),
      currency: 'GHS',
    };
  }

  /** Rider-flavoured view of the ledger earnings summary. */
  async getRiderEarningsSummary(riderId: string) {
    const s = await this.getEarningsSummary(riderId);
    return {
      riderId,
      completedDeliveries: s.payoutCount,
      grossEarnedGHS: s.grossEarnedGHS,
      clawedBackGHS: s.clawedBackGHS,
      netEarnedGHS: s.netEarnedGHS,
      walletBalanceGHS: s.walletBalanceGHS,
      reservedGHS: s.reservedGHS,
      availableToWithdrawGHS: s.availableToWithdrawGHS,
      currency: s.currency,
    };
  }

  async getWithdrawals(userId: string) {
    return this.withdrawalRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ---------- scheduled rider auto-payouts (Go 2) ----------

  /**
   * Auto-payout config. RIDER_AUTO_PAYOUT_ENABLED=false disables the daily
   * run; RIDER_AUTO_PAYOUT_THRESHOLD_GHS sets the minimum available balance
   * (default GH₵50, fail-closed to 50 on invalid config).
   */
  private autoPayoutConfig() {
    const enabled =
      (this.configService.get<string>('RIDER_AUTO_PAYOUT_ENABLED') || 'true').toLowerCase() !== 'false';
    const raw = Number(this.configService.get<string>('RIDER_AUTO_PAYOUT_THRESHOLD_GHS'));
    const thresholdGHS = Number.isFinite(raw) && raw > 0 ? raw : 50;
    return { enabled, thresholdGHS };
  }

  async getPayoutDestination(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const cfg = this.autoPayoutConfig();
    return {
      momoNumber: user.payoutMomoNumber || null,
      network: user.payoutNetwork || null,
      autoPayoutEnabled: cfg.enabled,
      thresholdGHS: cfg.thresholdGHS,
    };
  }

  async setPayoutDestination(userId: string, momoNumber: string, network?: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const momo = (momoNumber || '').replace(/\s+/g, '');
    if (!/^[0-9]{10}$/.test(momo)) {
      throw new BadRequestException('MoMo number must be 10 digits');
    }
    const net = assertNetwork(network);
    user.payoutMomoNumber = momo;
    user.payoutNetwork = net || 'MTN';
    await this.usersRepository.save(user);
    return this.getPayoutDestination(userId);
  }

  private autoPayoutRunning = false;

  /**
   * One scheduled payout run: every rider with a saved payout destination
   * and available balance >= the threshold gets their full available balance
   * sent via the normal withdrawal pipeline (request + system approval +
   * provider transfer with the pre-minted idempotency reference). Riders are
   * skipped — never failed silently — when a payout is already in flight or
   * an unresolved HIGH fraud flag is open. One rider's failure never stops
   * the batch.
   */
  async runScheduledRiderPayouts() {
    const cfg = this.autoPayoutConfig();
    const summary: {
      ranAt: string;
      enabled: boolean;
      thresholdGHS: number;
      paid: { riderId: string; amount: number; withdrawalId: string; transferStatus: string }[];
      skipped: { riderId?: string; reason: string }[];
    } = { ranAt: new Date().toISOString(), enabled: cfg.enabled, thresholdGHS: cfg.thresholdGHS, paid: [], skipped: [] };
    if (!cfg.enabled) return summary;
    if (this.autoPayoutRunning) {
      summary.skipped.push({ reason: 'previous payout run still in progress' });
      return summary;
    }
    this.autoPayoutRunning = true;
    try {
      const riders = await this.usersRepository.find({ where: { role: 'RIDER' } });
      for (const rider of riders) {
        try {
          if (!rider.payoutMomoNumber) {
            summary.skipped.push({ riderId: rider.id, reason: 'no payout destination saved' });
            continue;
          }
          const inFlight = await this.withdrawalRepository.count({
            where: { userId: rider.id, status: In(['PENDING', 'APPROVED']) },
          });
          if (inFlight > 0) {
            summary.skipped.push({ riderId: rider.id, reason: 'a payout is already in flight' });
            continue;
          }
          if (await this.fraudService.hasOpenHighFlag(rider.id)) {
            summary.skipped.push({ riderId: rider.id, reason: 'open high-severity fraud flag' });
            continue;
          }
          const reserved = await this.reservedAmount(this.dataSource.manager, rider.id);
          const available = Math.round(((Number(rider.balance) || 0) - reserved) * 100) / 100;
          if (available < cfg.thresholdGHS) {
            summary.skipped.push({
              riderId: rider.id,
              reason: `available GHS ${available.toFixed(2)} below the GHS ${cfg.thresholdGHS} threshold`,
            });
            continue;
          }
          const req = await this.requestWithdrawal(
            rider.id, available, rider.payoutMomoNumber, rider.payoutNetwork || undefined,
          );
          const approved = await this.reviewWithdrawal(
            req.id, 'SYSTEM', 'APPROVED', 'Scheduled rider auto-payout',
          );
          summary.paid.push({
            riderId: rider.id,
            amount: Number(approved.amount),
            withdrawalId: approved.id,
            transferStatus: approved.transferStatus,
          });
        } catch (err) {
          summary.skipped.push({
            riderId: rider.id,
            reason: (err as Error).message?.slice(0, 200) || 'payout failed',
          });
        }
      }
    } finally {
      this.autoPayoutRunning = false;
    }
    console.log(
      `[AUTO-PAYOUT] paid=${summary.paid.length} skipped=${summary.skipped.length} threshold=GHS ${cfg.thresholdGHS}`,
    );
    return summary;
  }

  async getAllWithdrawals(status?: string) {
    const where = status ? { status: status as any } : {};
    return this.withdrawalRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  /** Ledger-derived balance — the source of truth (Master Doc §4). */
  async recomputeBalance(userId: string): Promise<number> {
    const rows = await this.txRepository.find({ where: { userId } });
    const sum = rows.reduce(
      (acc, r) => acc + (r.type === 'CREDIT' ? Number(r.amount) : -Number(r.amount)),
      0,
    );
    return Math.round(sum * 100) / 100;
  }

  // ---------- top-ups (provider-backed) ----------

  /**
   * Start a top-up: direct MoMo charge via the payment provider.
   * Creates a PaymentAttempt and prompts the customer's phone. Creates NO
   * ledger entry — money is credited only when a verified provider webhook
   * confirms the charge (see handleProviderWebhook).
   */
  async initiateTopUp(userId: string, amount: any, momoNumber: string, network: any) {
    const n = assertPositiveAmount(amount);
    if (n > MAX_TOPUP_GHS) throw new BadRequestException(`Top-up cannot exceed GHS ${MAX_TOPUP_GHS}`);
    const momo = (momoNumber || '').replace(/\s+/g, '');
    if (!/^[0-9]{10}$/.test(momo)) {
      throw new BadRequestException('MoMo number must be 10 digits');
    }
    const net = assertNetwork(network);
    if (!net) throw new BadRequestException('A MoMo network is required (MTN, VODAFONE, or AIRTEL_TIGO)');
    const amountMinor = Math.round(n * 100);

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Unguessable reference, shared with the provider for webhook matching.
    // (Paystack allows [- .=a-zA-Z0-9]; this format complies.)
    const reference = `studs_topup_${crypto.randomUUID().replace(/-/g, '')}`;

    const attempt = await this.attemptRepository.save(
      this.attemptRepository.create({
        userId,
        amountMinor,
        currency: 'GHS',
        provider: this.provider.name,
        providerReference: reference,
        status: 'INITIATED',
        network: net,
      }),
    );

    // External HTTP call — deliberately OUTSIDE any DB transaction.
    try {
      const res = await this.provider.initiateTopUp({
        amountMinor,
        currency: 'GHS',
        userId,
        email: user.email,
        momoNumber: momo,
        reference,
        network: net,
        metadata: { userId, attemptId: attempt.id },
      });
      attempt.status = 'PENDING';
      attempt.authorizationUrl = res.authorizationUrl || null;
      attempt.accessCode = res.accessCode || null;
      await this.attemptRepository.save(attempt);
      console.log(`[TOPUP INITIATED] user=${userId} amount=${n} network=${net} ref=${reference}`);
      return {
        attemptId: attempt.id,
        providerReference: reference,
        providerStatus: res.providerStatus || null,
        authorizationUrl: res.authorizationUrl || null,
        displayNote: res.displayNote || null,
        status: 'PENDING' as const,
        amount: n,
        currency: 'GHS',
      };
    } catch (err) {
      attempt.status = 'FAILED';
      attempt.failureReason = shortError(err);
      await this.attemptRepository.save(attempt);
      console.error(`[TOPUP INITIATE FAILED] user=${userId} ref=${reference}: ${attempt.failureReason}`);
      throw new BadRequestException(`Could not start the MoMo payment: ${attempt.failureReason}`);
    }
  }

  /**
   * Submit the OTP/voucher for a top-up that requires it (e.g. Telecel).
   * Never credits — the charge.success webhook (or reconcile) does that.
   */
  async submitTopUpOtp(userId: string, attemptId: string, otp: string) {
    const attempt = await this.attemptRepository.findOne({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId) throw new NotFoundException('Top-up attempt not found');
    if (attempt.status !== 'PENDING') {
      throw new BadRequestException(`Top-up is ${attempt.status}, cannot submit OTP`);
    }
    const clean = (otp || '').replace(/\s+/g, '');
    if (!/^\d{4,8}$/.test(clean)) throw new BadRequestException('OTP must be 4–8 digits');
    let result: { status: 'PENDING' | 'SUCCESS' | 'FAILED' };
    try {
      result = await this.provider.submitTopUpOtp(attempt.providerReference, clean);
    } catch (err) {
      throw new BadRequestException(`OTP submission failed: ${shortError(err)}`);
    }
    if (result.status === 'FAILED') {
      attempt.status = 'FAILED';
      attempt.failureReason = 'Provider rejected the OTP/charge';
      attempt.completedAt = new Date();
      await this.attemptRepository.save(attempt);
    }
    console.log(`[TOPUP OTP] attempt=${attemptId} providerStatus=${result.status}`);
    return { attemptId, status: result.status === 'FAILED' ? 'FAILED' : 'PENDING' };
  }

  async getTopUpAttempt(userId: string, attemptId: string) {
    const a = await this.attemptRepository.findOne({ where: { id: attemptId } });
    if (!a || a.userId !== userId) throw new NotFoundException('Top-up attempt not found');
    return {
      attemptId: a.id,
      status: a.status,
      amount: a.amountMinor / 100,
      currency: a.currency,
      authorizationUrl: a.authorizationUrl,
      failureReason: a.failureReason,
    };
  }

  /**
   * Manual reconciliation for a stuck top-up ("I paid but nothing shows").
   * Asks the provider for the authoritative charge status; credits only on
   * verified SUCCESS with matching amount/currency.
   */
  async reconcileTopUp(userId: string, attemptId: string) {
    const attempt = await this.attemptRepository.findOne({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId) throw new NotFoundException('Top-up attempt not found');
    if (attempt.status === 'SUCCESS') return this.getTopUpAttempt(userId, attemptId);
    if (attempt.status !== 'PENDING' && attempt.status !== 'INITIATED') {
      return this.getTopUpAttempt(userId, attemptId);
    }
    let verified;
    try {
      verified = await this.provider.verifyCharge(attempt.providerReference);
    } catch (err) {
      throw new BadRequestException(`Could not verify with provider: ${shortError(err)}`);
    }
    if (verified.status === 'SUCCESS') {
      if (verified.channel && verified.channel !== 'mobile_money') {
        attempt.status = 'FAILED';
        attempt.failureReason = `Unexpected payment channel: ${verified.channel}`;
        attempt.completedAt = new Date();
        await this.attemptRepository.save(attempt);
        return this.getTopUpAttempt(userId, attemptId);
      }
      await this.confirmTopUp({
        kind: 'CHARGE_SUCCESS',
        rawEvent: 'reconciliation',
        reference: attempt.providerReference,
        amountMinor: verified.amountMinor,
        currency: verified.currency,
      });
    } else if (verified.status === 'FAILED') {
      attempt.status = 'FAILED';
      attempt.failureReason = 'Provider reports the charge failed';
      attempt.completedAt = new Date();
      await this.attemptRepository.save(attempt);
    }
    return this.getTopUpAttempt(userId, attemptId);
  }

  // ---------- withdrawals (request → approve/send → confirm) ----------

  /**
   * Request a withdrawal. Reserves the amount immediately (derived from this
   * row — available balance excludes PENDING/APPROVED withdrawals), but
   * posts NO debit. The debit lands only when the provider confirms payout.
   */
  async requestWithdrawal(userId: string, amount: any, momoNumber: string, network?: any) {
    const n = assertPositiveAmount(amount);
    const momo = (momoNumber || '').replace(/\s+/g, '');
    if (!/^[0-9]{10}$/.test(momo)) {
      throw new BadRequestException('MoMo number must be 10 digits');
    }
    const net = assertNetwork(network);

    // Serialized: concurrent dataSource.transaction() calls corrupt the
    // single sqlite connection's SAVEPOINT bookkeeping.
    const saved = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
      const available = await this.availableBalance(manager, userId);
      if (n > available) {
        throw new BadRequestException(
          `Insufficient available balance. Requested: GHS ${n.toFixed(2)}, available: GHS ${available.toFixed(2)}.`,
        );
      }
      const req = manager.create(Withdrawal, {
        userId,
        amount: n,
        momoNumber: momo,
        network: net || null,
        status: 'PENDING',
      });
      const created = await manager.save(req);
      console.log(`[WITHDRAWAL REQUEST] user=${userId} amount=${n} momo=${maskMomo(momo)} reserved`);
      return created;
      }),
    );
    if (n >= 500) {
      await this.fraudService.record('LARGE_WITHDRAWAL', {
        userId,
        severity: 'MEDIUM',
        detail: `Withdrawal of GH₵${n.toFixed(2)} to ${maskMomo(momo)} requested — above the GH₵500 review threshold.`,
      });
    }
    return saved;
  }

  async reviewWithdrawal(id: string, reviewerId: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) {
    const req = await this.withdrawalRepository.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Withdrawal request not found');
    if (req.status !== 'PENDING') throw new BadRequestException(`Already ${req.status}`);

    if (status === 'REJECTED') {
      req.status = 'REJECTED';
      req.reviewedBy = reviewerId;
      req.reviewedAt = new Date();
      req.reviewNote = reviewNote || null;
      await this.withdrawalRepository.save(req);
      console.log(`[WITHDRAWAL REJECTED] id=${id} — reservation released`);
      return req;
    }

    // APPROVED — claim the request, then send real money OUTSIDE the transaction.
    // Mutex held only for the DB claim, never across the provider HTTP call.
    const { withdrawal: approved, accountName } = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
      const fresh = await manager.findOne(Withdrawal, { where: { id } });
      if (!fresh || fresh.status !== 'PENDING') {
        throw new BadRequestException('Withdrawal is no longer pending');
      }
      if (fresh.transferCode) {
        throw new BadRequestException('Transfer already initiated for this withdrawal');
      }
      // Belt-and-braces: the reservation should guarantee this, but never
      // send money the ledger says isn't there.
      const user = await manager.findOne(User, { where: { id: fresh.userId } });
      if (!user || Number(user.balance) < Number(fresh.amount)) {
        throw new BadRequestException('Funds no longer available for this withdrawal');
      }
      // Our idempotency key, minted BEFORE any provider call: the gateway
      // receives it as the transfer reference and rejects duplicates.
      fresh.providerReference = `studs_wd_${fresh.id.replace(/-/g, '')}`;
      fresh.status = 'APPROVED';
      fresh.reviewedBy = reviewerId;
      fresh.reviewedAt = new Date();
      fresh.reviewNote = reviewNote || null;
      await manager.save(fresh);
      // The account holder's real name for the provider's recipient record
      // (never a phone-derived synthetic name).
      return { withdrawal: fresh, accountName: user.name };
      }),
    );

    // External HTTP call — deliberately OUTSIDE the DB transaction.
    // The reference is our pre-minted idempotency key: if this call times out
    // after the gateway accepted it, a retry sends the same reference and the
    // gateway rejects it as a duplicate instead of double-sending.
    const amountMinor = Math.round(Number(approved.amount) * 100);
    const reference = approved.providerReference as string;
    let result: InitiateTransferResult;
    try {
      result = await this.provider.initiateTransfer({
        amountMinor,
        currency: 'GHS',
        momoNumber: approved.momoNumber,
        network: (approved.network as MomoNetwork) || undefined,
        reference,
        narration: `STUDS withdrawal ${approved.id}`,
        accountName,
      });
    } catch (err) {
      // Honest state: approved, reserved, but NOT sent. Retry is safe —
      // transferCode is still null so reviewWithdrawal can't double-send.
      console.error(`[WITHDRAWAL TRANSFER INITIATE FAILED] id=${approved.id}: ${shortError(err)}`);
      throw new BadRequestException(
        'Transfer initiation failed. The withdrawal stays APPROVED (funds reserved) and can be retried.',
      );
    }

    const updated = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
      const fresh = await manager.findOne(Withdrawal, { where: { id } });
      if (!fresh) throw new NotFoundException('Withdrawal request not found');
      if (fresh.transferCode && fresh.transferCode !== result.transferCode) {
        // A concurrent approval already recorded a transfer — never overwrite.
        throw new BadRequestException('Transfer already initiated for this withdrawal');
      }
      fresh.transferCode = result.transferCode;
      fresh.transferStatus = result.status;
      fresh.sentAt = new Date();
      await manager.save(fresh);
      return fresh;
      }),
    );
    console.log(
      `[WITHDRAWAL SENT] id=${id} amount=${approved.amount} transfer=${result.transferCode} — debit on provider confirmation`,
    );
    return updated;
  }

  /**
   * Retry a transfer initiation that timed out or failed. SAFE: only for
   * APPROVED withdrawals with no transferCode yet. Reuses the pre-minted
   * providerReference (never mints a second) — the gateway rejects duplicate
   * references, so a retry after a timeout can never double-send.
   */
  async retryWithdrawalTransfer(id: string) {
    const wd = await this.withdrawalRepository.findOne({ where: { id } });
    if (!wd) throw new NotFoundException('Withdrawal request not found');
    if (wd.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED withdrawals can be retried');
    }
    if (wd.transferCode) {
      throw new BadRequestException('Transfer already initiated for this withdrawal');
    }
    if (!wd.providerReference) {
      throw new BadRequestException('Withdrawal has no provider reference; cannot retry');
    }
    const user = await this.usersRepository.findOne({ where: { id: wd.userId } });

    // External HTTP call — no DB lock held across it.
    let result: InitiateTransferResult;
    try {
      result = await this.provider.initiateTransfer({
        amountMinor: Math.round(Number(wd.amount) * 100),
        currency: 'GHS',
        momoNumber: wd.momoNumber,
        network: (wd.network as MomoNetwork) || undefined,
        // SAME reference as the first attempt — idempotent retry.
        reference: wd.providerReference,
        narration: `STUDS withdrawal ${wd.id} (retry)`,
        accountName: user?.name,
      });
    } catch (err) {
      console.error(`[WITHDRAWAL RETRY FAILED] id=${wd.id}: ${shortError(err)}`);
      throw new BadRequestException(
        'Transfer initiation failed again. The withdrawal stays APPROVED (funds reserved) and can be retried.',
      );
    }

    const updated = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
        const fresh = await manager.findOne(Withdrawal, { where: { id } });
        if (!fresh || fresh.status !== 'APPROVED' || fresh.transferCode) {
          throw new BadRequestException('Withdrawal state changed during retry');
        }
        fresh.transferCode = result.transferCode;
        fresh.transferStatus = result.status;
        fresh.sentAt = new Date();
        await manager.save(fresh);
        return fresh;
      }),
    );
    console.log(
      `[WITHDRAWAL RETRY SENT] id=${id} transfer=${result.transferCode} — debit on provider confirmation`,
    );
    return updated;
  }

  /**
   * Manual reconciliation for a stuck payout. Asks the provider for the
   * authoritative transfer status and finalizes accordingly.
   */
  async reconcileWithdrawal(id: string) {
    const wd = await this.withdrawalRepository.findOne({ where: { id } });
    if (!wd) throw new NotFoundException('Withdrawal request not found');
    if (!wd.transferCode) throw new BadRequestException('No transfer initiated for this withdrawal yet');
    if (wd.status === 'COMPLETED' || wd.status === 'FAILED' || wd.status === 'REJECTED') return wd;

    let verified;
    try {
      verified = await this.provider.verifyTransfer(wd.transferCode);
    } catch (err) {
      throw new BadRequestException(`Could not verify with provider: ${shortError(err)}`);
    }
    if (verified.status === 'SUCCESS') {
      await this.confirmWithdrawal({
        kind: 'TRANSFER_SUCCESS',
        rawEvent: 'reconciliation',
        reference: wd.providerReference,
        transferCode: wd.transferCode,
        amountMinor: verified.amountMinor,
        currency: 'GHS',
      });
    } else if (verified.status === 'FAILED' || verified.status === 'REVERSED') {
      await this.failWithdrawal({
        kind: verified.status === 'REVERSED' ? 'TRANSFER_REVERSED' : 'TRANSFER_FAILED',
        rawEvent: 'reconciliation',
        reference: wd.providerReference,
        transferCode: wd.transferCode,
      });
    }
    return this.withdrawalRepository.findOne({ where: { id } });
  }

  // ---------- provider webhooks ----------

  /**
   * Entry point for provider webhooks. Verifies the signature against the
   * RAW body, records the event (unique dedupe key ⇒ replays are harmless),
   * then applies it. Never credits/debits on an unverified event.
   */
  async handleProviderWebhook(providerName: string, rawBody: Buffer, signature: string | undefined) {
    if (providerName !== this.provider.name) {
      return { ok: false as const, reason: 'unknown-provider' };
    }
    const event = this.provider.parseWebhook(rawBody, signature);
    if (!event) {
      console.log(`[WEBHOOK] rejected: invalid signature or unparseable payload (provider=${providerName})`);
      return { ok: false as const, reason: 'invalid-signature' };
    }

    // Defense-in-depth for real providers: before crediting on a
    // charge.success webhook, ask the provider for the authoritative charge
    // status. This is an HTTP call, so it stays OUTSIDE the mutex and outside
    // any DB transaction. The fake test provider is exempt (it has no
    // authoritative state beyond what the test drives).
    if (event.kind === 'CHARGE_SUCCESS' && providerName !== 'fake') {
      let verified;
      try {
        verified = await this.provider.verifyCharge(event.reference);
      } catch (err) {
        console.error(`[WEBHOOK] charge verification failed for ${event.reference}: ${shortError(err)}`);
        return { ok: false as const, reason: 'verification-failed' };
      }
      if (verified.status !== 'SUCCESS') {
        console.log(`[WEBHOOK] charge ${event.reference} not successful per provider (status=${verified.status}) — not crediting`);
        return { ok: false as const, reason: 'charge-not-successful' };
      }
      // Channel binding: this reference must be a MoMo charge, never a card
      // or bank charge that somehow shares the reference.
      if (verified.channel && verified.channel !== 'mobile_money') {
        console.log(`[WEBHOOK] charge ${event.reference} has wrong channel (${verified.channel}) — not crediting`);
        return { ok: false as const, reason: 'wrong-channel' };
      }
      // Use the provider's authoritative amount/currency, not the webhook payload's.
      event.amountMinor = verified.amountMinor;
      event.currency = verified.currency;
    }

    // Same defense-in-depth for transfer webhooks: verify the payout's
    // authoritative status before debiting. HTTP call stays outside the
    // mutex/transaction. Fake provider exempt. Verification is by transfer
    // code when the event carries one, otherwise by our idempotency
    // reference — a success event is NEVER applied unverified.
    if (event.kind === 'TRANSFER_SUCCESS' && providerName !== 'fake') {
      let verified;
      try {
        verified = event.transferCode
          ? await this.provider.verifyTransfer(event.transferCode)
          : await this.provider.verifyTransferByReference(event.reference);
      } catch (err) {
        console.error(`[WEBHOOK] transfer verification failed for ${event.reference}: ${shortError(err)}`);
        return { ok: false as const, reason: 'verification-failed' };
      }
      if (verified.status !== 'SUCCESS') {
        console.log(`[WEBHOOK] transfer ${event.reference} not successful per provider (status=${verified.status}) — not debiting`);
        return { ok: false as const, reason: 'transfer-not-successful' };
      }
      // Reference binding: the verified transfer must be OUR transfer.
      if (verified.reference && verified.reference !== event.reference) {
        console.log(`[WEBHOOK] transfer reference mismatch: event=${event.reference} verified=${verified.reference} — not debiting`);
        return { ok: false as const, reason: 'reference-mismatch' };
      }
      // Backfill the gateway's code so the ledger records it even when the
      // webhook (or a lost initiation response) never gave it to us.
      if (verified.transferCode && !event.transferCode) event.transferCode = verified.transferCode;
      event.amountMinor = verified.amountMinor;
    }

    // Signature verification above is pure local HMAC (no DB) and stays
    // outside any lock. Everything below touches the DB, so the whole flow
    // — dedupe claim, ledger apply, status save — runs under ONE mutex
    // acquisition. On sqlite every query funnels through a single shared
    // connection; interleaving a repository.save() with another webhook's
    // dataSource.transaction() corrupts TypeORM's SAVEPOINT bookkeeping
    // ("no such savepoint", "cannot start a transaction within a
    // transaction"). Serializing the complete flow prevents that, and the
    // internal apply helpers below are the UNLOCKED variants (they must
    // never re-acquire the mutex or they would deadlock).
    const dedupeKey = event.eventId
      ? `${providerName}:${event.eventId}`
      : `${providerName}:${event.rawEvent}:${event.reference}`;

    return this.ledgerMutex.run(async () => {
      let record = await this.webhookEventRepository.findOne({ where: { dedupeKey } });
      if (record) {
        if (record.status === 'FAILED') {
          // A previous delivery attempt failed partway. Retry it IN PLACE:
          // the failure history (error + retry count) stays on the record
          // for audit instead of being deleted. PROCESSED and RECEIVED
          // (in-flight) duplicates stay suppressed.
          console.log(`[WEBHOOK] retrying previously-failed event: ${dedupeKey} (attempt ${record.retryCount + 2})`);
          record.retryCount += 1;
          record.lastError = record.error;
          record.error = null;
          record.status = 'RECEIVED';
          record.processedAt = null;
        } else {
          console.log(`[WEBHOOK] duplicate delivery ignored: ${dedupeKey}`);
          return { ok: true as const, reason: 'duplicate' };
        }
      } else {
        record = this.webhookEventRepository.create({
          provider: providerName,
          eventType: event.rawEvent,
          dedupeKey,
          reference: event.reference,
          status: 'RECEIVED',
        });
      }
      await this.webhookEventRepository.save(record);

      try {
        await this.applyWebhookEventUnlocked(event);
        record.status = 'PROCESSED';
      } catch (err) {
        record.status = 'FAILED';
        record.error = shortError(err);
        console.error(`[WEBHOOK] processing failed for ${dedupeKey}: ${record.error}`);
      }
      record.processedAt = new Date();
      await this.webhookEventRepository.save(record);
      return { ok: record.status === 'PROCESSED', reason: record.status.toLowerCase() };
    });
  }

  private async applyWebhookEventUnlocked(event: NormalizedWebhookEvent) {
    switch (event.kind) {
      case 'CHARGE_SUCCESS':
        return this.confirmTopUpUnlocked(event);
      case 'TRANSFER_SUCCESS':
        return this.confirmWithdrawalUnlocked(event);
      case 'TRANSFER_FAILED':
      case 'TRANSFER_REVERSED':
        return this.failWithdrawalUnlocked(event);
      default:
        // CHARGE_FAILED, UNKNOWN — nothing to credit; the attempt stays
        // PENDING until it expires or the user reconciles.
        console.log(`[WEBHOOK] no ledger action for kind=${event.kind} ref=${event.reference}`);
        return;
    }
  }

  private async applyWebhookEvent(event: NormalizedWebhookEvent) {
    switch (event.kind) {
      case 'CHARGE_SUCCESS':
        return this.confirmTopUp(event);
      case 'TRANSFER_SUCCESS':
        return this.confirmWithdrawal(event);
      case 'TRANSFER_FAILED':
      case 'TRANSFER_REVERSED':
        return this.failWithdrawal(event);
      default:
        // CHARGE_FAILED, UNKNOWN — nothing to credit; the attempt stays
        // PENDING until it expires or the user reconciles.
        console.log(`[WEBHOOK] no ledger action for kind=${event.kind} ref=${event.reference}`);
        return;
    }
  }

  /**
   * Credit a top-up AFTER the provider confirms money moved. Idempotent:
   * one reference ⇒ at most one TOPUP entry, enforced by the attempt status
   * transition inside a single DB transaction.
   */
  private async confirmTopUp(event: NormalizedWebhookEvent) {
    // Serialized: concurrent dataSource.transaction() calls corrupt the
    // single sqlite connection's SAVEPOINT bookkeeping.
    await this.ledgerMutex.run(() => this.confirmTopUpUnlocked(event));
  }

  /**
   * UNLOCKED variant — call only while already holding the ledger mutex
   * (e.g. from handleProviderWebhook). Re-acquiring the mutex here would
   * deadlock.
   */
  private async confirmTopUpUnlocked(event: NormalizedWebhookEvent) {
    await this.dataSource.transaction(async (manager) => {
      const attempt = await manager.findOne(PaymentAttempt, {
        where: { providerReference: event.reference },
      });
      if (!attempt) throw new Error(`No payment attempt matches reference ${event.reference}`);
      if (attempt.status === 'SUCCESS') return; // idempotent replay
      if (attempt.status !== 'PENDING' && attempt.status !== 'INITIATED') {
        throw new Error(`Attempt ${attempt.id} in unexpected status ${attempt.status}`);
      }
      if (event.amountMinor !== undefined && event.amountMinor !== attempt.amountMinor) {
        throw new Error(
          `Amount mismatch for ${event.reference}: expected ${attempt.amountMinor}, got ${event.amountMinor}`,
        );
      }
      if (event.currency && event.currency !== attempt.currency) {
        throw new Error(`Currency mismatch for ${event.reference}: expected ${attempt.currency}, got ${event.currency}`);
      }
      const amount = attempt.amountMinor / 100;
      const entry = await this.applyEntry(manager, attempt.userId, 'CREDIT', amount, 'TOPUP', {
        provider: attempt.provider,
        providerRef: attempt.providerReference,
        referenceId: attempt.id,
        note: `MoMo top-up confirmed (${attempt.provider})`,
      });
      attempt.status = 'SUCCESS';
      attempt.completedAt = new Date();
      await manager.save(attempt);
      console.log(
        `[TOPUP CONFIRMED] user=${attempt.userId} amount=${amount} balanceAfter=${entry.balanceAfter} ref=${event.reference}`,
      );
    });
  }

  /**
   * Post the WITHDRAWAL debit AFTER the provider confirms the payout.
   * Between approval and this moment the funds were reserved (unspendable)
   * but not debited — the ledger only records money that actually moved.
   */
  private async confirmWithdrawal(event: NormalizedWebhookEvent) {
    // Serialized: concurrent dataSource.transaction() calls corrupt the
    // single sqlite connection's SAVEPOINT bookkeeping.
    await this.ledgerMutex.run(() => this.confirmWithdrawalUnlocked(event));
  }

  /**
   * UNLOCKED variant — call only while already holding the ledger mutex
   * (e.g. from handleProviderWebhook). Re-acquiring the mutex here would
   * deadlock.
   */
  private async confirmWithdrawalUnlocked(event: NormalizedWebhookEvent) {
    await this.dataSource.transaction(async (manager) => {
      // Match on the gateway's transfer code OR our idempotency reference
      // (covers the timeout case where we never learned the transfer code).
      let wd = event.transferCode
        ? await manager.findOne(Withdrawal, { where: { transferCode: event.transferCode } })
        : null;
      if (!wd) {
        wd = await manager.findOne(Withdrawal, { where: { providerReference: event.reference } });
      }
      if (!wd) throw new Error(`No withdrawal matches transfer ${event.reference}`);
      if (wd.status === 'COMPLETED') return; // idempotent replay
      if (wd.status !== 'APPROVED') {
        throw new Error(`Withdrawal ${wd.id} in unexpected status ${wd.status}`);
      }
      const expectedMinor = Math.round(Number(wd.amount) * 100);
      if (event.amountMinor !== undefined && event.amountMinor !== expectedMinor) {
        throw new Error(`Amount mismatch for transfer ${event.reference}`);
      }
      const entry = await this.applyEntry(manager, wd.userId, 'DEBIT', Number(wd.amount), 'WITHDRAWAL', {
        provider: this.provider.name,
        providerRef: event.transferCode || wd.transferCode || event.reference,
        referenceId: wd.id,
        note: `Withdrawal to ${maskMomo(wd.momoNumber)} confirmed`,
      });
      wd.status = 'COMPLETED';
      wd.transferStatus = 'SUCCESS';
      if (event.transferCode && !wd.transferCode) wd.transferCode = event.transferCode;
      wd.completedAt = new Date();
      await manager.save(wd);
      console.log(
        `[WITHDRAWAL COMPLETED] id=${wd.id} amount=${wd.amount} balanceAfter=${entry.balanceAfter} transfer=${event.reference}`,
      );
    });
  }

  /**
   * Provider says the payout failed or was reversed: release the reservation,
   * post NO debit. The user keeps their funds and can retry.
   */
  private async failWithdrawal(event: NormalizedWebhookEvent) {
    // Serialized: concurrent dataSource.transaction() calls corrupt the
    // single sqlite connection's SAVEPOINT bookkeeping.
    await this.ledgerMutex.run(() => this.failWithdrawalUnlocked(event));
  }

  /**
   * UNLOCKED variant — call only while already holding the ledger mutex
   * (e.g. from handleProviderWebhook). Re-acquiring the mutex here would
   * deadlock.
   */
  private async failWithdrawalUnlocked(event: NormalizedWebhookEvent) {
    await this.dataSource.transaction(async (manager) => {
      let wd = event.transferCode
        ? await manager.findOne(Withdrawal, { where: { transferCode: event.transferCode } })
        : null;
      if (!wd) {
        wd = await manager.findOne(Withdrawal, { where: { providerReference: event.reference } });
      }
      if (!wd) throw new Error(`No withdrawal matches transfer ${event.reference}`);
      if (wd.status === 'FAILED') return; // idempotent replay
      if (wd.status === 'COMPLETED') {
        if (event.kind === 'TRANSFER_REVERSED') {
          // Money was debited AND the provider reversed it (funds returned
          // to our account). Post exactly one immutable compensating credit.
          // Idempotent: check for an existing reversal entry first.
          const existing = await manager.findOne(WalletTransaction, {
            where: { referenceId: wd.id, reason: 'WITHDRAWAL_REVERSAL' },
          });
          if (existing) return;
          await this.applyEntry(manager, wd.userId, 'CREDIT', Number(wd.amount), 'WITHDRAWAL_REVERSAL', {
            provider: this.provider.name,
            providerRef: event.transferCode || wd.transferCode || event.reference,
            referenceId: wd.id,
            note: `Withdrawal reversed by provider — funds returned`,
          });
          wd.transferStatus = 'REVERSED';
          wd.failureReason = `Provider reversed transfer after completion; compensating credit posted`;
          await manager.save(wd);
          console.log(`[WITHDRAWAL REVERSED] id=${wd.id} — compensating credit posted`);
          return;
        }
        // TRANSFER_FAILED after COMPLETED: money left our system but
        // provider reports failure — genuine conflict, flag for manual review.
        // Never auto-adjust; a human must reconcile with the provider.
        console.error(
          `[WITHDRAWAL CONFLICT] transfer ${event.reference} reported ${event.kind} but withdrawal ${wd.id} is COMPLETED — manual review required`,
        );
        return;
      }
      wd.status = 'FAILED';
      wd.transferStatus = event.kind === 'TRANSFER_REVERSED' ? 'REVERSED' : 'FAILED';
      wd.failureReason = `Provider reported ${event.kind}`;
      wd.completedAt = new Date();
      await manager.save(wd);
      console.log(`[WITHDRAWAL FAILED] id=${wd.id} transfer=${event.reference} — reservation released, no debit posted`);
    });
  }

  // ---------- internal money movement (used by OrdersService) ----------

  /**
   * Debit for an order. Throws when AVAILABLE funds (balance minus reserved
   * withdrawals) are insufficient — reserved money can never be double-spent.
   */
  async debitForOrder(userId: string, amount: number, orderId: string, manager?: EntityManager) {
    const run = async (m: EntityManager) => {
      const available = await this.availableBalance(m, userId);
      if (available < amount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Required: GHS ${amount.toFixed(2)}, available: GHS ${available.toFixed(2)}. Please top up.`,
        );
      }
      return this.applyEntry(m, userId, 'DEBIT', amount, 'ORDER_PAYMENT', { referenceId: orderId });
    };
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  async refundOrder(userId: string, amount: number, orderId: string, manager?: EntityManager) {
    // Zero-total orders (e.g. subscription-waived P2P sends) took no money,
    // so there is nothing to refund — never post zero-amount ledger rows.
    if (!(Number(amount) > 0)) return null;
    const run = (m: EntityManager) =>
      this.applyEntry(m, userId, 'CREDIT', amount, 'ORDER_REFUND', {
        referenceId: orderId,
        note: 'Order cancelled/refunded',
      });
    const entry = manager ? await run(manager) : await this.dataSource.transaction(run);
    console.log(`[ORDER REFUND] user=${userId} order=${orderId} amount=${amount}`);
    return entry;
  }

  async payoutRider(riderId: string, amount: number, orderId: string, manager?: EntityManager) {
    const run = (m: EntityManager) =>
      this.applyEntry(m, riderId, 'CREDIT', amount, 'RIDER_PAYOUT', {
        referenceId: orderId,
        note: 'Delivery payout',
      });
    const entry = manager ? await run(manager) : await this.dataSource.transaction(run);
    console.log(`[RIDER PAYOUT] rider=${riderId} order=${orderId} amount=${amount}`);
    return entry;
  }

  /**
   * Finds the internal platform account, creating it on first use.
   * It accumulates commission via the same immutable ledger as everyone else,
   * so platform earnings are fully auditable. It can never log in.
   */
  async getOrCreatePlatformAccount(manager: EntityManager): Promise<User> {
    let platform = await manager.findOne(User, { where: { email: PLATFORM_ACCOUNT_EMAIL } });
    if (!platform) {
      const unusablePassword = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 10);
      platform = manager.create(User, {
        email: PLATFORM_ACCOUNT_EMAIL,
        password: unusablePassword,
        role: 'PLATFORM',
        name: 'STUDS Platform',
        phone: '',
        campusId: '',
        balance: 0,
      });
      await manager.save(platform);
      console.log(`[PLATFORM ACCOUNT] created ${PLATFORM_ACCOUNT_EMAIL}`);
    }
    return platform;
  }

  /**
   * Settles one delivered order across all three parties, atomically:
   *   vendor  <- productTotal - commission   (VENDOR_PAYOUT)
   *   rider   <- full deliveryFee            (RIDER_PAYOUT)
   *   platform<- commission                  (PLATFORM_COMMISSION)
   * The student was already debited (productTotal + deliveryFee) at checkout,
   * so: student debit == vendor + rider + platform credits. Always.
   * All math is done in pesewas to avoid float drift.
   */
  async settleOrder(
    params: { orderId: string; vendorId: string; riderId: string; productTotal: number; deliveryFee: number },
    manager: EntityManager,
    opts: { commissionRate?: number; deliveryFeeCoveredByPlatform?: boolean } = {},
  ) {
    const rate = opts.commissionRate ?? this.getCommissionRate();
    const productPesewas = Math.round(Number(params.productTotal) * 100);
    const feePesewas = Math.round(Number(params.deliveryFee) * 100);
    const commissionPesewas = Math.round(productPesewas * rate);
    const vendorPesewas = productPesewas - commissionPesewas;

    const commission = commissionPesewas / 100;
    const vendorPayout = vendorPesewas / 100;
    const riderPayout = feePesewas / 100;

    const platform = await this.getOrCreatePlatformAccount(manager);

    await this.applyEntry(manager, params.vendorId, 'CREDIT', vendorPayout, 'VENDOR_PAYOUT', {
      referenceId: params.orderId,
      note: `Vendor payout after ${(rate * 100).toFixed(2)}% platform commission`,
    });
    await this.applyEntry(manager, params.riderId, 'CREDIT', riderPayout, 'RIDER_PAYOUT', {
      referenceId: params.orderId,
      note: 'Full delivery fee payout',
    });
    await this.applyEntry(manager, platform.id, 'CREDIT', commission, 'PLATFORM_COMMISSION', {
      referenceId: params.orderId,
      note: `Platform commission ${(rate * 100).toFixed(2)}%`,
    });

    // Subscription free-delivery: the student paid no delivery fee, but the
    // rider is still paid in full — the platform absorbs the fee. This DEBIT
    // keeps the ledger money-conserving and makes the subsidy cost explicit.
    if (opts.deliveryFeeCoveredByPlatform && feePesewas > 0) {
      await this.applyEntry(manager, platform.id, 'DEBIT', riderPayout, 'PLATFORM_DELIVERY_SUBSIDY', {
        referenceId: params.orderId,
        note: 'Delivery fee absorbed by platform (subscription free delivery)',
      });
    }

    console.log(
      `[SETTLED] order=${params.orderId} vendor=${vendorPayout} rider=${riderPayout} platform=${commission} (rate=${rate})`,
    );
    return { vendorPayout, riderPayout, commission, rate };
  }

  /**
   * Settles a delivered peer-to-peer delivery: there is no vendor and no
   * product total. The sender paid only the delivery fee; the platform takes
   * its commission rate out of the fee and the rider keeps the rest.
   */
  async settleP2pOrder(
    params: { orderId: string; riderId: string; deliveryFee: number },
    manager: EntityManager,
    opts: { deliveryFeeCoveredByPlatform?: boolean } = {},
  ) {
    const rate = this.getCommissionRate();
    const feePesewas = Math.round(Number(params.deliveryFee) * 100);
    const commissionPesewas = Math.round(feePesewas * rate);
    const riderPesewas = feePesewas - commissionPesewas;

    const platform = await this.getOrCreatePlatformAccount(manager);
    await this.applyEntry(manager, params.riderId, 'CREDIT', riderPesewas / 100, 'RIDER_PAYOUT', {
      referenceId: params.orderId,
      note: 'P2P delivery payout (fee minus platform commission)',
    });
    await this.applyEntry(manager, platform.id, 'CREDIT', commissionPesewas / 100, 'PLATFORM_COMMISSION', {
      referenceId: params.orderId,
      note: `Platform commission on P2P delivery fee ${(rate * 100).toFixed(2)}%`,
    });
    // STUDS Plus covered the sender: the platform funded the whole fee.
    if (opts.deliveryFeeCoveredByPlatform && feePesewas > 0) {
      await this.applyEntry(manager, platform.id, 'DEBIT', feePesewas / 100, 'PLATFORM_DELIVERY_SUBSIDY', {
        referenceId: params.orderId,
        note: 'P2P delivery fee absorbed by platform (subscription free delivery)',
      });
    }

    console.log(
      `[SETTLED P2P] order=${params.orderId} rider=${riderPesewas / 100} platform=${commissionPesewas / 100} (rate=${rate})`,
    );
    return { vendorPayout: 0, riderPayout: riderPesewas / 100, commission: commissionPesewas / 100, rate };
  }

  /**
   * Charges a subscription period to the user's wallet: SUBSCRIPTION debit
   * to the user, SUBSCRIPTION_REVENUE credit to the platform, atomically.
   * Throws on insufficient funds (respecting amounts reserved by pending
   * withdrawals), rolling the whole transaction back.
   */
  async chargeSubscription(userId: string, amount: number, planCode: string, action: 'subscribe' | 'renew', manager: EntityManager) {
    const pricePesewas = Math.round(Number(amount) * 100);
    if (pricePesewas <= 0) throw new BadRequestException('Subscription price must be positive');

    const availablePesewas = Math.round((await this.availableBalance(manager, userId)) * 100);
    if (availablePesewas < pricePesewas) {
      throw new BadRequestException('Insufficient wallet balance for subscription');
    }

    const platform = await this.getOrCreatePlatformAccount(manager);
    await this.applyEntry(manager, userId, 'DEBIT', pricePesewas / 100, 'SUBSCRIPTION', {
      referenceId: planCode,
      note: `Subscription ${action}: ${planCode}`,
    });
    await this.applyEntry(manager, platform.id, 'CREDIT', pricePesewas / 100, 'SUBSCRIPTION_REVENUE', {
      referenceId: planCode,
      note: `Subscription revenue: ${planCode}`,
    });
    console.log(`[SUBSCRIPTION CHARGED] user=${userId} plan=${planCode} amount=${pricePesewas / 100} (${action})`);
  }

  /**
   * Reverses a prior settlement, atomically. Used when a DELIVERED order is
   * disputed and refunded: the vendor/rider/platform credits are clawed back
   * with compensating DEBITs, so the ledger stays balanced.
   *
   * Settlement state is derived FROM THE LEDGER ITSELF (not from order
   * status): if VENDOR_PAYOUT / RIDER_PAYOUT / PLATFORM_COMMISSION entries
   * exist for the order, they are reversed at their EXACT recorded amounts
   * (never recomputed — the commission rate may have changed since).
   * Idempotent: if reversal entries already exist, this is a no-op.
   * If the order was never settled (disputed before delivery), no-op.
   *
   * Must be called inside the caller's transaction (shares the mutex).
   */
  async reverseSettlement(orderId: string, manager: EntityManager) {
    // Find the original settlement credits — plus the platform delivery
    // subsidy DEBIT (subscription free delivery), which reverses as a credit.
    const settlements = await manager.find(WalletTransaction, {
      where: [
        { referenceId: orderId, reason: 'VENDOR_PAYOUT' },
        { referenceId: orderId, reason: 'RIDER_PAYOUT' },
        { referenceId: orderId, reason: 'PLATFORM_COMMISSION' },
        { referenceId: orderId, reason: 'PLATFORM_DELIVERY_SUBSIDY' },
      ],
    });
    if (settlements.length === 0) {
      // Never settled (e.g. disputed while PICKED_UP) — nothing to claw back.
      console.log(`[SETTLEMENT REVERSAL] order=${orderId} — no settlement found, nothing to reverse`);
      return { reversed: false as const, entries: [] as string[] };
    }

    // Idempotency: never reverse twice.
    const existingReversals = await manager.find(WalletTransaction, {
      where: [
        { referenceId: orderId, reason: 'VENDOR_PAYOUT_REVERSAL' },
        { referenceId: orderId, reason: 'RIDER_PAYOUT_REVERSAL' },
        { referenceId: orderId, reason: 'PLATFORM_COMMISSION_REVERSAL' },
        { referenceId: orderId, reason: 'PLATFORM_DELIVERY_SUBSIDY_REVERSAL' },
      ],
    });
    if (existingReversals.length > 0) {
      console.log(`[SETTLEMENT REVERSAL] order=${orderId} — already reversed, skipping`);
      return { reversed: false as const, entries: [] as string[] };
    }

    const reversalReason: Record<string, TxReason> = {
      VENDOR_PAYOUT: 'VENDOR_PAYOUT_REVERSAL',
      RIDER_PAYOUT: 'RIDER_PAYOUT_REVERSAL',
      PLATFORM_COMMISSION: 'PLATFORM_COMMISSION_REVERSAL',
    };

    const entries: string[] = [];
    for (const s of settlements) {
      if (s.reason === 'PLATFORM_DELIVERY_SUBSIDY') {
        // The original entry was a DEBIT (platform absorbed the fee);
        // reversal credits it back.
        const entry = await this.applyEntry(manager, s.userId, 'CREDIT', Number(s.amount), 'PLATFORM_DELIVERY_SUBSIDY_REVERSAL', {
          referenceId: orderId,
          providerRef: s.id,
          note: 'Subsidy restored after dispute/refund',
        });
        entries.push(entry.id);
        continue;
      }
      const reason = reversalReason[s.reason];
      if (!reason) continue;
      // Claw back the EXACT amount that was credited.
      const entry = await this.applyEntry(manager, s.userId, 'DEBIT', Number(s.amount), reason, {
        referenceId: orderId,
        providerRef: s.id, // link to the original settlement entry
        note: `Clawback of ${s.reason} after dispute/refund`,
      });
      entries.push(entry.id);
    }

    console.log(
      `[SETTLEMENT REVERSED] order=${orderId} clawed back ${settlements.length} entries`,
    );
    return { reversed: true as const, entries };
  }

  // ---------- internals ----------

  /**
   * Funds tied up in PENDING/APPROVED withdrawals. Derived from the request
   * rows themselves — no cached column, so it can never drift.
   */
  private async reservedAmount(manager: EntityManager, userId: string): Promise<number> {
    const rows = await manager.find(Withdrawal, {
      where: { userId, status: In(['PENDING', 'APPROVED']) },
      select: ['amount'],
    });
    return rows.reduce((sum, r) => sum + Number(r.amount), 0);
  }

  /** Spendable balance: ledger balance minus reserved withdrawals. */
  private async availableBalance(manager: EntityManager, userId: string): Promise<number> {
    const user = await manager.findOne(User, { where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const reserved = await this.reservedAmount(manager, userId);
    return Math.round(((Number(user.balance) || 0) - reserved) * 100) / 100;
  }

  /**
   * Post one immutable ledger entry and move the cached balance in the same
   * DB transaction. Never called outside a transaction.
   */
  private async applyEntry(
    manager: EntityManager,
    userId: string,
    type: 'CREDIT' | 'DEBIT',
    amount: number,
    reason: TxReason,
    opts: { referenceId?: string; provider?: string; providerRef?: string; note?: string } = {},
  ): Promise<WalletTransaction> {
    const user = await manager.findOne(User, { where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const current = Number(user.balance) || 0;
    const next = Math.round((type === 'CREDIT' ? current + amount : current - amount) * 100) / 100;

    const entry = manager.create(WalletTransaction, {
      userId,
      type,
      amount,
      reason,
      referenceId: opts.referenceId || null,
      provider: opts.provider || null,
      providerRef: opts.providerRef || null,
      balanceAfter: next,
      note: opts.note || null,
    });
    await manager.save(entry);

    user.balance = next;
    await manager.save(user);
    return entry;
  }
}
