import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MenuItem } from '../entities/menu-item.entity';
import { Vendor } from '../entities/vendor.entity';

@Injectable()
export class MenuItemsService {
  constructor(
    @InjectRepository(MenuItem)
    private menuItemRepository: Repository<MenuItem>,
    @InjectRepository(Vendor)
    private vendorRepository: Repository<Vendor>,
  ) {}

  async create(dto: any, vendorId: string) {
    try {
      console.log('Creating menu item for vendor:', vendorId, 'Data:', dto);

      const vendor = await this.vendorRepository.findOne({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      const menuItem = this.menuItemRepository.create({
        name: dto.name,
        price: Number(dto.price),
        description: dto.description || null,
        imageUrl: dto.imageUrl || null,   // ← Fixed
        isAvailable: true,
        vendorId: vendorId,
      });

      const saved = await this.menuItemRepository.save(menuItem);
      console.log('✅ Menu item saved successfully:', saved);
      return saved;
    } catch (error) {
      console.error('❌ Error saving menu item:', error);
      throw error;
    }
  }

  async findByVendor(vendorId: string) {
    return this.menuItemRepository.find({
      where: { vendorId, isAvailable: true },
      order: { name: 'ASC' }
    });
  }

  async findAll() {
    return this.menuItemRepository.find({ where: { isAvailable: true } });
  }

  async findOne(id: string) {
    const item = await this.menuItemRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async update(id: string, dto: any, vendorId: string) {
    const item = await this.menuItemRepository.findOne({ where: { id, vendorId } });
    if (!item) throw new NotFoundException('Menu item not found or not yours');

    await this.menuItemRepository.update(id, {
      name: dto.name,
      price: Number(dto.price),
      description: dto.description,
      imageUrl: dto.imageUrl !== undefined ? dto.imageUrl : item.imageUrl,  // ← Fixed
    });

    return this.findOne(id);
  }

  async remove(id: string, vendorId: string) {
    const item = await this.menuItemRepository.findOne({ where: { id, vendorId } });
    if (!item) throw new NotFoundException('Menu item not found or not yours');

    await this.menuItemRepository.delete(id);
    return { message: 'Menu item deleted successfully' };
  }
}