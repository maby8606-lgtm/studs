import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, Req, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { MenuItemsService } from './menu-items.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Step 5 fix: the controller used to pass the file path as `image` while the
// service reads `dto.imageUrl` — every uploaded photo was silently discarded.
// It now passes `imageUrl`, plus real validation (type + size).
const imageUploadOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (req, file, cb) => {
      const safeExt = extname(file.originalname).toLowerCase().slice(0, 5);
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${uniqueSuffix}${safeExt || '.jpg'}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new BadRequestException('Only image files (jpg, png, webp, gif) are allowed'), false);
  },
};

@Controller('menu-items')
export class MenuItemsController {
  constructor(private readonly menuItemsService: MenuItemsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  async create(@Body() dto: any, @UploadedFile() file: any, @Req() req) {
    const data = {
      name: dto.name,
      price: dto.price,
      description: dto.description,
      imageUrl: file ? `/uploads/${file.filename}` : null,
    };
    return this.menuItemsService.create(data, req.user.sub);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  @UseInterceptors(FileInterceptor('image', imageUploadOptions))
  async update(@Param('id') id: string, @Body() dto: any, @UploadedFile() file: any, @Req() req) {
    const data = {
      name: dto.name,
      price: dto.price,
      description: dto.description,
      imageUrl: file ? `/uploads/${file.filename}` : undefined,
    };
    return this.menuItemsService.update(id, data, req.user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  async remove(@Param('id') id: string, @Req() req) {
    return this.menuItemsService.remove(id, req.user.sub);
  }

  @Get('my-items')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'ADMIN')
  getMyItems(@Req() req) {
    return this.menuItemsService.findByVendor(req.user.sub);
  }

  @Get()
  getAll() {
    return this.menuItemsService.findAll();
  }
}
