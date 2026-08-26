import { UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';

describe('AuthService refresh token', () => {
  const userId = new Types.ObjectId();
  const credential = {
    _id: userId,
    email: 'user@example.com',
    role: 'user',
  };

  function createService(canRotate = true) {
    const credentialModel = {
      findById: jest.fn().mockResolvedValue(credential),
    };
    const jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: userId.toString(),
        jti: 'refresh-id',
        tokenType: 'refresh',
      }),
      sign: jest
        .fn()
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token'),
    };
    const redisService = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue(canRotate),
    };
    const service = new AuthService(
      credentialModel as never,
      jwtService as never,
      redisService as never,
      {} as never,
      { get: jest.fn().mockReturnValue('http://user.test') } as never,
    );

    return { service, credentialModel, jwtService, redisService };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('xác minh hạn dùng và xoay refresh token sau mỗi lần dùng', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('user unavailable'));
    const { service, jwtService, redisService } = createService();

    await expect(
      service.refreshToken('old-refresh-token', 'request-id'),
    ).resolves.toEqual({
      message: 'Làm mới token thành công!',
      token: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: {
        _id: userId,
        email: credential.email,
        username: '',
        role: credential.role,
      },
    });

    expect(jwtService.verify).toHaveBeenCalledWith('old-refresh-token');
    expect(redisService.rotate).toHaveBeenCalledWith(
      `refresh_token:${userId.toString()}`,
      'refresh-id',
      expect.any(String),
      30 * 24 * 60 * 60,
    );
  });

  it('từ chối refresh token đã bị thay thế', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('user unavailable'));
    const { service, credentialModel, jwtService } = createService(false);

    await expect(
      service.refreshToken('old-refresh-token', 'request-id'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(credentialModel.findById).toHaveBeenCalledWith(userId.toString());
    expect(jwtService.sign).toHaveBeenCalledTimes(2);
  });

  it('không cho dùng refresh token để truy cập API', async () => {
    const { service, credentialModel } = createService();

    await expect(service.validateToken('refresh-token')).resolves.toEqual({
      valid: false,
      message: 'Refresh token không thể dùng để truy cập API',
    });
    expect(credentialModel.findById).not.toHaveBeenCalled();
  });
});
