import type { Request } from 'express';

/** Dữ liệu theo suốt một HTTP request để tracing và logging. */
export interface RequestContext {
  requestId: string;
  startedAt: bigint;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
  user?: {
    _id?: unknown;
    id?: unknown;
  };
}
