import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RateLimit } from '../common/rate-limit.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { UseInterceptors } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get()
  async getWallet(@Req() req) {
    return this.walletService.getWallet(req.user.sub);
  }

  @Get('transactions')
  async getTransactions(@Req() req) {
    return this.walletService.getTransactions(req.user.sub);
  }

  /**
   * Start a MoMo top-up via the configured payment provider.
   * Body: { amount, momoNumber, network } — network is MTN | VODAFONE | AIRTEL_TIGO.
   * Creates NO ledger entry — the wallet is credited only after a verified
   * provider webhook confirms the money moved. The customer approves the
   * charge on their phone (or submits the OTP for Telecel).
   */
  @Post('topup')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60)
  @UseInterceptors(IdempotencyInterceptor)
  async initiateTopUp(
    @Req() req,
    @Body() body: { amount: number; momoNumber: string; network: string },
  ) {
    return this.walletService.initiateTopUp(req.user.sub, body.amount, body.momoNumber, body.network);
  }

  /** Submit the OTP/voucher for a top-up that requires it (e.g. Telecel). */
  @Post('topup/:attemptId/otp')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60)
  async submitTopUpOtp(
    @Req() req,
    @Param('attemptId') attemptId: string,
    @Body() body: { otp: string },
  ) {
    return this.walletService.submitTopUpOtp(req.user.sub, attemptId, body.otp);
  }

  /** Poll the status of your own top-up attempt. */
  @Get('topup/:attemptId')
  async getTopUpAttempt(@Req() req, @Param('attemptId') attemptId: string) {
    return this.walletService.getTopUpAttempt(req.user.sub, attemptId);
  }

  /** Ask the provider for the authoritative status of a stuck top-up. */
  @Post('topup/:attemptId/reconcile')
  async reconcileTopUp(@Req() req, @Param('attemptId') attemptId: string) {
    return this.walletService.reconcileTopUp(req.user.sub, attemptId);
  }

  @Post('withdraw')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 3600)
  @UseInterceptors(IdempotencyInterceptor)
  async requestWithdrawal(
    @Req() req,
    @Body() body: { amount: number; momoNumber: string; network?: string },
  ) {
    return this.walletService.requestWithdrawal(req.user.sub, body.amount, body.momoNumber, body.network);
  }

  @Get('withdrawals')
  async getMyWithdrawals(@Req() req) {
    return this.walletService.getWithdrawals(req.user.sub);
  }

  // ---- scheduled auto-payouts (Go 2) ----

  /** Saved MoMo destination used by the daily rider auto-payout. */
  @Get('payout-destination')
  async getPayoutDestination(@Req() req) {
    return this.walletService.getPayoutDestination(req.user.sub);
  }

  @Patch('payout-destination')
  async setPayoutDestination(@Req() req, @Body() body: { momoNumber: string; network?: string }) {
    return this.walletService.setPayoutDestination(req.user.sub, body.momoNumber, body.network);
  }

  /** Manually trigger one scheduled-payout run (the daily cron calls this too). */
  @Post('admin/run-rider-payouts')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async runRiderPayouts() {
    return this.walletService.runScheduledRiderPayouts();
  }

  /** Ledger-backed earnings summary (vendors and riders). */
  @Get('earnings')
  async getEarnings(@Req() req) {
    return this.walletService.getEarningsSummary(req.user.sub);
  }

  // ---- admin: manual withdrawal approvals (Master Doc §4/§7) ----

  @Get('admin/withdrawals')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getAllWithdrawals(@Query('status') status?: string) {
    return this.walletService.getAllWithdrawals(status);
  }

  @Patch('admin/withdrawals/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async reviewWithdrawal(
    @Param('id') id: string,
    @Req() req,
    @Body() body: { status: 'APPROVED' | 'REJECTED'; reviewNote?: string },
  ) {
    return this.walletService.reviewWithdrawal(id, req.user.sub, body.status, body.reviewNote);
  }

  /** Finalize a stuck payout from the provider's authoritative status. */
  @Post('admin/withdrawals/:id/reconcile')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async reconcileWithdrawal(@Param('id') id: string) {
    return this.walletService.reconcileWithdrawal(id);
  }

  /** Retry a transfer initiation that timed out (reuses the same reference). */
  @Post('admin/withdrawals/:id/retry')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async retryWithdrawal(@Param('id') id: string) {
    return this.walletService.retryWithdrawalTransfer(id);
  }
}
