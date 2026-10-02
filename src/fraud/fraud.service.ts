import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FraudFlag, FraudFlagType, FraudSeverity } from '../entities/fraud-flag.entity';

@Injectable()
export class FraudService {
  constructor(@InjectRepository(FraudFlag) private readonly flags: Repository<FraudFlag>) {}

  /** Best-effort: recording a signal must never break the operation itself. */
  async record(
    type: FraudFlagType,
    opts: { userId?: string | null; orderId?: string | null; detail: string; severity?: FraudSeverity },
  ): Promise<void> {
    try {
      await this.flags.save(
        this.flags.create({
          type,
          severity: opts.severity || 'LOW',
          userId: opts.userId || null,
          orderId: opts.orderId || null,
          detail: opts.detail.slice(0, 1000),
        }),
      );
    } catch {
      /* intentionally swallowed */
    }
  }

  async list(status?: string) {
    return this.flags.find({
      where: status ? { status: status as 'OPEN' | 'RESOLVED' } : {},
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async resolve(id: string) {
    const flag = await this.flags.findOne({ where: { id } });
    if (!flag) return null;
    flag.status = 'RESOLVED';
    flag.resolvedAt = new Date();
    return this.flags.save(flag);
  }

  /** Gate for automated money movement: an unresolved HIGH flag stops auto-payouts. */
  async hasOpenHighFlag(userId: string): Promise<boolean> {
    const count = await this.flags.count({ where: { userId, status: 'OPEN', severity: 'HIGH' } });
    return count > 0;
  }
}
