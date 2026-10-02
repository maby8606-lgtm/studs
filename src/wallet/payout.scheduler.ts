import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletService } from './wallet.service';

/**
 * Daily rider auto-payout — 18:00 Africa/Accra (== GMT).
 * The run itself lives in WalletService.runScheduledRiderPayouts; this is
 * only the clock. Admins can trigger the same run manually via
 * POST /wallet/admin/run-rider-payouts.
 */
@Injectable()
export class PayoutScheduler {
  constructor(private readonly walletService: WalletService) {}

  @Cron('0 18 * * *')
  async dailyRiderPayouts() {
    const summary = await this.walletService.runScheduledRiderPayouts();
    console.log(
      `[AUTO-PAYOUT CRON] enabled=${summary.enabled} paid=${summary.paid.length} skipped=${summary.skipped.length}`,
    );
  }
}
