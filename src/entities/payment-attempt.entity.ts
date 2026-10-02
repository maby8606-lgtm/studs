import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * A customer top-up attempt. Money is credited to the immutable ledger ONLY
 * when a verified provider webhook (or verified status poll) confirms the
 * charge succeeded. Initiation alone never moves money.
 */
@Entity('payment_attempt')
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  /** Integer minor units (pesewas). No floats anywhere in money code. */
  @Column('int')
  amountMinor: number;

  @Column({ default: 'GHS' })
  currency: string;

  /** Which PaymentProvider implementation handled this. */
  @Column({ default: 'paystack' })
  provider: string;

  /** Unique reference shared with the provider; webhooks match on this. */
  @Index({ unique: true })
  @Column()
  providerReference: string;

  @Column({ default: 'INITIATED' })
  status: 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

  /** Hosted-checkout URL, when the provider flow uses one. */
  @Column({ nullable: true })
  authorizationUrl: string;

  @Column({ nullable: true })
  accessCode: string;

  /** Provider-neutral network the customer chose, if any. */
  @Column({ nullable: true })
  network: string;

  @Column({ nullable: true })
  failureReason: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  completedAt: Date;
}
