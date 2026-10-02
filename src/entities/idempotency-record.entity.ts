import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One row per client-supplied Idempotency-Key on a money endpoint.
 * Inserted as PENDING before the handler runs (so concurrent duplicates
 * cannot both execute), then completed with the exact response body —
 * a replayed key returns the original result instead of charging twice.
 */
@Entity('idempotency_record')
@Index(['userId', 'scope', 'key'], { unique: true })
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  /** e.g. "POST /wallet/topup" */
  @Column()
  scope: string;

  @Column()
  key: string;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'COMPLETED' = 'PENDING';

  @Column({ type: 'text', nullable: true })
  responseBody: string;

  @CreateDateColumn()
  createdAt: Date;
}
