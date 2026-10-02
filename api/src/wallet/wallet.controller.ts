import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';

@Controller('wallet')
export class WalletController {
  constructor(private authService: AuthService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getWallet(@Req() req) {
    const wallet = await this.authService.getWallet(req.user.sub); // or req.user.userId if needed
    return wallet || { balance: 0, currency: 'GHS' };
  }
}