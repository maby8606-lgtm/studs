import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Every provider webhook we receive, recorded BEFORE processing.
 * The unique dedupeKey makes duplicate / replayed deliveries harmless:
 * the second insert fails and the event is skipped, so a charge can never
 * credit the ledger twice.
 */
@Entity('webhook_event')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  provider: string;

  /** Raw provider event name, e.g. 'charge.success'. */
  @Column()
  eventType: string;

  /**
   * Idempotency key. Provider event id when supplied, otherwise a
   * deterministic '<eventType>:<reference>' fallback (references are unique
   * per attempt/transfer, so this is collision-safe in practice).
   */
  @Index({ unique: true })
  @Column()
  dedupeKey: string;

  /** Charge reference or transfer code this event is about. */
  @Column({ nullable: true })
  reference: string;

  @Column({ default: 'RECEIVED' })
  status: 'RECEIVED' | 'PROCESSED' | 'SKIPPED' | 'FAILED';

  @Column({ nullable: true })
  error: string;

  /** Number of times a FAILED delivery has been retried. */
  @Column({ default: 0 })
  retryCount: number;

  /** Most recent processing error, kept after a successful retry for audit. */
  @Column({ nullable: true })
  lastError: string;

  @CreateDateColumn()
  receivedAt: Date;

  @Column({ nullable: true })
  processedAt: Date;
}
