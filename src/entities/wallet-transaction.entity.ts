import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Immutable wallet ledger entry (Master Doc §4 — Financial Integrity Model).
 *
 * Balance = SUM(Credits) - SUM(Debits). Rows are INSERT-only: the API never
 * updates or deletes them. `User.balance` is a write-through cache updated
 * in the same DB transaction as the ledger insert, so the two cannot drift.
 */
@Entity('wallet_transaction')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  type: 'CREDIT' | 'DEBIT';

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  /** TOPUP | WITHDRAWAL | ORDER_PAYMENT | ORDER_REFUND | RIDER_PAYOUT | COMMISSION */
  @Column()
  reason: string;

  /** Related record id (order id, withdrawal id, …) when applicable. */
  @Column({ nullable: true })
  referenceId: string;

  /** SIMULATED for now; 'MTN_MOMO' etc. once a real provider is wired. */
  @Column({ nullable: true })
  provider: string;

  /** Provider-side reference (MoMo transaction id) for reconciliation. */
  @Column({ nullable: true })
  providerRef: string;

  /** Balance snapshot immediately after this entry posted. */
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  balanceAfter: number;

  @Column({ nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;
}
