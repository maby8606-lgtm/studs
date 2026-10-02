import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('vendors')
export class VendorsController {
  constructor(private vendorsService: VendorsService) {}

  // Vendor onboarding is handled via /auth/register (role=VENDOR), which
  // auto-creates the vendor record. Direct creation stays admin-only.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: any) {
    return this.vendorsService.create(dto);
  }

  @Get()
  findAll(@Query('campusId') campusId?: string) {
    return this.vendorsService.findAll(campusId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vendorsService.findOne(id);
  }
}
