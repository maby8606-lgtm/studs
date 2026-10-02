import { Controller, Post, Body, Param, UseGuards, UseInterceptors, Req, Get, Patch, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RateLimit } from '../common/rate-limit.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ---- student ----
  @Post()
  @Roles('STUDENT', 'ADMIN')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60)
  @UseInterceptors(IdempotencyInterceptor)
  create(@Body() dto: any, @Req() req) {
    const studentId = req.user?.sub;
    console.log('[CONTROLLER] Creating order for student:', studentId);
    return this.ordersService.create(dto, studentId);
  }

  /** Peer-to-peer send/errand delivery (no vendor). */
  @Post('p2p')
  @Roles('STUDENT', 'ADMIN')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60)
  @UseInterceptors(IdempotencyInterceptor)
  createP2p(@Body() dto: any, @Req() req) {
    return this.ordersService.createP2p(dto, req.user?.sub);
  }

  /** Zone catalog + server-side delivery fees for a campus (Go 2). */
  @Get('delivery-zones')
  @Roles('STUDENT', 'RIDER', 'VENDOR', 'ADMIN')
  deliveryZones(@Req() req) {
    const campusId = req.query?.campusId || 'ug-legon';
    return this.ordersService.getDeliveryZones(campusId);
  }

  @Post(':id/dispute')
  @Roles('STUDENT', 'ADMIN')
  dispute(@Param('id') id: string, @Req() req) {
    return this.ordersService.disputeOrder(id, req.user?.sub);
  }

  @Post(':id/cancel')
  @Roles('STUDENT', 'ADMIN')
  cancelOrder(@Param('id') id: string, @Req() req) {
    return this.ordersService.cancelOrder(id, req.user?.sub);
  }

  @Post(':id/rate')
  @Roles('STUDENT', 'ADMIN')
  rateOrder(@Param('id') id: string, @Body('rating') rating: number, @Req() req) {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    return this.ordersService.rateOrder(id, rating, req.user?.sub);
  }

  @Get('my-orders')
  @Roles('STUDENT', 'ADMIN')
  getMyOrders(@Req() req) {
    return this.ordersService.getMyOrders(req.user?.sub);
  }

  /** Tracking timeline for one order (owner student, assigned rider, vendor, admin). */
  @Get(':id/timeline')
  @Roles('STUDENT', 'RIDER', 'VENDOR', 'ADMIN')
  getTimeline(@Param('id') id: string, @Req() req) {
    return this.ordersService.getOrderTimeline(id, { sub: req.user?.sub, role: req.user?.role });
  }

  // ---- vendor ----
  @Post(':id/vendor-accept')
  @Roles('VENDOR', 'ADMIN')
  vendorAccept(@Param('id') id: string, @Req() req) {
    return this.ordersService.acceptOrderByVendor(id, { sub: req.user?.sub, role: req.user?.role });
  }

  @Post(':id/vendor-cancel')
  @Roles('VENDOR', 'ADMIN')
  vendorCancel(@Param('id') id: string, @Req() req) {
    return this.ordersService.vendorCancelOrder(id, { sub: req.user?.sub, role: req.user?.role });
  }

  @Post(':id/picked-up')
  @Roles('VENDOR', 'RIDER', 'ADMIN')
  markPickedUp(@Param('id') id: string, @Req() req) {
    return this.ordersService.markPickedUp(id, { sub: req.user?.sub, role: req.user?.role });
  }

  @Get('vendor/my-orders')
  @Roles('VENDOR', 'ADMIN')
  getVendorOrders(@Req() req) {
    return this.ordersService.getVendorOrders(req.user?.sub);
  }

  // ---- rider ----
  @Post(':id/confirm')
  @Roles('RIDER', 'ADMIN')
  confirmDelivery(@Param('id') id: string, @Body() dto: any, @Req() req) {
    return this.ordersService.confirmDelivery(id, dto, { sub: req.user?.sub, role: req.user?.role });
  }

  /** SMS fallback: request a 6-digit delivery-confirmation code by SMS. */
  @Post(':id/sms-code')
  @Roles('STUDENT', 'RIDER', 'ADMIN')
  @UseGuards(RateLimitGuard)
  @RateLimit(3, 300, { byParam: 'id' })
  requestSmsCode(@Param('id') id: string, @Req() req) {
    return this.ordersService.requestDeliverySmsCode(id, { sub: req.user?.sub, role: req.user?.role });
  }

  /** SMS fallback: rider confirms delivery with the receiver's SMS code. */
  @Post(':id/confirm-sms')
  @Roles('RIDER', 'ADMIN')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 300, { byParam: 'id' })
  confirmDeliveryBySms(@Param('id') id: string, @Body() dto: any, @Req() req) {
    return this.ordersService.confirmDeliveryBySms(id, dto, { sub: req.user?.sub, role: req.user?.role });
  }

  @Post('rider/clock-in')
  @Roles('RIDER', 'ADMIN')
  clockIn(@Req() req) {
    return this.ordersService.clockIn(req.user?.sub);
  }

  @Post('rider/clock-out')
  @Roles('RIDER', 'ADMIN')
  clockOut(@Req() req) {
    return this.ordersService.clockOut(req.user?.sub);
  }

  @Get('rider/earnings')
  @Roles('RIDER', 'ADMIN')
  getRiderEarnings(@Req() req) {
    return this.ordersService.getRiderEarnings(req.user?.sub);
  }

  @Get('rider/my-deliveries')
  @Roles('RIDER', 'ADMIN')
  getRiderDeliveries(@Req() req) {
    return this.ordersService.getRiderDeliveries(req.user?.sub);
  }

  @Get('available')
  @Roles('RIDER', 'ADMIN')
  getAvailableOrders() {
    return this.ordersService.getAvailableOrders();
  }

  @Post(':id/accept')
  @Roles('RIDER', 'ADMIN')
  acceptOrder(@Param('id') id: string, @Req() req) {
    return this.ordersService.acceptOrder(id, req.user?.sub);
  }

  // ---- admin ----
  @Patch(':id/resolve')
  @Roles('ADMIN')
  resolve(@Param('id') id: string, @Body('status') status: 'RESOLVED' | 'REFUNDED') {
    return this.ordersService.resolveDispute(id, status);
  }

  @Get('admin/all-orders')
  @Roles('ADMIN')
  getAllOrders() {
    return this.ordersService.getAllOrders();
  }

  @Get('admin/all-disputes')
  @Roles('ADMIN')
  getAllDisputes() {
    return this.ordersService.getAllDisputes();
  }

  @Get('admin/rider-shifts')
  @Roles('ADMIN')
  getAllRiderShifts() {
    return this.ordersService.getAllRiderShifts();
  }
}
