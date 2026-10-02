import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WhatsappMessage } from '../entities/whatsapp-message.entity';
import { WhatsappSession } from '../entities/whatsapp-session.entity';
import { User } from '../entities/user.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { Vendor } from '../entities/vendor.entity';
import { Order } from '../entities/order.entity';
import { OrdersService } from '../orders/orders.service';
import { zonesForCampus } from '../orders/delivery-zones';

export interface WhatsappSendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

/**
 * WhatsApp ordering channel (Go 2) — same provider-neutral pattern as SMS:
 *
 * - `log` (default): no gateway configured. Inbound webhooks are parsed and
 *   the text-ordering flow runs fully; outbound replies are recorded in the
 *   whatsapp_message outbox with status LOGGED and printed to the console.
 *   Honest dev/offline behavior: the whole flow is exercisable without
 *   anything leaving the machine.
 * - `cloud`: Meta WhatsApp Cloud API. Requires WHATSAPP_ACCESS_TOKEN,
 *   WHATSAPP_PHONE_NUMBER_ID and (for inbound verification)
 *   WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET. Implemented to the
 *   published Cloud API; it activates the moment real credentials exist.
 *
 * Text protocol:
 *   LINK <email>  — bind this phone number to a STUDS account
 *   MENU          — today's items with numbers
 *   ORDER <n>,<m> — pick items, then answer the zone prompt
 *   STATUS        — latest order's status
 *   BALANCE       — wallet balance
 *   HELP          — command list
 */
@Injectable()
export class WhatsappService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(WhatsappMessage)
    private readonly messages: Repository<WhatsappMessage>,
    @InjectRepository(WhatsappSession)
    private readonly sessions: Repository<WhatsappSession>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(MenuItem)
    private readonly menuItems: Repository<MenuItem>,
    @InjectRepository(Vendor)
    private readonly vendors: Repository<Vendor>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    private readonly ordersService: OrdersService,
  ) {}

  private get providerName(): string {
    return (this.config.get<string>('WHATSAPP_PROVIDER') || 'log').toLowerCase();
  }

  /** Deep link for the "Order on WhatsApp" buttons (or null when unset). */
  deeplink(): { configured: boolean; url: string | null } {
    const raw = (this.config.get<string>('WHATSAPP_BUSINESS_NUMBER') || '').replace(/[^0-9]/g, '');
    if (!raw) return { configured: false, url: null };
    return {
      configured: true,
      url: `https://wa.me/${raw}?text=${encodeURIComponent('Hi STUDS! I want to order food.')}`,
    };
  }

  /** Verify Meta's hub.challenge handshake. */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token && expected && token === expected) return challenge;
    return null;
  }

  /** Verify X-Hub-Signature-256 over the EXACT raw body; enforced when the secret is set. */
  signatureValid(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) return true; // dev mode: accept unsigned (documented)
    if (!signature || !rawBody?.length) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  async sendMessage(phone: string, body: string): Promise<WhatsappSendResult> {
    const provider = this.providerName;
    let result: WhatsappSendResult;
    let status: WhatsappMessage['status'] = 'LOGGED';

    if (provider === 'cloud') {
      result = await this.sendViaCloud(phone, body);
      status = result.ok ? 'SENT' : 'FAILED';
    } else {
      console.log(`[WHATSAPP:log] to=${phone} msg="${body.slice(0, 160)}"`);
      result = { ok: true, providerRef: 'log-only' };
      status = 'LOGGED';
    }

    await this.messages.save(
      this.messages.create({ phone, direction: 'OUT', body, provider, status, providerRef: result.providerRef || null }),
    );
    return result;
  }

  private async sendViaCloud(phone: string, body: string): Promise<WhatsappSendResult> {
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (!token || !phoneNumberId) {
      return { ok: false, error: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured' };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body },
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data?.error?.message || `Meta HTTP ${res.status}` };
      }
      return { ok: true, providerRef: data?.messages?.[0]?.id || 'cloud' };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Handle one parsed inbound message; returns the reply text (for tests/admin). */
  async handleInbound(rawPhone: string, text: string): Promise<string> {
    const phone = normalizePhone(rawPhone);
    await this.messages.save(
      this.messages.create({ phone, direction: 'IN', body: text, provider: this.providerName, status: 'RECEIVED' }),
    );

    const session = await this.getSession(phone);
    let reply: string;
    try {
      reply = await this.route(phone, (text || '').trim(), session);
    } catch (err) {
      // Never swallow a customer mid-flow: order errors come back as text.
      reply = `Sorry — ${(err as Error).message || 'something went wrong'}. Text HELP for commands.`;
    }
    await this.sendMessage(phone, reply);
    return reply;
  }

  private async getSession(phone: string): Promise<WhatsappSession> {
    let session = await this.sessions.findOne({ where: { phone } });
    if (!session) {
      session = this.sessions.create({ phone, step: 'IDLE', userId: null, context: null });
      await this.sessions.save(session);
    }
    return session;
  }

  private async route(phone: string, text: string, session: WhatsappSession): Promise<string> {
    const upper = text.toUpperCase();
    if (upper === 'HELP') return this.helpText();
    if (upper.startsWith('LINK ')) return this.linkAccount(phone, text.slice(5).trim(), session);

    const user = await this.findUser(phone, session);
    if (!user) {
      return (
        `Welcome to STUDS 🍔\n` +
        `Text LINK your@email.com to connect your STUDS account, then order with:\n` +
        `MENU — today's items\nORDER 1,3 — pick items\nSTATUS — track your order`
      );
    }

    if (session.step === 'AWAITING_ZONE') {
      return this.handleZoneReply(user, text, session);
    }

    if (upper === 'MENU') return this.showMenu(session);
    if (upper.startsWith('ORDER ')) return this.startOrder(user, text.slice(6).trim(), session);
    if (upper === 'STATUS') return this.showStatus(user);
    if (upper === 'BALANCE') {
      return `Your wallet balance is GHS ${Number(user.balance || 0).toFixed(2)}. Top up from the STUDS app to keep ordering.`;
    }
    return `I didn't catch that. Text HELP for commands.`;
  }

  private helpText(): string {
    return (
      `STUDS on WhatsApp 📲\n` +
      `LINK your@email.com — connect your account\n` +
      `MENU — today's items\n` +
      `ORDER 1,3 — order items by number\n` +
      `STATUS — track your latest order\n` +
      `BALANCE — wallet balance`
    );
  }

  private async linkAccount(phone: string, email: string, session: WhatsappSession): Promise<string> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return `No STUDS account found for ${email}. Register in the app first, then text LINK ${email}.`;
    if (!user.phone) {
      user.phone = rawToDisplay(phone);
      await this.users.save(user);
    }
    session.userId = user.id;
    session.step = 'IDLE';
    session.context = null;
    await this.sessions.save(session);
    return `Linked to ${user.email} ✅ Text MENU to see today's items.`;
  }

  private async findUser(phone: string, session: WhatsappSession): Promise<User | null> {
    if (session.userId) {
      const u = await this.users.findOne({ where: { id: session.userId } });
      if (u) return u;
    }
    const suffix = lastDigits(phone);
    const candidates = await this.users.find();
    for (const c of candidates) {
      if (c.phone && lastDigits(c.phone) === suffix) {
        session.userId = c.id;
        await this.sessions.save(session);
        return c;
      }
    }
    return null;
  }

  private async showMenu(session: WhatsappSession): Promise<string> {
    const items = await this.menuItems.find({ where: { isAvailable: true }, take: 10 });
    if (!items.length) return `No items available right now — check back soon.`;
    const vendorIds = [...new Set(items.map((i) => i.vendorId))];
    const vendors = await this.vendors.find();
    const nameById = new Map(vendors.map((v) => [v.id, v.name]));
    session.context = JSON.stringify({ menuItemIds: items.map((i) => i.id) });
    session.step = 'IDLE';
    await this.sessions.save(session);
    const lines = items.map(
      (i, idx) =>
        `${idx + 1}. ${i.name} — GHS ${Number(i.price).toFixed(2)} (${nameById.get(i.vendorId) || 'vendor'})`,
    );
    return `Today's menu 🍽️\n${lines.join('\n')}\nReply ORDER 1,3 to order.`;
  }

  private async startOrder(user: User, arg: string, session: WhatsappSession): Promise<string> {
    const ctx = session.context ? JSON.parse(session.context) : {};
    const menuItemIds: string[] = ctx.menuItemIds || [];
    if (!menuItemIds.length) return `Text MENU first, then reply ORDER 1,3 with the item numbers.`;
    const picks = [...new Set(arg.split(/[,\s]+/).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= menuItemIds.length))];
    if (!picks.length) return `Pick item numbers from the MENU, e.g. ORDER 1,3.`;
    const itemIds = picks.map((n) => menuItemIds[n - 1]);
    const items = await this.menuItems.find({ where: { isAvailable: true } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const vendorIds = new Set(itemIds.map((id) => byId.get(id)?.vendorId).filter(Boolean));
    if (vendorIds.size > 1) {
      return `Those items are from different vendors — order one vendor per order. Pick items from a single vendor and try again.`;
    }
    const vendorId = [...vendorIds][0];
    const campusId = user.campusId || 'ug-legon';
    const catalog = this.ordersService.getDeliveryZones(campusId);
    const zones = catalog.zones;
    if (!zones.length) return `Ordering is not available for campus ${campusId} yet.`;
    session.step = 'AWAITING_ZONE';
    session.context = JSON.stringify({ itemIds, vendorId });
    await this.sessions.save(session);
    const feeLines = zones
      .map((z, idx) => `${idx + 1}. ${z.name} (delivery GHS ${Number(z.feeGHS).toFixed(2)})`)
      .join('\n');
    return `Where should it be delivered? Reply with the number:\n${feeLines}`;
  }

  private async handleZoneReply(user: User, text: string, session: WhatsappSession): Promise<string> {
    const ctx = session.context ? JSON.parse(session.context) : {};
    const campusId = user.campusId || 'ug-legon';
    const zones = zonesForCampus(campusId);
    const n = Number(text.trim());
    const zone = Number.isInteger(n) && n >= 1 && n <= zones.length ? zones[n - 1] : zones.find((z) => z.id === text.trim().toLowerCase());
    if (!zone) {
      return `I didn't catch the zone. Reply with a number from 1 to ${zones.length}.`;
    }
    if (!ctx.vendorId || !Array.isArray(ctx.itemIds) || !ctx.itemIds.length) {
      return `Your order expired — text MENU to start again.`;
    }
    // create() prices the fee server-side from the zone and debits the wallet atomically.
    // Keep the session in AWAITING_ZONE until it succeeds so the user can top
    // up and retry the same order without starting over.
    let order: any;
    try {
      order = await this.ordersService.create(
        {
          vendorId: ctx.vendorId,
          campusId,
          deliveryLocation: zone.name,
          deliveryZone: zone.id,
          menuItemIds: ctx.itemIds,
        },
        user.id,
      );
    } catch (err: any) {
      return `Sorry — ${err?.message || 'could not place the order'}. Your balance wasn't touched; top up and reply ${zones.indexOf(zone) + 1} to try again.`;
    }
    session.step = 'IDLE';
    session.context = null;
    await this.sessions.save(session);
    return (
      `Order confirmed ✅\n` +
      `Total: GHS ${Number(order.totalGHS).toFixed(2)} (delivery GHS ${Number(order.deliveryFeeGHS).toFixed(2)}${order.deliveryFeeWaived ? ', waived with STUDS Plus' : ''})\n` +
      `Order ID: ${order.orderId}\n` +
      `The vendor is being notified. Text STATUS to track it.`
    );
  }

  private async showStatus(user: User): Promise<string> {
    const order = await this.orders.findOne({
      where: { studentId: user.id },
      order: { createdAt: 'DESC' },
    });
    if (!order) return `No orders yet. Text MENU to start one.`;
    const steps: Record<string, string> = {
      PENDING: 'waiting for the vendor to accept',
      ASSIGNED: 'a rider is on the way to pick it up',
      PICKED_UP: 'the rider is heading to you',
      DELIVERED: 'delivered — enjoy! 🍔',
      CANCELLED: 'cancelled',
      REFUNDED: 'refunded',
      RESOLVED: 'resolved after a dispute',
    };
    return `Latest order ${order.id.slice(0, 8)}…: ${steps[order.status] || order.status} (GHS ${Number(order.total).toFixed(2)}).`;
  }

  /** Admin view of a customer's conversation thread. */
  async conversation(phone: string, take = 50) {
    return this.messages.find({
      where: { phone: normalizePhone(phone) },
      order: { createdAt: 'ASC' },
      take,
    });
  }
}

/** Normalize to Ghana international digits (233…) for session matching. */
function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0')) return '233' + digits.slice(1);
  return digits; // already international or unknown — compare by suffix
}

function lastDigits(phone: string): string {
  return (phone || '').replace(/[^0-9]/g, '').slice(-9);
}

function rawToDisplay(phone: string): string {
  // Store back in local format for humans (0-prefixed, 10 digits).
  if (phone.startsWith('233')) return '0' + phone.slice(3);
  return phone;
}
