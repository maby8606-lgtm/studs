import { Controller, Post, Body, Param, UseGuards, Req, Get } from 
'@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: any, @Req() req) {
    return this.ordersService.create(dto, req.user.userId);
  }

  @Post(':id/picked-up')
  @UseGuards(JwtAuthGuard)
  markPickedUp(@Param('id') id: string, @Req() req) {
    return this.ordersService.markPickedUp(id, req.user.userId);
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  confirmDelivery(@Param('id') id: string, @Body() dto: any, @Req() req) {
    return this.ordersService.confirmDelivery(id, dto, req.user.userId);
  }

  @Post(':id/dispute')
  @UseGuards(JwtAuthGuard)
  dispute(@Param('id') id: string, @Req() req) {
    return this.ordersService.disputeOrder(id, req.user.userId);
  }

  @Post(':id/resolve')
  @UseGuards(JwtAuthGuard)
  resolve(@Param('id') id: string, @Body() dto: { status: 'RESOLVED' | 
'REFUNDED' }) {
    return this.ordersService.resolveDispute(id, dto.status);
  }

  @Get('rider/earnings')
  @UseGuards(JwtAuthGuard)
  getRiderEarnings(@Req() req) {
    return this.ordersService.getRiderEarnings(req.user.userId);
  }

  @Get('my-orders')
  @UseGuards(JwtAuthGuard)
  getMyOrders(@Req() req) {
    return this.ordersService.getMyOrders(req.user.userId);
  }
}
