import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../common/middleware/request-id.middleware';
import { StructuredLoggerService } from '../common/observability/structured-logger.service';
import { TelemetryLifecycleService } from '../common/observability/telemetry-lifecycle.service';
import { GatewaySignatureService } from '../common/security/gateway-signature.service';

/** Đăng ký các concern áp dụng xuyên suốt toàn bộ HTTP application. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    StructuredLoggerService,
    GatewaySignatureService,
    TelemetryLifecycleService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [StructuredLoggerService, GatewaySignatureService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
