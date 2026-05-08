import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import * as qrcode from 'qrcode';

@Injectable()
export class OrdersService {
  private orders = new Map();

  constructor(private authService: AuthService) {}

  async create(dto: any, studentId: string) {
    const allowed = ['ug-legon', 'upsa'];
    if (!allowed.includes(dto.campusId)) {
      throw new BadRequestException('Campus not allowed');
    }

    const riderId = "rider_1";

    const order = {
      id: 'order_' + Date.now().toString(36),
      studentId,
      campusId: dto.campusId,
      pickupLocation: dto.pickupLocation,
      deliveryLocation: dto.deliveryLocation,
      productTotal: dto.productTotal,
      deliveryFee: dto.deliveryFee || 5.5,
      total: (dto.productTotal || 0) + (dto.deliveryFee || 5.5),
      status: 'ASSIGNED',
      assignedRiderId: riderId,
      qrCode: '',
      pickedAt: null,
      deliveredAt: null,
      createdAt: new Date(),
    };

    const qrData = await qrcode.toDataURL(order.id);
    order.qrCode = qrData;

    this.orders.set(order.id, order);

    console.log('NEW ORDER ' + order.id);

    return {
      orderId: order.id,
      totalGHS: order.total,
      qrCode: qrData,
      message: 'Order placed',
    };
  }

  async markPickedUp(orderId: string, riderId: string) {
    const order = this.orders.get(orderId);
    if (!order) throw new NotFoundException('Not found');

    order.status = 'PICKED_UP';
    order.pickedAt = new Date();

    console.log('PICKED_UP ' + orderId);

    return { orderId, status: 'PICKED_UP', message: 'Picked up' };
  }

  async confirmDelivery(orderId: string, dto: any, riderId: string) {
    const order = this.orders.get(orderId);
    if (!order) throw new NotFoundException('Not found');

    if (dto.qrCodeScanned !== order.id) {
      throw new BadRequestException('Invalid QR');
    }

    order.status = 'DELIVERED';
    order.deliveredAt = new Date();

    const minutes = order.pickedAt ? Math.round((order.deliveredAt.getTime() - order.pickedAt.getTime()) / 60000) : 0;

    const commission = order.productTotal * 0.10;
    const riderPayout = (order.productTotal - commission) + order.deliveryFee;

    this.authService.updateWallet(order.studentId, -order.total);
    this.authService.updateWallet(riderId, riderPayout);

    console.log('CONFIRMED ' + orderId);

    return {
      orderId,
      status: 'DELIVERED',
      deliveryTimeMinutes: minutes,
      message: 'Confirmed',
      productTotalGHS: order.productTotal,
      deliveryFeeGHS: order.deliveryFee,
      totalGHS: order.total,
      commissionGHS: commission.toFixed(2),
      riderPayoutGHS: riderPayout.toFixed(2),
    };
  }

  getRiderEarnings(riderId: string) {
    const completed = Array.from(this.orders.values()).filter(o => 
      o.assignedRiderId === riderId && o.status === 'DELIVERED'
    );

    const total = completed.reduce((sum, o) => {
      const comm = o.productTotal * 0.10;
      return sum + (o.productTotal - comm) + o.deliveryFee;
    }, 0);

    return {
      riderId,
      totalEarnedGHS: total.toFixed(2),
      completedDeliveries: completed.length,
      message: 'Earnings ready',
    };
  }

  getMyOrders(studentId: string) {
    return Array.from(this.orders.values()).filter(o => o.studentId === studentId);
  }
}