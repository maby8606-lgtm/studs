import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, DataSource, EntityManager, MoreThan } from 'typeorm';
import { Order } from '../entities/order.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Vendor } from '../entities/vendor.entity';
import { RiderShift } from '../entities/rider-shift.entity';
import * as qrcode from 'qrcode';
import { WalletService } from '../wallet/wallet.service';
import { LedgerMutex } from '../common/ledger-mutex';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ConfigService } from '@nestjs/config';
import { SmsService } from '../notifications/sms.service';
import { FraudService } from '../fraud/fraud.service';
import { DeliveryCode } from '../entities/delivery-code.entity';
import { User } from '../entities/user.entity';
import {
  bandFeesFromEnv, findZone, zonesForCampus, foodDeliveryFeeGHS, p2pDeliveryFeeGHS,
} from './delivery-zones';
import * as crypto from 'crypto';

const ALLOWED_CAMPUSES = ['ug-legon', 'upsa'];

type ReqUser = { sub: string; role: string };

@Injectable()
export class OrdersService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(MenuItem)
    private menuItemRepository: Repository<MenuItem>,
    @InjectRepository(OrderItem)
    private orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Vendor)
    private vendorsRepository: Repository<Vendor>,
    @InjectRepository(RiderShift)
    private shiftsRepository: Repository<RiderShift>,
    private walletService: WalletService,
    private ledgerMutex: LedgerMutex,
    private subscriptionsService: SubscriptionsService,
    private configService: ConfigService,
    private smsService: SmsService,
    @InjectRepository(DeliveryCode)
    private deliveryCodesRepository: Repository<DeliveryCode>,
    private fraudService: FraudService,
  ) {}

  // ---------- order placement ----------

  async create(dto: any, studentId: string) {
    if (!studentId) throw new BadRequestException('Student ID is required');
    if (!dto.vendorId) throw new BadRequestException('vendorId is required');
    if (!ALLOWED_CAMPUSES.includes(dto.campusId)) {
      throw new BadRequestException('Campus not allowed');
    }
    if (!dto.deliveryLocation) throw new BadRequestException('Delivery location is required');

    const vendor = await this.vendorsRepository.findOne({ where: { id: dto.vendorId } });
    if (!vendor || !vendor.isActive) throw new BadRequestException('Vendor not available');

    let productTotal = 0;
    const itemsInput: { menuItem: MenuItem; quantity: number }[] = [];

    if (dto.menuItemIds && Array.isArray(dto.menuItemIds) && dto.menuItemIds.length > 0) {
      // The cart sends one id per unit, so duplicates mean quantity > 1.
      const qtyById = new Map<string, number>();
      for (const id of dto.menuItemIds) qtyById.set(id, (qtyById.get(id) || 0) + 1);

      const menuItems = await this.menuItemRepository.find({
        where: { id: In([...qtyById.keys()]), isAvailable: true },
      });
      if (menuItems.length !== qtyById.size) {
        throw new BadRequestException('One or more menu items are invalid or unavailable');
      }
      // All items must belong to the same vendor being ordered from.
      for (const mi of menuItems) {
        if (mi.vendorId !== dto.vendorId) {
          throw new BadRequestException('All items must come from the same vendor');
        }
        itemsInput.push({ menuItem: mi, quantity: qtyById.get(mi.id) as number });
      }
      productTotal =
        Math.round(
          menuItems.reduce((sum, mi) => sum + Number(mi.price) * (qtyById.get(mi.id) || 0), 0) * 100,
        ) / 100;
    } else {
      productTotal = Number(dto.productTotal) || 0;
      if (productTotal <= 0) throw new BadRequestException('Product total must be greater than 0');
    }

    // Zone/distance pricing (Go 2): when the client names a delivery zone,
    // the SERVER prices the fee from the zone's distance band — a client can
    // no longer set its own delivery fee. Legacy clients that send no zone
    // keep the previous flat behavior.
    let deliveryFee: number;
    let deliveryZoneId: string | null = null;
    if (dto.deliveryZone) {
      const zone = findZone(dto.campusId, String(dto.deliveryZone));
      if (!zone) throw new BadRequestException(`Unknown delivery zone for campus ${dto.campusId}`);
      deliveryFee = foodDeliveryFeeGHS(zone, this.bandFees());
      deliveryZoneId = zone.id;
    } else {
      deliveryFee = Number(dto.deliveryFee) || 6;
    }
    // STUDS Plus: an active subscription can cover the delivery fee (quota
    // counted from waived orders in the current period). The rider is still
    // paid the full fee at settlement — the platform absorbs it.
    const freeDelivery = await this.subscriptionsService.studentFreeDeliveryStatus(studentId);
    const total = Math.round((productTotal + (freeDelivery.waived ? 0 : deliveryFee)) * 100) / 100;

    // New orders start PENDING: the vendor must accept before any rider is
    // assigned. Rider assignment happens at vendor acceptance, so we never
    // assign a rider to an order the vendor is about to cancel.

    // Serialized with all other ledger writes: concurrent
    // dataSource.transaction() calls corrupt sqlite's SAVEPOINT bookkeeping.
    const savedOrder = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        studentId,
        vendorId: dto.vendorId,
        campusId: dto.campusId,
        serviceType: dto.serviceType || 'FOOD',
        orderType: 'VENDOR',
        pickupLocation: dto.pickupLocation || vendor.location,
        deliveryLocation: dto.deliveryLocation,
        deliveryZone: deliveryZoneId,
        productTotal,
        deliveryFee,
        deliveryFeeWaived: freeDelivery.waived,
        subscriptionPeriodKey: freeDelivery.waived ? freeDelivery.periodKey : null,
        total,
        status: 'PENDING',
        assignedRiderId: null,
        note: dto.note || null,
      });
      const saved = await manager.save(order);

      for (const { menuItem, quantity } of itemsInput) {
        const oi = manager.create(OrderItem, {
          orderId: saved.id,
          menuItemId: menuItem.id,
          priceAtTime: menuItem.price,
          quantity,
        });
        await manager.save(oi);
      }

      // Step 4 fix: checkout balance check + debit happen atomically here.
      // Throws (rolling everything back) when funds are insufficient.
      await this.walletService.debitForOrder(studentId, total, saved.id, manager);

      const qrData = await qrcode.toDataURL(saved.id);
      saved.qrCode = qrData;
      await manager.save(saved);
      return saved;
      }),
    );

    console.log(
      `[NEW ORDER] ${savedOrder.id} | Total: ${total} GHS | Status: PENDING (awaiting vendor)${freeDelivery.waived ? ' | delivery fee waived (STUDS Plus)' : ''}`,
    );
    return {
      orderId: savedOrder.id,
      totalGHS: total,
      deliveryFeeGHS: deliveryFee,
      deliveryZone: deliveryZoneId,
      qrCode: savedOrder.qrCode,
      status: 'PENDING',
      deliveryFeeWaived: freeDelivery.waived,
      message: freeDelivery.waived
        ? 'Order placed successfully! Free delivery applied (STUDS Plus). Waiting for the vendor to accept.'
        : 'Order placed successfully! Waiting for the vendor to accept.',
    };
  }

  // ---------- delivery zones ----------

  /** Band fees (GHS) for bands 0/1/2 — env-tunable, fail-closed to defaults. */
  private bandFees(): number[] {
    return bandFeesFromEnv(this.configService.get<string>('DELIVERY_FEE_BAND_GHS'));
  }

  /** Zone catalog for a campus, with the server's fee for each zone. */
  getDeliveryZones(campusId: string) {
    if (!ALLOWED_CAMPUSES.includes(campusId)) {
      throw new BadRequestException('Campus not allowed');
    }
    const fees = this.bandFees();
    return {
      campusId,
      bandFeesGHS: fees,
      zones: zonesForCampus(campusId).map((z) => ({ ...z, feeGHS: fees[z.band] })),
    };
  }

  /**
   * Peer-to-peer delivery (Master Doc: send/receive + errands). The sender
   * pays a flat delivery fee from their wallet; there is no vendor, so the
   * order goes straight to ASSIGNED with the least-loaded on-duty rider (or
   * open-for-claim when nobody is clocked in). STUDS Plus free-delivery
   * quota applies to P2P sends too; the platform then absorbs the fee.
   */
  async createP2p(dto: any, studentId: string) {
    if (!studentId) throw new BadRequestException('Student ID is required');
    if (!ALLOWED_CAMPUSES.includes(dto.campusId)) {
      throw new BadRequestException('Campus not allowed');
    }
    if (!dto.pickupLocation) throw new BadRequestException('Pickup location is required');
    if (!dto.deliveryLocation) throw new BadRequestException('Delivery location is required');
    if (!dto.itemDescription || String(dto.itemDescription).trim().length < 3) {
      throw new BadRequestException('Describe what you are sending (min 3 characters)');
    }

    // Zone pricing when both ends name zones (fee follows the trip's
    // distance bands); otherwise the legacy flat P2P fee applies.
    let deliveryFee: number;
    let pickupZoneId: string | null = null;
    let deliveryZoneId: string | null = null;
    if (dto.pickupZone && dto.deliveryZone) {
      const pickup = findZone(dto.campusId, String(dto.pickupZone));
      const delivery = findZone(dto.campusId, String(dto.deliveryZone));
      if (!pickup || !delivery) throw new BadRequestException(`Unknown zone for campus ${dto.campusId}`);
      deliveryFee = p2pDeliveryFeeGHS(pickup, delivery, this.bandFees());
      pickupZoneId = pickup.id;
      deliveryZoneId = delivery.id;
    } else {
      const feeRaw = Number(this.configService.get<string>('P2P_DELIVERY_FEE_GHS'));
      deliveryFee = Number.isFinite(feeRaw) && feeRaw > 0 ? feeRaw : 5;
    }

    const freeDelivery = await this.subscriptionsService.studentFreeDeliveryStatus(studentId);
    const total = freeDelivery.waived ? 0 : deliveryFee;
    const assignedRiderId = await this.pickRider();

    const savedOrder = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
        const order = manager.create(Order, {
          studentId,
          vendorId: null,
          campusId: dto.campusId,
          serviceType: dto.serviceType || 'PACKAGE',
          orderType: 'P2P',
          pickupLocation: dto.pickupLocation,
          deliveryLocation: dto.deliveryLocation,
          pickupZone: pickupZoneId,
          deliveryZone: deliveryZoneId,
          itemDescription: String(dto.itemDescription).slice(0, 200),
          recipientPhone: dto.recipientPhone || null,
          productTotal: 0,
          deliveryFee,
          deliveryFeeWaived: freeDelivery.waived,
          subscriptionPeriodKey: freeDelivery.waived ? freeDelivery.periodKey : null,
          total,
          status: 'ASSIGNED',
          assignedRiderId,
          assignedAt: assignedRiderId ? new Date() : null,
          note: dto.note || null,
        });
        const saved = await manager.save(order);
        if (total > 0) {
          await this.walletService.debitForOrder(studentId, total, saved.id, manager);
        }
        const qrData = await qrcode.toDataURL(saved.id);
        saved.qrCode = qrData;
        await manager.save(saved);
        return saved;
      }),
    );

    console.log(
      `[NEW P2P] ${savedOrder.id} | Fee: ${deliveryFee} GHS | Status: ASSIGNED | Rider: ${assignedRiderId || 'open-for-claim'}${freeDelivery.waived ? ' | fee waived (STUDS Plus)' : ''}`,
    );
    return {
      orderId: savedOrder.id,
      totalGHS: total,
      deliveryFeeGHS: deliveryFee,
      pickupZone: pickupZoneId,
      deliveryZone: deliveryZoneId,
      deliveryFeeWaived: freeDelivery.waived,
      qrCode: savedOrder.qrCode,
      status: 'ASSIGNED',
      assignedRiderId,
      message: assignedRiderId
        ? 'Delivery booked! A rider has been assigned.'
        : 'Delivery booked! Waiting for a rider to claim it.',
    };
  }

  /** Least-loaded on-duty rider, or null when nobody is clocked in. */
  private async pickRider(): Promise<string | null> {
    const onDuty = await this.shiftsRepository.find({ where: { status: 'ON_DUTY' } });
    if (onDuty.length === 0) return null;
    const ids = onDuty.map((s) => s.riderId);

    const rows = await this.ordersRepository
      .createQueryBuilder('o')
      .select('o.assignedRiderId', 'riderId')
      .addSelect('COUNT(o.id)', 'cnt')
      .where('o.assignedRiderId IN (:...ids)', { ids })
      .andWhere('o.status NOT IN (:...done)', { done: ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RESOLVED'] })
      .groupBy('o.assignedRiderId')
      .getRawMany();

    const load = new Map<string, number>(rows.map((r) => [r.riderId, Number(r.cnt)]));
    ids.sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0));
    return ids[0];
  }

  // ---------- lifecycle ----------

  async cancelOrder(orderId: string, studentId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId, studentId } });
    if (!order) throw new NotFoundException('Order not found');
    // Student may cancel their own order while PENDING (before vendor
    // acceptance) or ASSIGNED (before rider pickup). Both refund in full;
    // neither has settled, so there is nothing to claw back.
    if (!['PENDING', 'ASSIGNED'].includes(order.status)) {
      throw new BadRequestException('Only PENDING or ASSIGNED orders can be cancelled');
    }

    await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
      order.status = 'CANCELLED';
      order.cancelledAt = new Date();
      await manager.save(order);
      await this.walletService.refundOrder(studentId, Number(order.total), orderId, manager);
      }),
    );

    // Refund-abuse signal: repeated cancellations in a day.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCancels = await this.ordersRepository.count({
      where: { studentId, status: 'CANCELLED', cancelledAt: MoreThan(dayAgo) },
    });
    if (recentCancels >= 3) {
      await this.fraudService.record('REPEATED_CANCELLATIONS', {
        userId: studentId,
        orderId,
        severity: 'MEDIUM',
        detail: `Student has cancelled ${recentCancels} refunded orders in the last 24 hours.`,
      });
    }

    console.log(`[ORDER CANCELLED+REFUNDED] ${orderId} by student ${studentId}`);
    return { orderId, status: 'CANCELLED', message: 'Order cancelled and refunded successfully' };
  }

  /**
   * Vendor accepts a PENDING order: assigns the least-loaded on-duty rider
   * and moves it to ASSIGNED so riders can see/claim it.
   * Only the order's vendor (or admin) may accept, and only from PENDING.
   */
  async acceptOrderByVendor(orderId: string, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (user.role !== 'ADMIN' && order.vendorId !== user.sub) {
      throw new ForbiddenException('Only the vendor for this order can accept it');
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING orders can be accepted by the vendor');
    }

    // Rider assignment happens here (not at checkout) so a cancelled
    // PENDING order never briefly holds a rider.
    const assignedRiderId = await this.pickRider();

    await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
        order.status = 'ASSIGNED';
        order.assignedRiderId = assignedRiderId;
        order.assignedAt = new Date();
        await manager.save(order);
      }),
    );

    console.log(`[ORDER ACCEPTED] ${orderId} by vendor ${order.vendorId} | Rider: ${assignedRiderId || 'open-for-claim'}`);
    return {
      orderId,
      status: 'ASSIGNED',
      assignedRiderId,
      message: assignedRiderId
        ? 'Order accepted! Rider assigned.'
        : 'Order accepted! Waiting for a rider to claim.',
    };
  }

  /**
   * Vendor cancels a PENDING order (before any rider is assigned):
   * the student is refunded in full via the immutable ledger, atomically
   * with the status change. CANCELLED is terminal — no further actions
   * are possible (every transition guards on status).
   */
  async vendorCancelOrder(orderId: string, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (user.role !== 'ADMIN' && order.vendorId !== user.sub) {
      throw new ForbiddenException('Only the vendor for this order can cancel it');
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING orders can be cancelled by the vendor');
    }

    await this.cancelPendingOrderAtomic(orderId, `vendor ${order.vendorId}`);
    console.log(`[ORDER VENDOR-CANCELLED+REFUNDED] ${orderId} by vendor ${order.vendorId}`);
    return { orderId, status: 'CANCELLED', message: 'Order cancelled and student refunded in full' };
  }

  /**
   * System auto-cancel: a PENDING order the vendor never accepted within the
   * timeout is cancelled and the student refunded in full. Called by the
   * scheduled timeout sweeper. Returns false if the order is no longer
   * PENDING (e.g. the vendor accepted it between scan and cancel).
   */
  async autoCancelTimedOutOrder(orderId: string, timeoutMinutes: number): Promise<boolean> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order || order.status !== 'PENDING') return false;

    await this.cancelPendingOrderAtomic(
      orderId,
      `system (vendor accept timeout ${timeoutMinutes}m)`,
    );
    console.log(
      `[ORDER AUTO-CANCELLED+REFUNDED] ${orderId} — vendor did not accept within ${timeoutMinutes} minutes`,
    );
    return true;
  }

  /**
   * Shared atomic core for all PENDING cancellations (vendor, student,
   * system): CANCELLED status + full ORDER_REFUND in one mutex-guarded
   * transaction. The status re-check inside the transaction makes the
   * sweep race-safe: if the vendor accepted between scan and cancel,
   * the transaction throws and nothing is refunded.
   */
  private async cancelPendingOrderAtomic(orderId: string, actorLabel: string) {
    await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
        const order = await manager.findOne(Order, { where: { id: orderId } });
        if (!order) throw new NotFoundException('Order not found');
        if (order.status !== 'PENDING') {
          throw new BadRequestException(
            `Order ${orderId} is no longer PENDING (status=${order.status}); cancel by ${actorLabel} aborted`,
          );
        }
        order.status = 'CANCELLED';
        order.cancelledAt = new Date();
        await manager.save(order);
        await this.walletService.refundOrder(order.studentId, Number(order.total), orderId, manager);
      }),
    );
  }

  async markPickedUp(orderId: string, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    const isVendorPickup = user.role === 'VENDOR' && order.vendorId === user.sub;
    // P2P has no vendor: the assigned rider collects from the sender.
    const isP2pRiderPickup =
      order.orderType === 'P2P' && user.role === 'RIDER' && order.assignedRiderId === user.sub;
    if (user.role !== 'ADMIN' && !isVendorPickup && !isP2pRiderPickup) {
      throw new ForbiddenException('Only the vendor (or admin) can mark this picked up');
    }
    if (order.status !== 'ASSIGNED') throw new BadRequestException('Order is not awaiting pickup');
    order.status = 'PICKED_UP';
    order.pickedAt = new Date();
    await this.ordersRepository.save(order);
    return { orderId, status: 'PICKED_UP', message: 'Picked up' };
  }

  async confirmDelivery(orderId: string, dto: any, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PICKED_UP') throw new BadRequestException('Order must be picked up first');
    if (user.role !== 'ADMIN' && order.assignedRiderId !== user.sub) {
      throw new ForbiddenException('Only the assigned rider can confirm this delivery');
    }
    if (dto.qrCodeScanned !== order.id) throw new BadRequestException('Invalid QR Code');

    return this.executeDeliverySettlement(order, 'QR');
  }

  /**
   * SMS fallback for QR delivery confirmation (Master Doc §5): send a
   * 6-digit code to the receiver's phone. The receiver reads it to the
   * rider, who confirms with it. Only the code's SHA-256 hash is stored;
   * codes expire in 10 minutes, allow 5 attempts, and a fresh code
   * supersedes any previous one.
   */
  async requestDeliverySmsCode(orderId: string, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PICKED_UP') throw new BadRequestException('Order must be picked up first');
    const isStudent = order.studentId === user.sub;
    const isRider = order.assignedRiderId === user.sub;
    if (user.role !== 'ADMIN' && !isStudent && !isRider) {
      throw new ForbiddenException('Only the customer or assigned rider can request a confirmation code');
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(`${orderId}:${code}`).digest('hex');

    // Supersede any outstanding codes for this order.
    await this.deliveryCodesRepository.update(
      { orderId, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    await this.deliveryCodesRepository.save(
      this.deliveryCodesRepository.create({
        orderId,
        codeHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      }),
    );

    // Receiver phone: P2P deliveries go to the named recipient when given,
    // otherwise the ordering student's account phone.
    let phone = order.recipientPhone || null;
    if (!phone) {
      const student = await this.dataSource.getRepository(User).findOne({ where: { id: order.studentId } });
      phone = student?.phone || null;
    }
    if (!phone) throw new BadRequestException('No phone number available for SMS confirmation');

    await this.smsService.sendSms(
      phone,
      `STUDS: your delivery confirmation code is ${code}. Give it to your rider to complete the delivery. It expires in 10 minutes.`,
    );
    console.log(`[SMS CODE SENT] order=${orderId} to=***${String(phone).slice(-3)}`);
    return { orderId, message: 'Confirmation code sent by SMS', expiresInMinutes: 10 };
  }

  async confirmDeliveryBySms(orderId: string, dto: any, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PICKED_UP') throw new BadRequestException('Order must be picked up first');
    if (user.role !== 'ADMIN' && order.assignedRiderId !== user.sub) {
      throw new ForbiddenException('Only the assigned rider can confirm this delivery');
    }

    const submitted = String(dto?.code || '');
    if (!/^\d{6}$/.test(submitted)) throw new BadRequestException('A 6-digit SMS code is required');

    const record = await this.deliveryCodesRepository.findOne({
      where: { orderId, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!record) throw new BadRequestException('No active SMS code. Request a new one.');
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('SMS code expired. Request a new one.');
    }
    if (record.attempts >= record.maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts. Request a new code.');
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = crypto.createHash('sha256').update(`${orderId}:${submitted}`).digest();
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      record.attempts += 1;
      await this.deliveryCodesRepository.save(record);
      if (record.attempts >= record.maxAttempts) {
        await this.fraudService.record('SMS_CODE_EXHAUSTED', {
          userId: user.sub,
          orderId,
          severity: 'MEDIUM',
          detail: `Rider exhausted ${record.maxAttempts} SMS confirmation attempts on this order — possible code-guessing.`,
        });
      }
      throw new BadRequestException('Incorrect SMS code');
    }

    record.usedAt = new Date();
    await this.deliveryCodesRepository.save(record);
    console.log(`[SMS CODE VERIFIED] order=${orderId}`);
    return this.executeDeliverySettlement(order, 'SMS');
  }

  /**
   * Shared settlement core for QR and SMS delivery confirmation: marks the
   * order DELIVERED and posts the settlement split, atomically. Vendor
   * orders honor VENDOR_PRO's reduced commission and STUDS Plus fee
   * coverage; P2P orders split the delivery fee with the platform.
   */
  private async executeDeliverySettlement(order: Order, via: 'QR' | 'SMS') {
    const orderId = order.id;
    const riderId = order.assignedRiderId as string;
    const vendorId = order.vendorId;

    const split = await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager: EntityManager) => {
      order.status = 'DELIVERED';
      order.deliveredAt = new Date();
      await manager.save(order);

      const s =
        order.orderType === 'P2P'
          ? await this.walletService.settleP2pOrder(
              { orderId, riderId, deliveryFee: Number(order.deliveryFee) },
              manager,
              { deliveryFeeCoveredByPlatform: !!order.deliveryFeeWaived },
            )
          : await this.walletService.settleOrder(
              {
                orderId,
                vendorId: vendorId as string,
                riderId,
                productTotal: Number(order.productTotal),
                deliveryFee: Number(order.deliveryFee),
              },
              manager,
              {
                commissionRate:
                  (await this.subscriptionsService.getVendorCommissionRate(vendorId as string)) ?? undefined,
                deliveryFeeCoveredByPlatform: !!order.deliveryFeeWaived,
              },
            );

      const shift = await manager.findOne(RiderShift, {
        where: { riderId, status: 'ON_DUTY' },
        order: { clockInTime: 'DESC' },
      });
      if (shift) {
        shift.ordersCompleted += 1;
        shift.totalEarned = Math.round((Number(shift.totalEarned) + s.riderPayout) * 100) / 100;
        await manager.save(shift);
      }
      return s;
      }),
    );

    console.log(
      `[DELIVERY CONFIRMED via ${via}] ${orderId} | vendor=${split.vendorPayout} rider=${split.riderPayout} platform=${split.commission} GHS`,
    );
    return {
      orderId,
      status: 'DELIVERED',
      confirmedVia: via,
      message: 'Delivery confirmed! Payment settled.',
      productTotalGHS: order.productTotal,
      deliveryFeeGHS: order.deliveryFee,
      totalGHS: order.total,
      vendorPayoutGHS: split.vendorPayout.toFixed(2),
      riderPayoutGHS: split.riderPayout.toFixed(2),
      platformCommissionGHS: split.commission.toFixed(2),
      commissionRate: `${(split.rate * 100).toFixed(2)}%`,
    };
  }

  async disputeOrder(orderId: string, studentId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId, studentId } });
    if (!order) throw new NotFoundException('Order not found');
    if (!['DELIVERED', 'PICKED_UP'].includes(order.status)) {
      throw new BadRequestException('Only active/completed orders can be disputed');
    }
    const previousStatus = order.status;
    order.status = 'DISPUTED';
    await this.ordersRepository.save(order);
    await this.fraudService.record('DISPUTE_OPENED', {
      userId: studentId,
      orderId,
      severity: 'LOW',
      detail: `Student opened a dispute on a ${order.orderType} order of GH₵${Number(order.total).toFixed(2)} (was ${previousStatus}).`,
    });
    return { orderId, status: 'DISPUTED', message: 'Dispute raised successfully.' };
  }

  async resolveDispute(orderId: string, status: 'RESOLVED' | 'REFUNDED') {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'DISPUTED') throw new BadRequestException('Order is not disputed');

    await this.ledgerMutex.run(() =>
      this.dataSource.transaction(async (manager) => {
      order.status = status;
      await manager.save(order);
      if (status === 'REFUNDED') {
        // Student gets their money back.
        await this.walletService.refundOrder(order.studentId, Number(order.total), orderId, manager);
        // If the order was already settled (delivered before dispute), claw
        // back the vendor/rider/platform credits so the ledger stays
        // balanced. No-op if never settled or already reversed.
        await this.walletService.reverseSettlement(orderId, manager);
      }
      }),
    );
    return {
      orderId,
      status,
      message: status === 'REFUNDED' ? 'Order refunded successfully' : 'Dispute resolved',
    };
  }

  async rateOrder(orderId: string, rating: number, studentId: string) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId, studentId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'DELIVERED') throw new BadRequestException('You can only rate delivered orders');
    if (rating < 1 || rating > 5) throw new BadRequestException('Rating must be between 1 and 5');
    console.log(`[ORDER RATED] Order ${orderId} rated ${rating}/5 by student ${studentId}`);
    return { orderId, rating, message: 'Thank you for your rating!' };
  }

  // ---------- rider shifts (persisted) ----------

  async clockIn(riderId: string) {
    const existing = await this.shiftsRepository.findOne({
      where: { riderId, status: 'ON_DUTY' },
      order: { clockInTime: 'DESC' },
    });
    if (existing) {
      return {
        riderId,
        status: 'ON_DUTY',
        clockInTime: existing.clockInTime,
        message: 'Already clocked in',
      };
    }
    const shift = this.shiftsRepository.create({
      riderId,
      clockInTime: new Date(),
      status: 'ON_DUTY',
      ordersCompleted: 0,
      totalEarned: 0,
    });
    await this.shiftsRepository.save(shift);
    console.log(`[CLOCK IN] Rider ${riderId}`);
    return {
      riderId,
      status: 'ON_DUTY',
      clockInTime: shift.clockInTime,
      message: 'Successfully clocked in. Good deliveries!',
    };
  }

  async clockOut(riderId: string) {
    const shift = await this.shiftsRepository.findOne({
      where: { riderId, status: 'ON_DUTY' },
      order: { clockInTime: 'DESC' },
    });
    if (!shift) throw new BadRequestException('Rider is not clocked in');
    shift.clockOutTime = new Date();
    shift.status = 'OFF_DUTY';
    await this.shiftsRepository.save(shift);
    const totalMinutes = (shift.clockOutTime.getTime() - shift.clockInTime.getTime()) / 60000;
    return {
      riderId,
      clockInTime: shift.clockInTime,
      clockOutTime: shift.clockOutTime,
      totalMinutes: Math.round(totalMinutes),
      ordersCompleted: shift.ordersCompleted,
      totalEarnedGHS: Number(shift.totalEarned).toFixed(2),
      message: 'Shift ended successfully',
    };
  }

  async getRiderEarnings(riderId: string) {
    // Earnings are read from the immutable ledger (RIDER_PAYOUT credits minus
    // RIDER_PAYOUT_REVERSAL clawbacks) so they always agree with the wallet —
    // a settled-then-refunded delivery no longer counts as earned.
    const s = await this.walletService.getRiderEarningsSummary(riderId);
    return {
      riderId,
      totalEarnedGHS: s.netEarnedGHS,
      completedDeliveries: s.completedDeliveries,
      grossEarnedGHS: s.grossEarnedGHS,
      clawedBackGHS: s.clawedBackGHS,
      walletBalanceGHS: s.walletBalanceGHS,
      reservedGHS: s.reservedGHS,
      availableToWithdrawGHS: s.availableToWithdrawGHS,
      message: 'Earnings ready',
    };
  }

  // ---------- queries ----------

  /**
   * Customer-facing tracking timeline: the order lifecycle as an ordered
   * list of steps with timestamps. Derived from the order's own fields —
   * no separate event log to drift out of sync.
   */
  async getOrderTimeline(orderId: string, user: ReqUser) {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    const allowed =
      user.role === 'ADMIN' ||
      order.studentId === user.sub ||
      order.vendorId === user.sub ||
      order.assignedRiderId === user.sub;
    if (!allowed) throw new ForbiddenException('You cannot view this order');

    type Step = { key: string; label: string; at: Date | null; state: 'done' | 'current' | 'pending' | 'terminal' };
    const terminalCancelled = ['CANCELLED', 'REFUNDED'].includes(order.status);
    const steps: Step[] = [
      { key: 'PLACED', label: 'Order placed', at: order.createdAt, state: 'done' },
      {
        key: 'CONFIRMED',
        label: order.orderType === 'P2P' ? 'Rider assigned' : 'Vendor confirmed',
        at: order.assignedAt,
        state: order.assignedAt ? 'done' : 'pending',
      },
      { key: 'PICKED_UP', label: 'Picked up', at: order.pickedAt, state: order.pickedAt ? 'done' : 'pending' },
      { key: 'DELIVERED', label: 'Delivered', at: order.deliveredAt, state: order.deliveredAt ? 'done' : 'pending' },
    ];
    if (terminalCancelled) {
      steps.push({
        key: order.status,
        label: order.status === 'REFUNDED' ? 'Cancelled & refunded' : 'Cancelled',
        at: order.cancelledAt,
        state: 'terminal',
      });
    } else if (order.status === 'DISPUTED') {
      steps.push({ key: 'DISPUTED', label: 'Dispute under review', at: null, state: 'terminal' });
    } else if (order.status === 'RESOLVED') {
      steps.push({ key: 'RESOLVED', label: 'Dispute resolved', at: null, state: 'terminal' });
    } else {
      // Mark the first unfinished step as the current one.
      const next = steps.find((s) => s.state === 'pending');
      if (next) next.state = 'current';
    }

    return {
      orderId: order.id,
      orderType: order.orderType,
      status: order.status,
      pickupLocation: order.pickupLocation,
      deliveryLocation: order.deliveryLocation,
      steps,
    };
  }

  async getMyOrders(studentId: string) {
    return this.ordersRepository.find({
      where: { studentId },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' },
    });
  }

  async getVendorOrders(vendorId: string) {
    return this.ordersRepository.find({
      where: { vendorId },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAvailableOrders() {
    return this.ordersRepository.find({
      where: { status: 'ASSIGNED' },
      order: { createdAt: 'DESC' },
    });
  }

  async acceptOrder(orderId: string, riderId: string) {
    const onDuty = await this.shiftsRepository.findOne({ where: { riderId, status: 'ON_DUTY' } });
    if (!onDuty) throw new BadRequestException('Clock in before accepting orders');

    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'ASSIGNED') throw new BadRequestException('Order is not available');
    if (order.assignedRiderId && order.assignedRiderId !== riderId) {
      throw new BadRequestException('Order already assigned to another rider');
    }
    order.assignedRiderId = riderId;
    if (!order.assignedAt) order.assignedAt = new Date();
    order.status = 'PICKED_UP';
    if (!order.pickedAt) order.pickedAt = new Date();
    await this.ordersRepository.save(order);
    return { message: 'Order accepted successfully', order };
  }

  async getRiderDeliveries(riderId: string) {
    return this.ordersRepository.find({
      where: { assignedRiderId: riderId },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllOrders() {
    return this.ordersRepository.find({
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllDisputes() {
    return this.ordersRepository.find({
      where: { status: 'DISPUTED' },
      relations: ['orderItems', 'orderItems.menuItem'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAllRiderShifts() {
    return this.shiftsRepository.find({ order: { clockInTime: 'DESC' }, take: 200 });
  }
}
