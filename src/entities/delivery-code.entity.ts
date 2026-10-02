import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One delivery-confirmation SMS code for an order (SMS fallback for the QR
 * flow, Master Doc §5). Only the SHA-256 hash of the code is stored — the
 * plaintext exists only in the SMS itself and the student's hand.
 */
@Entity('delivery_code')
export class DeliveryCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  orderId: string;

  @Column()
  codeHash: string;

  @Column()
  expiresAt: Date;

  @Column({ default: 0 })
  attempts: number;

  @Column({ default: 5 })
  maxAttempts: number;

  /** Set when the code is consumed or superseded by a newer code. */
  @Column({ nullable: true })
  usedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
