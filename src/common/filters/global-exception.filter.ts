import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { RequestWithContext } from '../interfaces/request-context.interface';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { toError } from '../utils/error.util';

/** Ghi log lỗi tập trung và trả response HTTP chuẩn kèm request ID. */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: StructuredLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<RequestWithContext>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = toError(exception);
    const requestContext = request.requestContext;
    const userId = request.user?._id ?? request.user?.id;
    const logDetails = {
      requestId: requestContext?.requestId ?? 'unknown',
      ...(userId !== undefined && userId !== null
        ? { userId: String(userId) }
        : {}),
      method: request.method,
      path: request.originalUrl ?? request.url,
      statusCode,
      durationMs: requestContext
        ? Number(process.hrtime.bigint() - requestContext.startedAt) / 1e6
        : 0,
      errorName: error.name,
      message: error.message,
    };

    if (statusCode >= 500) {
      this.logger.error('http_request_failed', logDetails, error.stack);
    } else {
      this.logger.warn('http_request_rejected', logDetails);
    }

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const responseBody =
      exceptionResponse !== null &&
      typeof exceptionResponse === 'object' &&
      !Array.isArray(exceptionResponse)
        ? {
            ...(exceptionResponse as Record<string, unknown>),
            requestId: requestContext?.requestId ?? 'unknown',
          }
        : {
            statusCode,
            message: exceptionResponse ?? 'Internal server error',
            requestId: requestContext?.requestId ?? 'unknown',
          };

    httpAdapter.reply(httpContext.getResponse(), responseBody, statusCode);
  }
}
