import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { flushLogger, logException } from '@nrapp/observability';
import { AppModule } from './app.module';
import { appLogger, nestLogger } from './common/logging/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: nestLogger });
  app.enableShutdownHooks();

  // Kích hoạt auto-validate dữ liệu đầu vào theo class DTO
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Xóa các trường không được định nghĩa trong DTO gửi lên
      transform: true, // Tự động convert data type về dạng được định nghĩa ở DTO
    }),
  );
  const port = process.env.PORT || 4000;
  await app.listen(port);
  appLogger.info(
    {
      'event.name': 'service.started',
      'server.port': Number(port),
    },
    'Auth service đã khởi động',
  );
}

void bootstrap().catch(async (error: unknown) => {
  logException(
    appLogger,
    'process.bootstrap.failed',
    error,
    {},
    {
      message: 'Không thể khởi động dịch vụ xác thực',
      classification: {
        statusCode: 500,
        code: 'BOOTSTRAP_FAILED',
        expected: false,
        retryable: false,
        logLevel: 'fatal',
      },
    },
  );
  await flushLogger(appLogger);
  process.exitCode = 1;
});
