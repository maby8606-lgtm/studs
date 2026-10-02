import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type FraudFlagType =
  | 'SMS_CODE_EXHAUSTED'
  | 'DISPUTE_OPENED'
  | 'LARGE_WITHDRAWAL'
  | 'REPEATED_CANCELLATIONS';

export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * A fraud/abuse signal for admin review. Recording a flag never blocks the
 * money operation that produced it — it exists so a human can look.
 */
@Entity('fraud_flag')
export class FraudFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  type: FraudFlagType;

  @Column({ default: 'LOW' })
  severity: FraudSeverity = 'LOW';

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  orderId: string;

  @Column({ type: 'text' })
  detail: string;

  @Column({ default: 'OPEN' })
  status: 'OPEN' | 'RESOLVED' = 'OPEN';

  @Column({ nullable: true })
  resolvedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
