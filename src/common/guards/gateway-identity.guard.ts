import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GATEWAY_ROLES_KEY } from '../decorators/gateway-roles.decorator';
import {
  parseGatewayIdentity,
  RequestWithGatewayIdentity,
} from '../interfaces/gateway-identity.interface';
import { GatewaySignatureService } from '../security/gateway-signature.service';

@Injectable()
export class GatewayIdentityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly signatureService: GatewaySignatureService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithGatewayIdentity>();
    const payload = this.headerValue(request.headers['x-user-payload']);
    if (!payload) {
      throw new UnauthorizedException('Thiếu thông tin định danh người dùng');
    }

    this.signatureService.assertTrusted({
      context: `${request.method.toUpperCase()}:${request.path}`,
      payload,
      requestId: this.headerValue(request.headers['x-request-id']),
      signature: this.headerValue(request.headers['x-user-signature']),
      timestamp: this.headerValue(request.headers['x-user-timestamp']),
    });

    const identity = this.parseIdentity(payload);
    request.user = identity;
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      GATEWAY_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      requiredRoles?.length &&
      !requiredRoles.some(
        (role) => identity.role?.toLowerCase() === role.toLowerCase(),
      )
    ) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }

    return true;
  }

  private headerValue(
    value: string | string[] | undefined,
  ): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private parseIdentity(payload: string) {
    try {
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      const identity = parseGatewayIdentity(JSON.parse(decoded) as unknown);
      if (!identity) throw new Error('Invalid identity');
      return identity;
    } catch {
      throw new UnauthorizedException('Thông tin định danh không hợp lệ');
    }
  }
}
