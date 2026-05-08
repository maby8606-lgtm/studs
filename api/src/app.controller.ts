import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return { 
      status: '✅ STUDS API 2.0 is live', 
      message: 'Rebuilding stronger' 
    };
  }
}
