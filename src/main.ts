import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Kích hoạt auto-validate dữ liệu đầu vào theo class DTO
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Xóa các trường không được định nghĩa trong DTO gửi lên
    transform: true, // Tự động convert data type về dạng được định nghĩa ở DTO
  }));
  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Auth Service NestJS is running on: http://localhost:${port}`);
}
bootstrap();