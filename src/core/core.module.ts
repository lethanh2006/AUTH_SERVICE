import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { GatewaySignatureService } from '../common/security/gateway-signature.service';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { LoggerLifecycleService } from '../common/logging/logger';
import { RequestIdMiddleware } from '../common/middleware/request-id.middleware';

/** Đăng ký các concern áp dụng xuyên suốt toàn bộ HTTP application. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    GatewaySignatureService,
    LoggerLifecycleService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [GatewaySignatureService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
