import { Injectable, NestMiddleware } from '@nestjs/common';
import {
  createRequestCorrelation,
  REQUEST_ID_HEADER,
  runWithLogContext,
} from '@nrapp/observability';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../interfaces/request-context.interface';

export { REQUEST_ID_HEADER, SAFE_REQUEST_ID } from '@nrapp/observability';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    request: RequestWithContext,
    response: Response,
    next: NextFunction,
  ): void {
    const { requestId } = createRequestCorrelation(
      request.headers[REQUEST_ID_HEADER],
    );

    request.requestContext = { requestId };
    request.headers[REQUEST_ID_HEADER] = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    runWithLogContext({ request_id: requestId }, () => next());
  }
}
