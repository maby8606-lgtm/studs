import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from '../entities/vendor.entity';

@Injectable()
export class VendorsService {
  constructor(
    @InjectRepository(Vendor)
    private vendorsRepository: Repository<Vendor>,
  ) {}

  async create(dto: any) {
    const allowed = ['ug-legon', 'upsa'];
    if (!allowed.includes(dto.campusId)) {
      throw new BadRequestException('Campus not allowed');
    }

    const vendor = this.vendorsRepository.create({
      name: dto.name,
      campusId: dto.campusId,
      location: dto.location,
      phone: dto.phone,
    });

    return this.vendorsRepository.save(vendor);
  }

  async findAll(campusId?: string) {
    const where = campusId ? { campusId, isActive: true } : { isActive: true };
    return this.vendorsRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const vendor = await this.vendorsRepository.findOne({ where: { id } });
    if (!vendor) throw new BadRequestException('Vendor not found');
    return vendor;
  }
}