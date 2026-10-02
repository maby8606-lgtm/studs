import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * SMS outbox record. Every SMS the system attempts is written here first, so
 * there is always an audit trail of what was sent to whom, via which
 * provider, and whether the provider accepted it.
 */
@Entity('sms_message')
export class SmsMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  phone: string;

  @Column('text')
  message: string;

  /** log | arkesel */
  @Column()
  provider: string;

  /** LOGGED (no gateway configured), SENT, FAILED */
  @Column()
  status: 'LOGGED' | 'SENT' | 'FAILED';

  @Column({ nullable: true })
  providerRef: string;

  @CreateDateColumn()
  createdAt: Date;
}
