import type { Request } from 'express';

/** Request ID để liên kết log trong suốt một HTTP request. */
export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
  user?: {
    _id?: unknown;
    id?: unknown;
  };
}
