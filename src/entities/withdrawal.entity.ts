import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Withdrawal request. Per Master Doc §4/§7, withdrawals require a manual
 * approval workflow: a user requests, an admin approves or rejects.
 *
 * Money lifecycle (provider-backed):
 *  PENDING   — requested; amount is RESERVED (not spendable) but not debited.
 *  APPROVED  — admin approved AND provider transfer initiated (transferCode set).
 *  COMPLETED — provider confirmed the money arrived; WITHDRAWAL debit posted.
 *  FAILED    — provider transfer failed/reversed; reservation released, no debit.
 *  REJECTED  — admin rejected; reservation released, no debit.
 *
 * Reservation is derived, never a cached column: available balance =
 * user.balance − SUM(amount of PENDING/APPROVED withdrawals). A withdrawal
 * stops reserving the moment it leaves PENDING/APPROVED, so reservations
 * can never drift from the request rows.
 */
@Entity('withdrawal')
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  /** Destination mobile-money number. */
  @Column()
  momoNumber: string;

  /** Provider-neutral network: MTN | VODAFONE | AIRTEL_TIGO */
  @Column({ nullable: true })
  network: string;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED';

  @Column({ nullable: true })
  reviewedBy: string;

  @Column({ nullable: true })
  reviewedAt: Date;

  @Column({ nullable: true })
  reviewNote: string;

  // ---- provider payout tracking ----

  /**
   * Our idempotency key for this payout, generated at approval time BEFORE
   * any provider call. Passed to the gateway as its transfer reference, so:
   * - a retry after a network timeout can't create a duplicate transfer
   *   (the gateway rejects duplicate references), and
   * - transfer webhooks can be matched even if we never learned the
   *   gateway's transfer code (timeout between send and response).
   */
  @Index({ unique: true })
  @Column({ nullable: true })
  providerReference: string;

  /** Provider-side recipient identifier (created once per MoMo number). */
  @Column({ nullable: true })
  recipientCode: string;

  /** Provider-side transfer identifier. Set exactly once — re-approval or
   *  retry never initiates a second transfer while this is set. */
  @Index({ unique: true })
  @Column({ nullable: true })
  transferCode: string;

  @Column({ default: 'NOT_SENT' })
  transferStatus: 'NOT_SENT' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';

  @Column({ nullable: true })
  failureReason: string;

  @Column({ nullable: true })
  sentAt: Date;

  @Column({ nullable: true })
  completedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
