import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { of } from 'rxjs';
import type { RequestWithContext } from '../interfaces/request-context.interface';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { HttpLoggingInterceptor } from './http-logging.interceptor';

describe('HttpLoggingInterceptor', () => {
  it('ghi log completed với các field HTTP bắt buộc', (done) => {
    const logger = {
      info: jest.fn(),
    } as unknown as StructuredLoggerService;
    const request = {
      method: 'GET',
      originalUrl: '/api/auth/me',
      requestContext: {
        requestId: 'request-123',
        startedAt: process.hrtime.bigint(),
      },
      user: { _id: 'user-123' },
    } as unknown as RequestWithContext;
    const response = { statusCode: 200 } as Response;
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ ok: true }) } as CallHandler;
    const interceptor = new HttpLoggingInterceptor(logger);

    interceptor.intercept(context, next).subscribe({
      complete: () => {
        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
          'http_request_completed',
          expect.objectContaining({
            requestId: 'request-123',
            userId: 'user-123',
            method: 'GET',
            path: '/api/auth/me',
            statusCode: 200,
            durationMs: expect.any(Number),
          }),
        );
        done();
      },
    });
  });
});
