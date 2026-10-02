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

  // Vendor is registered as User (role = VENDOR)
  @ManyToOne(() => User)
  vendor: User;

  @Column()
  vendorId: string;

  @Column()
  campusId: string;

  @Column()
  serviceType: 'FOOD' | 'PACKAGE' | 'DOCUMENT' | 'GROCERY' | 'OTHER' = 'FOOD';

  @Column()
  pickupLocation: string;

  @Column()
  deliveryLocation: string;

  @Column('decimal', { precision: 10, scale: 2 })
  productTotal: number;

  @Column('decimal', { precision: 10, scale: 2 })
  deliveryFee: number;

  @Column('decimal', { precision: 10, scale: 2 })
  total: number;

  @Column()
  status: 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'DISPUTED' | 'CANCELLED' | 'REFUNDED' | 'RESOLVED' = 'ASSIGNED';

  @Column({ nullable: true })
  assignedRiderId: string;

  @Column({ nullable: true })
  qrCode: string;

  @Column({ nullable: true })
  pickedAt: Date;

  @Column({ nullable: true })
  deliveredAt: Date;

  @Column({ nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => OrderItem, orderItem => orderItem.order, { cascade: true })
  orderItems: OrderItem[];
}