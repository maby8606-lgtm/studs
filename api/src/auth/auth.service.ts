import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from '../entities/vendor.entity';

@Injectable()
export class AuthService {
  private users = new Map<string, any>(); // email -> user
  private wallets = new Map<string, any>(); // userId -> wallet

  constructor(
    private jwtService: JwtService,
    @InjectRepository(Vendor)
    private vendorsRepository: Repository<Vendor>,
  ) {}

  async register(dto: any) {
    if (this.users.has(dto.email)) {
      throw new BadRequestException('Email already exists');
    }

    const validRoles = ['STUDENT', 'RIDER', 'VENDOR', 'ADMIN'];
    const role = validRoles.includes(dto.role?.toUpperCase())
      ? dto.role.toUpperCase()
      : 'STUDENT';

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const userId = 'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2);

    const user = {
      id: userId,
      email: dto.email,
      password: hashedPassword,
      role: role,
      name: dto.name || '',
      phone: dto.phone || '',
      campusId: dto.campusId || '',
      createdAt: new Date(),
    };

    this.users.set(dto.email, user);
    this.wallets.set(userId, {
      id: 'wallet_' + Date.now(),
      userId,
      balance: 0.00,
    });

    if (role === 'VENDOR') {
      try {
        const vendor = this.vendorsRepository.create({
          id: userId,
          name: dto.name || dto.email.split('@')[0],
          campusId: dto.campusId || 'legon',
          location: dto.location || 'Main Campus',
          phone: dto.phone || '',
          isActive: true,
        });
        await this.vendorsRepository.save(vendor);
        console.log(`[VENDOR CREATED] ID: ${userId} - ${dto.email}`);
      } catch (e) {
        console.error('Failed to create vendor record:', e.message);
      }
    }

    console.log(`[NEW-USER-WALLET] Created for ${role} - ${dto.email}`);
    return this.generateToken(user);
  }

  async login(dto: any) {
    const user = this.users.get(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    return this.generateToken(user);
  }

  async updateProfile(userId: string, campusId: string) {
    let user = null;

    // Safe fallback: search by ID even if user is not in the Map
    for (const [email, u] of this.users) {
      if (u.id === userId) {
        user = u;
        break;
      }
    }

    if (!user) {
      // Try to find by old user records or return error
      throw new BadRequestException('User not found');
    }

    user.campusId = campusId;

    // Update Vendor table if needed
    if (user.role === 'VENDOR') {
      try {
        await this.vendorsRepository.update({ id: userId }, { campusId });
      } catch (e) {
        console.error('Failed to update Vendor campusId:', e.message);
      }
    }

    return { message: 'Profile updated', campusId: user.campusId };
  }

  private generateToken(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      }
    };
  }

  getWallet(userId: string) {
    return this.wallets.get(userId) || { balance: 0, currency: 'GHS' };
  }

  updateWallet(userId: string, amount: number) {
    const wallet = this.wallets.get(userId);
    if (wallet) {
      wallet.balance += amount;
      console.log(`[WALLET UPDATE] User ${userId} | New balance: ${wallet.balance}`);
      return wallet.balance;
    }
    return 0;
  }
}