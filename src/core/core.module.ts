import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { GatewaySignatureService } from '../common/gateway-signature.service';
import { GlobalExceptionFilter } from '../common/global-exception.filter';
import {
  StructuredLoggerService,
  TelemetryLifecycleService,
} from '../common/observability';
import { RequestIdMiddleware } from '../common/request-id.middleware';

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
