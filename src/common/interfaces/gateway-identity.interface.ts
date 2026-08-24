import type { Request } from 'express';

export interface GatewayIdentity {
  _id: string;
  email?: string;
  role?: string;
  username?: string;
}

export interface RequestWithGatewayIdentity extends Request {
  user?: GatewayIdentity;
}

export function parseGatewayIdentity(value: unknown): GatewayIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record._id !== 'string' || record._id.length === 0) {
    return null;
  }

  return {
    _id: record._id,
    ...(typeof record.email === 'string' ? { email: record.email } : {}),
    ...(typeof record.role === 'string' ? { role: record.role } : {}),
    ...(typeof record.username === 'string'
      ? { username: record.username }
      : {}),
  };
}
