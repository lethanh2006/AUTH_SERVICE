import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService giới hạn thử OTP', () => {
  function createService(options?: {
    attempts?: string | null;
    storedOtp?: string | null;
    nextAttempts?: number;
  }) {
    const redisService = {
      get: jest.fn((key: string) => {
        if (key.startsWith('otp_attempts:')) {
          return Promise.resolve(options?.attempts ?? null);
        }
        return Promise.resolve(options?.storedOtp ?? '654321');
      }),
      incrementWithExpiry: jest
        .fn()
        .mockResolvedValue(options?.nextAttempts ?? 1),
      del: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      redisService as never,
      {} as never,
      {} as never,
    );
    return { service, redisService };
  }

  it('đếm mỗi lần nhập OTP sai và giữ bộ đếm trong thời hạn mã', async () => {
    const { service, redisService } = createService();

    await expect(
      service.verifyOtp(
        { email: 'user@example.com', otp: '123456' },
        'request-id',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(redisService.incrementWithExpiry).toHaveBeenCalledWith(
      'otp_attempts:user@example.com',
      5 * 60,
    );
  });

  it('khóa OTP ở lần nhập sai thứ năm', async () => {
    const { service, redisService } = createService({ nextAttempts: 5 });

    await expect(
      service.verifyOtp(
        { email: 'user@example.com', otp: '123456' },
        'request-id',
      ),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(redisService.del).toHaveBeenCalledWith('login_otp:user@example.com');
  });

  it('chặn ngay khi mã đã vượt giới hạn thử', async () => {
    const { service, redisService } = createService({ attempts: '5' });

    await expect(
      service.verifyOtp(
        { email: 'user@example.com', otp: '654321' },
        'request-id',
      ),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(redisService.incrementWithExpiry).not.toHaveBeenCalled();
  });
});
