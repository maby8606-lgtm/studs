import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Order } from './order.entity';
import { MenuItem } from './menu-item.entity';

@Entity('order_item')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, order => order.orderItems)
  order: Order;

  @Column()
  orderId: string;

  @ManyToOne(() => MenuItem, menuItem => menuItem.orderItems)
  menuItem: MenuItem;

  @Column()
  menuItemId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  priceAtTime: number;

  @Column({ default: 1 })
  quantity: number;

  @Column({ nullable: true })
  createdAt: Date;
}