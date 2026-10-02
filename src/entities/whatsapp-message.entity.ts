import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * WhatsApp outbox/inbox record. Every WhatsApp message in either direction
 * is written here, mirroring the sms_message audit pattern: what was said,
 * to/from whom, via which provider, and whether it actually left the system.
 */
@Entity('whatsapp_message')
export class WhatsappMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  phone: string;

  /** IN = from the customer, OUT = from STUDS. */
  @Column()
  direction: 'IN' | 'OUT';

  @Column('text')
  body: string;

  /** log | cloud */
  @Column()
  provider: string;

  /** LOGGED (no gateway configured), SENT, FAILED, RECEIVED */
  @Column()
  status: 'LOGGED' | 'SENT' | 'FAILED' | 'RECEIVED';

  @Column({ nullable: true })
  providerRef: string;

  @CreateDateColumn()
  createdAt: Date;
}
