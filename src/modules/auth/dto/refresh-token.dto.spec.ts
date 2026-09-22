import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefreshTokenDto } from './refresh-token.dto';

describe('RefreshTokenDto', () => {
  it('từ chối access token cũ được gửi bằng trường token', async () => {
    const dto = plainToInstance(RefreshTokenDto, {
      token: 'legacy-access-token',
    });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('nhận refresh token đúng trường và đúng định dạng JWT', async () => {
    const dto = plainToInstance(RefreshTokenDto, {
      refreshToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
