import "reflect-metadata";
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { raw } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // CORS
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true,
  });

  // Serve static uploads folder
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // Payment webhooks are verified against the EXACT raw request body
  // (HMAC signature). Capture it untouched for webhook routes BEFORE the
  // JSON parser runs — parsed JSON would break signature verification.
  app.use('/payments/webhook', raw({ type: '*/*', limit: '1mb' }));
  app.use('/whatsapp/webhook', raw({ type: '*/*', limit: '1mb' }));

  // Important for file uploads
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '50mb' });

  const config = new DocumentBuilder()
    .setTitle('STUDS API')
    .setDescription('Campus Food Delivery API')
    .setVersion('2.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  console.log(`🚀 STUDS API 2.0 running on http://localhost:${port}`);
  console.log(`📄 Swagger Documentation: http://localhost:${port}/api-docs`);
}
bootstrap();