import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Order } from '../entities/order.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { OrderItem } from '../entities/order-item.entity';
import * as qrcode from 'qrcode';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class OrdersService {
  private riderShifts = new Map<string, any>();

  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(MenuItem)
    private menuItemRepository: Repository<MenuItem>,
    @InjectRepository(OrderItem)
    private orderItemRepository: Repository<OrderItem>,
    private authService: AuthService,
  ) {}

  async create(dto: any, studentId: string) {
    console.log('[ORDER CREATE] studentId:', studentId);
    console.log('[ORDER CREATE] dto:', dto);

    if (!studentId) throw new BadRequestException('Student ID is required');
    if (!dto.vendorId) throw new BadRequestException('vendorId is required');

    const allowed = ['ug-legon', 'upsa'];
    if (!allowed.includes(dto.campusId)) {
      throw new BadRequestException('Campus not allowed');
    }

    let productTotal = 0;
    const orderItems: OrderItem[] = [];

    if (dto.menuItemIds && Array.isArray(dto.menuItemIds) && dto.menuItemIds.length > 0) {
      const menuItems = await this.menuItemRepository.find({
        where: { id: In(dto.menuItemIds), isAvailable: true },
      });

      if (menuItems.length === 0) throw new BadRequestException('No valid menu items found');

      productTotal = menuItems.reduce((sum, item) => sum + Number(item.price), 0);

      for (const item of menuItems) {
        const orderItem = this.orderItemRepository.create({
          menuItemId: item.id,
          priceAtTime: item.price,
          quantity: 1,
        });
        orderItems.push(orderItem);
      }
    } else {
      productTotal = Number(dto.productTotal) || 0;
      if (productTotal <= 0) throw new BadRequestException('Product total must be greater than 0');
    }

    const deliveryFee = Number(dto.deliveryFee) || 6;
    const total = productTotal + deliveryFee;

    const riderId = `rider_${Math.floor(Math.random() * 5) + 1}`;

    const order = this.ordersRepository.create({
      studentId,
      vendorId: dto.vendorId,
      campusId: dto.campusId,
      serviceType: dto.serviceType || 'FOOD',
      pickupLocation: dto.pickupLocation,
      deliveryLocation: dto.deliveryLocation,
      productTotal,
      deliveryFee,
      total,
      status: 'ASSIGNED',
      assignedRiderId: riderId,
    });

    const savedOrder = await this.ordersRepository.save(order);

    // Save OrderItems
    if (orderItems.length > 0) {
      for (const oi of orderItems) {
        oi.orderId = savedOrder.id;
        await this.orderItemRepository.save(oi);
      }
    }

    const qrData = await qrcode.toDataURL(savedOrder.id);
    savedOrder.qrCode = qrData;
    await this.ordersRepository.save(savedOrder);

    console.log(`[NEW ORDER SUCCESS] ${savedOrder.id} | Total: ${total} GHS | Rider: ${riderId}`);

    return {
      orderId: savedOrder.id,
      totalGHS: total,
      qrCode: qrData,
      assignedRiderId: riderId,
      message: 'Order placed successfully! Rider assigned.',
    };
  }

  async cancelOrder(orderId: string, studentId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId, studentId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'ASSIGNED') throw new BadRequestException('Only ASSIGNED orders can be cancelled');
    order.status = 'CANCELLED';
    await this.ordersRepository.save(order);
    console.log(`[ORDER CANCELLED] ${orderId} by student ${studentId}`);
    return { orderId, status: 'CANCELLED', message: 'Order cancelled successfully' };
  }

  async markPickedUp(orderId: string, riderId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    order.status = 'PICKED_UP';
    order.pickedAt = new Date();
    await this.ordersRepository.save(order);
    return { orderId, status: 'PICKED_UP', message: 'Picked up' };
  }

  async confirmDelivery(orderId: string, dto: any, riderId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (dto.qrCodeScanned !== order.id) throw new BadRequestException('Invalid QR Code');
    order.status = 'DELIVERED';
    order.deliveredAt = new Date();
    await this.ordersRepository.save(order);

    const commission = order.productTotal * 0.10;
    const riderPayout = order.productTotal - commission + order.deliveryFee;

    this.authService.updateWallet(order.studentId, -order.total);
    this.authService.updateWallet(riderId, riderPayout);

    console.log(`[DELIVERY CONFIRMED] ${orderId} | Rider payout: ${riderPayout} GHS`);

    return {
      orderId,
      status: 'DELIVERED',
      deliveryTimeMinutes: 1,
      message: 'Delivery confirmed! Payment processed.',
      productTotalGHS: order.productTotal,
      deliveryFeeGHS: order.deliveryFee,
      totalGHS: order.total,
      commissionGHS: commission.toFixed(2),
      riderPayoutGHS: riderPayout.toFixed(2),
    };
  }

  async disputeOrder(orderId: string, studentId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    order.status = 'DISPUTED';
    await this.ordersRepository.save(order);
    return { orderId, status: 'DISPUTED', message: 'Dispute raised successfully.' };
  }

  async resolveDispute(orderId: string, status: 'RESOLVED' | 'REFUNDED') {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    order.status = status;
    await this.ordersRepository.save(order);
    return { orderId, status, message: status === 'REFUNDED' ? 'Order refunded successfully' : 'Dispute resolved' };
  }

  async rateOrder(orderId: string, rating: number, studentId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId, studentId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'DELIVERED') throw new BadRequestException('You can only rate delivered orders');
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating must be between 1 and 5');
    console.log(`[ORDER RATED] Order ${orderId} rated ${rating}/5 by student ${studentId}`);
    return {
      orderId,
      rating,
      message: 'Thank you for your rating!'
    };
  }

  async clockIn(riderId: string) {
    const shift = {
      riderId,
      clockInTime: new Date(),
      status: 'ON_DUTY',
      ordersCompleted: 0,
      totalEarned: 0,
    };
    this.riderShifts.set(riderId, shift);
    console.log(`[CLOCK IN] Rider ${riderId}`);
    return {
      riderId,
      status: 'ON_DUTY',
      clockInTime: shift.clockInTime,
      message: 'Successfully clocked in. Good deliveries!'
    };
  }

  async clockOut(riderId: string) {
    const shift = this.riderShifts.get(riderId);
    if (!shift || shift.status !== 'ON_DUTY') throw new BadRequestException('Rider is not clocked in');
    shift.clockOutTime = new Date();
    shift.status = 'OFF_DUTY';
    const totalMinutes = (shift.clockOutTime.getTime() - shift.clockInTime.getTime()) / 60000;
    return {
      riderId,
      clockInTime: shift.clockInTime,
      clockOutTime: shift.clockOutTime,
      totalMinutes: Math.round(totalMinutes),
      ordersCompleted: shift.ordersCompleted,
      totalEarnedGHS: shift.totalEarned.toFixed(2),
      message: 'Shift ended successfully',
    };
  }

  async getRiderEarnings(riderId: string) {
    const completed = await this.ordersRepository.find({
      where: { assignedRiderId: riderId, status: 'DELIVERED' }
    });
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

  async getMyOrders(studentId: string) {
    return this.ordersRepository.find({
      where: { studentId },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' }
    });
  }

  async getVendorOrders(vendorId: string) {
    return this.ordersRepository.find({
      where: { vendorId },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' }
    });
  }

  async getAvailableOrders() {
    return this.ordersRepository.find({
      where: { status: 'ASSIGNED' },
      order: { createdAt: 'DESC' }
    });
  }

  async acceptOrder(orderId: string, riderId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'ASSIGNED') throw new BadRequestException('Order is not available');
    order.assignedRiderId = riderId;
    order.status = 'PICKED_UP';
    await this.ordersRepository.save(order);
    return { message: 'Order accepted successfully', order };
  }

  async getRiderDeliveries(riderId: string) {
    return this.ordersRepository.find({
      where: { assignedRiderId: riderId },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' }
    });
  }

  async getAllOrders() {
    return this.ordersRepository.find({ 
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' } 
    });
  }

  async getAllDisputes() {
    return this.ordersRepository.find({ 
      where: { status: 'DISPUTED' },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' }
    });
  }

  getAllRiderShifts() {
    return Array.from(this.riderShifts.values());
  }
}