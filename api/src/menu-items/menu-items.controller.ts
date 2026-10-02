import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { MenuItemsService } from './menu-items.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('menu-items')
export class MenuItemsController {
  constructor(private readonly menuItemsService: MenuItemsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
      },
    }),
  }))
  async create(@Body() dto: any, @UploadedFile() file: any, @Req() req) {
    console.log('CREATE route hit with file!');
    const data = {
      name: dto.name,
      price: dto.price,
      description: dto.description,
      image: file ? `/uploads/${file.filename}` : null,
    };
    return this.menuItemsService.create(data, req.user.sub);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
      },
    }),
  }))
  async update(@Param('id') id: string, @Body() dto: any, @UploadedFile() file: any, @Req() req) {
    const data = {
      name: dto.name,
      price: dto.price,
      description: dto.description,
      image: file ? `/uploads/${file.filename}` : undefined,
    };
    return this.menuItemsService.update(id, data, req.user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.menuItemsService.remove(id, req.user.sub);
  }

  @Get('my-items')
  @UseGuards(JwtAuthGuard)
  getMyItems(@Req() req) {
    return this.menuItemsService.findByVendor(req.user.sub);
  }

  @Get()
  getAll() {
    return this.menuItemsService.findAll();
  }
}