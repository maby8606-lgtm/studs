import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Persisted rider shift. Replaces the old in-memory Map so clock-in state
 * survives restarts and rider assignment can query who's actually on duty.
 */
@Entity('rider_shift')
export class RiderShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  riderId: string;

  @Column()
  clockInTime: Date;

  @Column({ nullable: true })
  clockOutTime: Date;

  @Column({ default: 'ON_DUTY' })
  status: 'ON_DUTY' | 'OFF_DUTY';

  @Column({ default: 0 })
  ordersCompleted: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  totalEarned: number;

  @CreateDateColumn()
  createdAt: Date;
}
