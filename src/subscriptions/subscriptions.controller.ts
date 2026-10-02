import { Controller, Get, Post, Body, UseGuards, UseInterceptors, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RateLimit } from '../common/rate-limit.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  plans() {
    return this.subscriptionsService.listPlans();
  }

  @Get('me')
  me(@Request() req: any) {
    return this.subscriptionsService.getMine(req.user.sub);
  }

  @Post('subscribe')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60)
  @UseInterceptors(IdempotencyInterceptor)
  subscribe(@Body() dto: any, @Request() req: any) {
    return this.subscriptionsService.subscribe(
      { sub: req.user.sub, role: req.user.role },
      dto?.planCode,
    );
  }

  @Post('cancel')
  cancel(@Request() req: any) {
    return this.subscriptionsService.cancel(req.user.sub);
  }
}
