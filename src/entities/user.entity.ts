import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  role: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  campusId: string;

  /** Saved MoMo destination for scheduled auto-payouts (riders). */
  @Column({ nullable: true })
  payoutMomoNumber: string;

  @Column({ nullable: true })
  payoutNetwork: string;

  @Column('decimal', { default: 0 })
  balance: number;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Order, order => order.student)
  orders: Order[];
}