import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Injectable,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { handleOriginHttpException } from '@nrapp/observability';
import type { RequestWithContext } from '../interfaces/request-context.interface';
import { appLogger } from '../observability/app-logger';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<RequestWithContext>();
    const result = handleOriginHttpException(appLogger, exception, {
      requestId: request.requestContext?.requestId ?? 'unknown',
      method: request.method,
      route: routeTemplate(request),
      eventName: 'auth.http.request.failed',
    });

    this.httpAdapterHost.httpAdapter.reply(
      httpContext.getResponse(),
      result.body,
      result.statusCode,
    );
  }
}

function routeTemplate(request: RequestWithContext): string {
  const route: unknown = request.route;
  const routePath = isRecord(route) ? route.path : undefined;
  if (typeof routePath !== 'string') return 'unknown';
  return `${request.baseUrl ?? ''}${routePath}` || '/';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
