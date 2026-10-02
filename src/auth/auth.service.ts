import { Injectable, BadRequestException, UnauthorizedException, OnModuleInit, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Vendor } from '../entities/vendor.entity';

/**
 * Public self-registration is limited to these roles. ADMIN is deliberately
 * excluded: admin accounts can only be created by an existing administrator
 * (POST /auth/admins) or via the one-time ADMIN_SEED_* bootstrap below.
 */
const PUBLIC_ROLES = ['STUDENT', 'RIDER', 'VENDOR'];

/**
 * Step 1 fix: users are persisted in the database via the User repository.
 * The old in-memory Maps are gone — registrations survive restarts.
 * Wallet money movement lives in WalletService (ledger); this service only
 * reads the cached balance for the GET /wallet shape.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Vendor)
    private vendorsRepository: Repository<Vendor>,
  ) {}

  /**
   * One-time bootstrap: if the database has no admin yet and ADMIN_SEED_EMAIL /
   * ADMIN_SEED_PASSWORD are set, create the first administrator. Runs on every
   * boot but is a no-op once an admin exists. Remove the seed vars from .env
   * after the first successful boot.
   */
  async onModuleInit() {
    const existingAdmin = await this.usersRepository.findOne({ where: { role: 'ADMIN' } });
    if (existingAdmin) return;

    const seedEmail = (this.configService.get<string>('ADMIN_SEED_EMAIL') || '').trim().toLowerCase();
    const seedPassword = this.configService.get<string>('ADMIN_SEED_PASSWORD') || '';
    if (!seedEmail || !seedPassword) {
      this.logger.warn(
        'No admin account exists and ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD are not set. ' +
        'Set them in .env to bootstrap the first administrator, then remove them.',
      );
      return;
    }
    if (seedPassword.length < 6) {
      this.logger.error('ADMIN_SEED_PASSWORD must be at least 6 characters. Skipping admin bootstrap.');
      return;
    }
    const already = await this.usersRepository.findOne({ where: { email: seedEmail } });
    if (already) {
      this.logger.warn(`Seed email ${seedEmail} is already registered; skipping admin bootstrap.`);
      return;
    }
    await this.createAdmin({ email: seedEmail, password: seedPassword, name: 'Administrator' });
    this.logger.log(`Bootstrapped first admin account (${seedEmail}). Remove ADMIN_SEED_* from .env now.`);
  }

  async register(dto: any) {
    const email = (dto.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    // Payment gateways reject non-routable addresses at charge time (a user
    // who can register but can never pay is worse than one told up front).
    if (
      !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(email) ||
      /\.(test|example|invalid|localhost|local|internal)$/.test(email)
    ) {
      throw new BadRequestException('A valid, deliverable email address is required');
    }
    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already exists');

    const requestedRole = (dto.role || '').toUpperCase();
    if (requestedRole === 'ADMIN') {
      throw new BadRequestException(
        'Admin accounts cannot be self-registered. An existing administrator must create them.',
      );
    }
    const role = PUBLIC_ROLES.includes(requestedRole) ? requestedRole : 'STUDENT';

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = this.usersRepository.create({
      email,
      password: hashedPassword,
      role,
      name: dto.name || '',
      phone: dto.phone || '',
      campusId: dto.campusId || '',
      balance: 0,
    });
    await this.usersRepository.save(user);

    if (role === 'VENDOR') {
      const vendor = this.vendorsRepository.create({
        id: user.id,
        name: dto.name || email.split('@')[0],
        campusId: dto.campusId || 'ug-legon',
        location: dto.location || 'Main Campus',
        phone: dto.phone || '',
        isActive: true,
      });
      await this.vendorsRepository.save(vendor);
      console.log(`[VENDOR CREATED] ID: ${user.id} - ${email}`);
    }

    console.log(`[REGISTER] ${role} - ${email}`);
    return this.generateToken(user);
  }

  /**
   * Creates an ADMIN user. Never exposed publicly — only called by the
   * admin-only POST /auth/admins endpoint and the one-time seed bootstrap.
   */
  async createAdmin(dto: { email: string; password: string; name?: string; campusId?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    const existing = await this.usersRepository.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Email already exists');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepository.create({
      email,
      password: hashedPassword,
      role: 'ADMIN',
      name: dto.name || '',
      phone: '',
      campusId: dto.campusId || '',
      balance: 0,
    });
    await this.usersRepository.save(user);

    console.log(`[ADMIN CREATED] ${email}`);
    return this.generateToken(user);
  }

  async login(dto: any) {
    const email = (dto.email || '').trim().toLowerCase();
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.role === 'PLATFORM') {
      // Internal ledger account; not a loginable identity.
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password || '', user.password);
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    return this.generateToken(user);
  }

  async updateProfile(userId: string, body: { name?: string; phone?: string; campusId?: string }) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    if (body.name !== undefined) user.name = body.name;
    if (body.phone !== undefined) user.phone = body.phone;
    if (body.campusId !== undefined) {
      user.campusId = body.campusId;
      if (user.role === 'VENDOR') {
        await this.vendorsRepository.update({ id: userId }, { campusId: body.campusId });
      }
    }
    await this.usersRepository.save(user);

    return {
      message: 'Profile updated',
      user: { id: user.id, name: user.name, phone: user.phone, campusId: user.campusId },
    };
  }

  async findById(userId: string) {
    return this.usersRepository.findOne({ where: { id: userId } });
  }

  private generateToken(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    };
  }
}
