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
