import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../interfaces/request-context.interface';
import {
  RequestIdMiddleware,
  SAFE_REQUEST_ID,
} from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  const runMiddleware = (incomingRequestId?: string) => {
    const request = {
      headers:
        incomingRequestId === undefined
          ? {}
          : { 'x-request-id': incomingRequestId },
    } as unknown as RequestWithContext;
    const response = {
      setHeader: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);

    return { next, request, response };
  };

  it('giữ nguyên x-request-id hợp lệ', () => {
    const result = runMiddleware('gateway-request_123:abc');

    expect(result.request.requestContext?.requestId).toBe(
      'gateway-request_123:abc',
    );
    expect(result.request.headers['x-request-id']).toBe(
      'gateway-request_123:abc',
    );
    expect(result.response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'gateway-request_123:abc',
    );
    expect(typeof result.request.requestContext?.startedAt).toBe('bigint');
    expect(result.next).toHaveBeenCalledTimes(1);
  });

  it('tự sinh request ID khi không có header', () => {
    const result = runMiddleware();
    const requestId = result.request.requestContext?.requestId;

    expect(requestId).toEqual(expect.any(String));
    expect(requestId).toMatch(SAFE_REQUEST_ID);
    expect(result.response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      requestId,
    );
    expect(result.next).toHaveBeenCalledTimes(1);
  });

  it('thay request ID sai định dạng và vẫn cho request đi tiếp', () => {
    const unsafeRequestId = '../../unsafe request-id';
    const result = runMiddleware(unsafeRequestId);
    const requestId = result.request.requestContext?.requestId;

    expect(requestId).not.toBe(unsafeRequestId);
    expect(requestId).toMatch(SAFE_REQUEST_ID);
    expect(result.request.headers['x-request-id']).toBe(requestId);
    expect(result.response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      requestId,
    );
    expect(result.next).toHaveBeenCalledTimes(1);
  });
});
