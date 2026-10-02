import { Controller, Post, Body, Param, UseGuards, Req, Get, Patch, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: any, @Req() req) {
    const studentId = req.user?.sub;
    console.log('[CONTROLLER] Creating order for student:', studentId);
    return this.ordersService.create(dto, studentId);
  }

  @Post(':id/picked-up')
  @UseGuards(JwtAuthGuard)
  markPickedUp(@Param('id') id: string, @Req() req) {
    return this.ordersService.markPickedUp(id, req.user?.sub);
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  confirmDelivery(@Param('id') id: string, @Body() dto: any, @Req() req) {
    return this.ordersService.confirmDelivery(id, dto, req.user?.sub);
  }

  @Post(':id/dispute')
  @UseGuards(JwtAuthGuard)
  dispute(@Param('id') id: string, @Req() req) {
    return this.ordersService.disputeOrder(id, req.user?.sub);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancelOrder(@Param('id') id: string, @Req() req) {
    return this.ordersService.cancelOrder(id, req.user?.sub);
  }

  @Post(':id/rate')
  @UseGuards(JwtAuthGuard)
  rateOrder(@Param('id') id: string, @Body('rating') rating: number, @Req() req) {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    return this.ordersService.rateOrder(id, rating, req.user?.sub);
  }

  @Patch(':id/resolve')
  @UseGuards(JwtAuthGuard)
  resolve(@Param('id') id: string, @Body('status') status: 'RESOLVED' | 'REFUNDED', @Req() req) {
    if (req.user?.role !== 'ADMIN') {
      throw new BadRequestException('Only admins can resolve disputes');
    }
    return this.ordersService.resolveDispute(id, status);
  }

  // Rider endpoints
  @Post('rider/clock-in')
  @UseGuards(JwtAuthGuard)
  clockIn(@Req() req) {
    return this.ordersService.clockIn(req.user?.sub);
  }

  @Post('rider/clock-out')
  @UseGuards(JwtAuthGuard)
  clockOut(@Req() req) {
    return this.ordersService.clockOut(req.user?.sub);
  }

  @Get('rider/earnings')
  @UseGuards(JwtAuthGuard)
  getRiderEarnings(@Req() req) {
    return this.ordersService.getRiderEarnings(req.user?.sub);
  }

  @Get('my-orders')
  @UseGuards(JwtAuthGuard)
  getMyOrders(@Req() req) {
    return this.ordersService.getMyOrders(req.user?.sub);
  }

  // Vendor endpoint
  @Get('vendor/my-orders')
  @UseGuards(JwtAuthGuard)
  getVendorOrders(@Req() req) {
    return this.ordersService.getVendorOrders(req.user?.sub);
  }

  // Rider Delivery endpoints
  @Get('available')
  @UseGuards(JwtAuthGuard)
  getAvailableOrders() {
    return this.ordersService.getAvailableOrders();
  }

  @Post(':id/accept')
  @UseGuards(JwtAuthGuard)
  acceptOrder(@Param('id') id: string, @Req() req) {
    return this.ordersService.acceptOrder(id, req.user?.sub);
  }

  @Get('rider/my-deliveries')
  @UseGuards(JwtAuthGuard)
  getRiderDeliveries(@Req() req) {
    return this.ordersService.getRiderDeliveries(req.user?.sub);
  }

  // Admin endpoints
  @Get('admin/all-orders')
  @UseGuards(JwtAuthGuard)
  getAllOrders(@Req() req) {
    if (req.user?.role !== 'ADMIN') throw new BadRequestException('Only admins can access this');
    return this.ordersService.getAllOrders();
  }

  @Get('admin/all-disputes')
  @UseGuards(JwtAuthGuard)
  getAllDisputes(@Req() req) {
    if (req.user?.role !== 'ADMIN') throw new BadRequestException('Only admins can access this');
    return this.ordersService.getAllDisputes();
  }

  @Get('admin/rider-shifts')
  @UseGuards(JwtAuthGuard)
  getAllRiderShifts(@Req() req) {
    if (req.user?.role !== 'ADMIN') throw new BadRequestException('Only admins can access this');
    return this.ordersService.getAllRiderShifts();
  }
}