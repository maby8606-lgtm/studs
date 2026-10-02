import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A user subscription (Master Doc §1/§6 — Subscription Engine).
 *
 * The subscription is paid from the wallet balance: subscribe/renew post a
 * SUBSCRIPTION debit to the user and a SUBSCRIPTION_REVENUE credit to the
 * platform account, so the money is fully on the immutable ledger.
 *
 * Status flow:
 *   ACTIVE --(period ends, autoRenew, funded)--> ACTIVE (new period)
 *   ACTIVE --(period ends, autoRenew, insufficient)--> PAST_DUE
 *   PAST_DUE --(funded within grace)--> ACTIVE
 *   PAST_DUE --(grace exhausted)--> EXPIRED
 *   ACTIVE --(user cancels)--> CANCELLED (benefits run to period end,
 *                               then the sweeper moves it to EXPIRED)
 */
@Entity('subscription')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  /** STUDENT_PLUS | VENDOR_PRO */
  @Column()
  planCode: string;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column()
  currentPeriodStart: Date;

  @Column()
  currentPeriodEnd: Date;

  /**
   * Rotated on every subscribe/renew. Orders that consumed free delivery
   * record this key, so per-period quota counts are exact — no fragile
   * timestamp-window comparisons.
   */
  @Column({ nullable: true })
  currentPeriodKey: string;

  @Column({ default: true })
  autoRenew: boolean;

  /** When the current PAST_DUE spell began (grace clock); null otherwise. */
  @Column({ nullable: true })
  pastDueSince: Date;

  @Column({ nullable: true })
  cancelledAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
