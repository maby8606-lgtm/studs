import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { Subscription } from '../entities/subscription.entity';
import { Order } from '../entities/order.entity';
import { WalletService } from '../wallet/wallet.service';
import { LedgerMutex } from '../common/ledger-mutex';

export interface SubscriptionPlan {
  code: string;
  audience: 'STUDENT' | 'VENDOR';
  name: string;
  priceGHS: number;
  periodDays: number;
  benefits: string[];
  /** Free (platform-covered) deliveries per period — student plans. */
  freeDeliveriesPerPeriod?: number;
  /** Platform commission rate while active — vendor plans. */
  commissionRate?: number;
}

/**
 * Plan catalog (Master Doc §1 — Subscription Engine). Prices/benefits are
 * product decisions, so they live in one place and are served to the
 * frontend via GET /subscriptions/plans — never hard-coded in the UI.
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    code: 'STUDENT_PLUS',
    audience: 'STUDENT',
    name: 'STUDS Plus',
    priceGHS: 15,
    periodDays: 30,
    freeDeliveriesPerPeriod: 10,
    benefits: ['10 free deliveries every 30 days (delivery fee on us)', 'Priority rider assignment windows'],
  },
  {
    code: 'VENDOR_PRO',
    audience: 'VENDOR',
    name: 'STUDS Pro',
    priceGHS: 60,
    periodDays: 30,
    commissionRate: 0.08,
    benefits: ['Commission drops from 15% to 8% on every order', 'Access to the subscription-customer base'],
  },
];

export function findPlan(code: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.code === code);
}

const GRACE_DAYS = 3;

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionsRepository: Repository<Subscription>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly ledgerMutex: LedgerMutex,
  ) {}

  listPlans() {
    return SUBSCRIPTION_PLANS;
  }

  /** The user's live (benefit-bearing) subscription, if any. */
  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const sub = await this.subscriptionsRepository.findOne({
      where: { userId, status: 'ACTIVE' },
      order: { createdAt: 'DESC' },
    });
    if (!sub) return null;
    if (new Date(sub.currentPeriodEnd).getTime() <= Date.now()) return null;
    return sub;
  }

  /** Effective commission rate for a vendor, or null for the default rate. */
  async getVendorCommissionRate(vendorId: string): Promise<number | null> {
    const sub = await this.getActiveSubscription(vendorId);
    if (!sub) return null;
    const plan = findPlan(sub.planCode);
    return plan?.commissionRate ?? null;
  }

  /**
   * Whether the student's next delivery fee should be waived: active
   * STUDENT_PLUS and the per-period free-delivery quota not exhausted.
   * Quota use is counted FROM THE ORDERS TABLE (deliveryFeeWaived flag),
   * never from a mutable counter, so it cannot drift.
   */
  async studentFreeDeliveryStatus(studentId: string): Promise<{ waived: boolean; subscriptionId?: string; periodKey?: string }> {
    const sub = await this.getActiveSubscription(studentId);
    if (!sub) return { waived: false };
    const plan = findPlan(sub.planCode);
    if (!plan?.freeDeliveriesPerPeriod) return { waived: false };
    const used = await this.dataSource.getRepository(Order).count({
      where: {
        studentId,
        deliveryFeeWaived: true,
        subscriptionPeriodKey: sub.currentPeriodKey,
      },
    });
    return { waived: used < plan.freeDeliveriesPerPeriod, subscriptionId: sub.id, periodKey: sub.currentPeriodKey };
  }

  async subscribe(user: { sub: string; role: string }, planCode: string) {
    const plan = findPlan(planCode);
    if (!plan) throw new BadRequestException(`Unknown plan: ${planCode}`);
    if (user.role !== plan.audience) {
      throw new BadRequestException(`${plan.name} is only available to ${plan.audience.toLowerCase()} accounts`);
    }
    const existing = await this.subscriptionsRepository.findOne({
      where: { userId: user.sub, status: In(['ACTIVE', 'PAST_DUE']) },
    });
    if (existing) {
      throw new BadRequestException('You already have a subscription. Cancel it before switching plans.');
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + plan.periodDays * 24 * 60 * 60 * 1000);

    const sub = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
        await this.walletService.chargeSubscription(user.sub, plan.priceGHS, plan.code, 'subscribe', manager);
        const created = manager.create(Subscription, {
          userId: user.sub,
          planCode: plan.code,
          status: 'ACTIVE' as const,
          price: plan.priceGHS,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          currentPeriodKey: crypto.randomUUID(),
          autoRenew: true,
        });
        return manager.save(created);
      }),
    );

    console.log(`[SUBSCRIPTION STARTED] user=${user.sub} plan=${plan.code} until=${periodEnd.toISOString()}`);
    return this.toView(sub);
  }

  async cancel(userId: string) {
    const sub = await this.getActiveSubscription(userId);
    if (!sub) throw new NotFoundException('No active subscription to cancel');
    sub.autoRenew = false;
    sub.status = 'CANCELLED';
    sub.cancelledAt = new Date();
    await this.subscriptionsRepository.save(sub);
    console.log(`[SUBSCRIPTION CANCELLED] user=${userId} plan=${sub.planCode} benefits until ${sub.currentPeriodEnd}`);
    return this.toView(sub);
  }

  async getMine(userId: string) {
    const subs = await this.subscriptionsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    const current = subs[0] ? this.toView(subs[0]) : null;
    let freeDeliveries: { used: number; total: number; remaining: number } | null = null;
    if (subs[0] && subs[0].status === 'ACTIVE') {
      const plan = findPlan(subs[0].planCode);
      if (plan?.freeDeliveriesPerPeriod) {
        const used = await this.dataSource.getRepository(Order).count({
          where: {
            studentId: userId,
            deliveryFeeWaived: true,
            subscriptionPeriodKey: subs[0].currentPeriodKey,
          },
        });
        freeDeliveries = {
          used,
          total: plan.freeDeliveriesPerPeriod,
          remaining: Math.max(0, plan.freeDeliveriesPerPeriod - used),
        };
      }
    }
    return { current, freeDeliveries, history: subs.map((s) => this.toView(s)) };
  }

  private toView(sub: Subscription) {
    const plan = findPlan(sub.planCode);
    return {
      id: sub.id,
      planCode: sub.planCode,
      planName: plan?.name || sub.planCode,
      status: sub.status,
      priceGHS: Number(sub.price).toFixed(2),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      autoRenew: sub.autoRenew,
      benefits: plan?.benefits || [],
    };
  }

  // ---------- renewal sweeper ----------

  /**
   * Hourly: renew ACTIVE subscriptions whose period ended, expire CANCELLED
   * ones, retry PAST_DUE within the grace window, expire past it.
   * Every money movement goes through chargeSubscription (atomic, on-ledger);
   * a renewal that cannot be paid moves to PAST_DUE instead of silently
   * taking benefits for free.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processRenewals() {
    const now = new Date();
    const due = await this.subscriptionsRepository.find({
      where: [
        { status: 'ACTIVE', currentPeriodEnd: LessThanOrEqual(now) },
        { status: 'CANCELLED' },
        { status: 'PAST_DUE' },
      ],
    });
    for (const sub of due) {
      try {
        if (sub.status === 'CANCELLED' && new Date(sub.currentPeriodEnd) <= now) {
          sub.status = 'EXPIRED';
          await this.subscriptionsRepository.save(sub);
          console.log(`[SUBSCRIPTION EXPIRED] id=${sub.id} (cancelled, period ended)`);
        } else if (sub.status === 'ACTIVE' && new Date(sub.currentPeriodEnd) <= now) {
          await this.renew(sub, now);
        } else if (sub.status === 'PAST_DUE') {
          const since = sub.pastDueSince ? new Date(sub.pastDueSince) : now;
          if (now.getTime() - since.getTime() > GRACE_DAYS * 24 * 60 * 60 * 1000) {
            sub.status = 'EXPIRED';
            await this.subscriptionsRepository.save(sub);
            console.log(`[SUBSCRIPTION EXPIRED] id=${sub.id} (grace exhausted)`);
          } else {
            await this.renew(sub, now);
          }
        }
      } catch (err) {
        console.error(`[SUBSCRIPTION SWEEP] failed for ${sub.id}: ${(err as Error).message}`);
      }
    }
  }

  private async renew(sub: Subscription, now: Date) {
    const plan = findPlan(sub.planCode);
    if (!plan) return;
    try {
      const periodStart = sub.status === 'PAST_DUE' ? now : new Date(sub.currentPeriodEnd);
      const periodEnd = new Date(periodStart.getTime() + plan.periodDays * 24 * 60 * 60 * 1000);
      await this.ledgerMutex.run(() =>
        this.dataSource.transaction(async (manager) => {
          await this.walletService.chargeSubscription(sub.userId, plan.priceGHS, plan.code, 'renew', manager);
          sub.status = 'ACTIVE';
          sub.currentPeriodStart = periodStart;
          sub.currentPeriodEnd = periodEnd;
          sub.currentPeriodKey = crypto.randomUUID();
          sub.pastDueSince = null;
          await manager.save(sub);
        }),
      );
      console.log(`[SUBSCRIPTION RENEWED] id=${sub.id} plan=${plan.code} until=${sub.currentPeriodEnd}`);
    } catch (err) {
      // Insufficient funds (or any charge failure): PAST_DUE + grace window.
      sub.status = 'PAST_DUE';
      if (!sub.pastDueSince) sub.pastDueSince = now;
      await this.subscriptionsRepository.save(sub);
      console.log(`[SUBSCRIPTION PAST DUE] id=${sub.id}: ${(err as Error).message}`);
    }
  }
}
