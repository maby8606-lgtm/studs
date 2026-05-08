import { Injectable, BadRequestException, UnauthorizedException } from 
'@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private users = new Map();   // email -> user
  private wallets = new Map(); // userId -> wallet

  constructor(private jwtService: JwtService) {}

  async register(dto: any) {
    if (this.users.has(dto.email)) {
      throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const userId = 'user_' + Date.now().toString(36) + 
Math.random().toString(36).substr(2);

    const user = {
      id: userId,
      email: dto.email,
      password: hashedPassword,
      role: dto.role || 'STUDENT',
      name: dto.name,
      phone: dto.phone,
      campusId: dto.campusId,
      createdAt: new Date(),
    };

    this.users.set(dto.email, user);

    this.wallets.set(userId, {
      id: 'wallet_' + Date.now(),
      userId,
      balance: 0.00,
    });

    console.log(`[NEW-USER-WALLET] Created for ${user.role} 
${dto.email}`);

    return this.generateToken(user);
  }

  async login(dto: any) {
    const user = this.users.get(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    return this.generateToken(user);
  }

  private generateToken(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role };
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
    return this.wallets.get(userId);
  }

  updateWallet(userId: string, amount: number) {
    const wallet = this.wallets.get(userId);
    if (wallet) {
      wallet.balance += amount;
      console.log(`[WALLET UPDATE] User ${userId} | New balance: 
${wallet.balance}`);
    }
  }
}
