import { Controller, Get, Patch, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FraudService } from './fraud.service';

@Controller('admin/fraud-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.fraud.list(status);
  }

  @Patch(':id/resolve')
  async resolve(@Param('id') id: string) {
    const flag = await this.fraud.resolve(id);
    if (!flag) throw new NotFoundException('Fraud flag not found');
    return flag;
  }
}
