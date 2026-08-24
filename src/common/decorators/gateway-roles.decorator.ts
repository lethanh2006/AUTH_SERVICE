import { SetMetadata } from '@nestjs/common';

export const GATEWAY_ROLES_KEY = 'gatewayRoles';

export const GatewayRoles = (...roles: string[]) =>
  SetMetadata(GATEWAY_ROLES_KEY, roles);
