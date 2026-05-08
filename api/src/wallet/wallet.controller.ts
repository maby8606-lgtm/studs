import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';

@Controller('wallet')
export class WalletController {
  constructor(private authService: AuthService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  getBalance(@Req() req) {
    const wallet = this.authService.getWallet(req.user.sub);
    return {
      balance: wallet ? wallet.balance : 0,
      currency: "GHS"
    };
  }
}
