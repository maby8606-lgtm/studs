import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrdersService } from './orders.service';

/**
 * Sweeps PENDING orders the vendor never accepted and auto-cancels them
 * with a full student refund.
 *
 * - Runs every minute; timeout configurable via VENDOR_ACCEPT_TIMEOUT_MINUTES
 *   (default 30). Set to 0 to disable the sweeper.
 * - Each cancel is atomic (status + ORDER_REFUND in one mutex-guarded
 *   transaction) and race-safe: if the vendor accepts between the scan and
 *   the cancel, the in-transaction status re-check aborts that order.
 * - All actions are logged with the [AUTO-CANCEL] prefix for audit.
 */
@Injectable()
export class OrderTimeoutService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
  ) {}

  private getTimeoutMinutes(): number {
    const raw = this.configService.get<string>('VENDOR_ACCEPT_TIMEOUT_MINUTES');
    if (raw === undefined || raw === '') return 30;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      console.warn(
        `[AUTO-CANCEL] Invalid VENDOR_ACCEPT_TIMEOUT_MINUTES=${JSON.stringify(raw)} — sweeper disabled`,
      );
      return 0;
    }
    return n;
  }

  @Cron('*/1 * * * *')
  async sweepTimedOutOrders() {
    const timeoutMinutes = this.getTimeoutMinutes();
    if (timeoutMinutes <= 0) return; // disabled

    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const expired = await this.ordersRepository.find({
      where: { status: 'PENDING', createdAt: LessThan(cutoff) },
      select: ['id', 'createdAt'],
    });
    if (expired.length === 0) return;

    console.log(
      `[AUTO-CANCEL] sweep: ${expired.length} PENDING order(s) exceeded ${timeoutMinutes}m timeout`,
    );
    for (const o of expired) {
      try {
        const cancelled = await this.ordersService.autoCancelTimedOutOrder(o.id, timeoutMinutes);
        if (!cancelled) {
          console.log(`[AUTO-CANCEL] order=${o.id} no longer PENDING — skipped`);
        }
      } catch (err) {
        // One bad order must not stop the sweep; it will be retried next minute.
        console.error(`[AUTO-CANCEL] order=${o.id} failed: ${(err as Error).message}`);
      }
    }
  }
}
