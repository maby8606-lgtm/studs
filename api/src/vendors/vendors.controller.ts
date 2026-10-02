import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('vendors')
export class VendorsController {
  constructor(private vendorsService: VendorsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
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