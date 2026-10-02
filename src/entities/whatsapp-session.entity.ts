import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Conversation state for WhatsApp text ordering, keyed by the customer's
 * normalized phone number (233…). Holds the multi-step flow state
 * (e.g. items chosen, awaiting a delivery-zone reply) as JSON in `context`.
 */
@Entity('whatsapp_session')
export class WhatsappSession {
  @PrimaryColumn()
  phone: string;

  @Column({ nullable: true })
  userId: string;

  /** IDLE | AWAITING_ZONE */
  @Column({ default: 'IDLE' })
  step: string;

  @Column('text', { nullable: true })
  context: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
