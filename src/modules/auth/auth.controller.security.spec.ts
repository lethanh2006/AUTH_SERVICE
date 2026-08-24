import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GATEWAY_ROLES_KEY } from '../../common/decorators/gateway-roles.decorator';
import { GatewayIdentityGuard } from '../../common/guards/gateway-identity.guard';
import { AuthController } from './auth.controller';

describe('AuthController security metadata', () => {
  const guardedMethods: Array<keyof AuthController> = [
    'updateUserRole',
    'getMyProfile',
    'updateMyEmail',
    'deleteMyAccount',
    'getUserProfileByAdmin',
    'deleteUserByAdmin',
  ];

  it.each(guardedMethods)('bắt buộc chữ ký Gateway cho %s', (methodName) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AuthController.prototype[methodName],
    ) as unknown[] | undefined;

    expect(guards).toContain(GatewayIdentityGuard);
  });

  it.each([
    'updateUserRole',
    'getUserProfileByAdmin',
    'deleteUserByAdmin',
  ] as Array<keyof AuthController>)(
    'bắt buộc vai trò admin cho %s',
    (methodName) => {
      expect(
        Reflect.getMetadata(
          GATEWAY_ROLES_KEY,
          AuthController.prototype[methodName],
        ),
      ).toEqual(['admin']);
    },
  );
});
