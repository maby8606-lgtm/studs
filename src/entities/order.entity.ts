import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

@Entity('order')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.orders)
  student: User;

  @Column()
  studentId: string;

  // Vendor is registered as User (role = VENDOR).
  // Null for peer-to-peer deliveries (no vendor involved).
  @ManyToOne(() => User, { nullable: true })
  vendor: User;

  @Column({ nullable: true })
  vendorId: string;

  /** VENDOR = marketplace order; P2P = peer-to-peer send/errand delivery. */
  @Column({ default: 'VENDOR' })
  orderType: 'VENDOR' | 'P2P' = 'VENDOR';

  @Column()
  campusId: string;

  @Column()
  serviceType: 'FOOD' | 'PACKAGE' | 'DOCUMENT' | 'GROCERY' | 'OTHER' = 'FOOD';

  @Column()
  pickupLocation: string;

  @Column()
  deliveryLocation: string;

  /** Delivery-zone ids (see delivery-zones.ts) — the fee is priced from these. */
  @Column({ nullable: true })
  pickupZone: string;

  @Column({ nullable: true })
  deliveryZone: string;

  @Column('decimal', { precision: 10, scale: 2 })
  productTotal: number;

  @Column('decimal', { precision: 10, scale: 2 })
  deliveryFee: number;

  /**
   * True when a student subscription covered this delivery fee (the rider is
   * still paid in full; the platform absorbs the fee at settlement).
   */
  @Column({ default: false })
  deliveryFeeWaived: boolean;

  /** Subscription period key that paid for the waiver (quota accounting). */
  @Column({ nullable: true })
  subscriptionPeriodKey: string;

  /** P2P: what is being sent (e.g. "A4 documents", "charger"). */
  @Column({ nullable: true })
  itemDescription: string;

  /** P2P: phone of the person receiving the item. */
  @Column({ nullable: true })
  recipientPhone: string;

  @Column('decimal', { precision: 10, scale: 2 })
  total: number;

  @Column()
  status:
    | 'PENDING'
    | 'ASSIGNED'
    | 'PICKED_UP'
    | 'DELIVERED'
    | 'DISPUTED'
    | 'CANCELLED'
    | 'REFUNDED'
    | 'RESOLVED' = 'PENDING';

  @Column({ nullable: true })
  assignedRiderId: string;

  @Column({ nullable: true })
  qrCode: string;

  @Column({ nullable: true })
  pickedAt: Date;

  @Column({ nullable: true })
  deliveredAt: Date;

  /** When the order moved to ASSIGNED (vendor accept / P2P rider assignment). */
  @Column({ nullable: true })
  assignedAt: Date;

  /** When the order was cancelled (student, vendor, or accept-timeout sweep). */
  @Column({ nullable: true })
  cancelledAt: Date;

  @Column({ nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => OrderItem, orderItem => orderItem.order, { cascade: true })
  orderItems: OrderItem[];
}