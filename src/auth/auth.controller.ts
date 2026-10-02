import { Controller, Post, Body, Patch, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RateLimit } from '../common/rate-limit.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60)
  register(@Body() dto: any) {
    return this.authService.register(dto);
  }

  /**
   * Admin-only admin creation. Public registration can never produce an ADMIN;
   * an existing administrator's token is required here.
   */
  @Post('admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createAdmin(@Body() dto: { email: string; password: string; name?: string; campusId?: string }) {
    return this.authService.createAdmin(dto);
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60, { byBodyField: 'email' })
  login(@Body() dto: any) {
    return this.authService.login(dto);
  }

  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  updateProfile(@Req() req: any, @Body() body: { name?: string; phone?: string; campusId?: string }) {
    const userId = req.user.sub;
    return this.authService.updateProfile(userId, body);
  }
}