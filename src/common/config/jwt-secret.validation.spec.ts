import { JwtService } from '@nestjs/jwt';
import { createJwtKey, requireJwtSecret } from './jwt-secret';

describe('requireJwtSecret', () => {
  it('từ chối JWT secret bị thiếu hoặc quá ngắn', () => {
    expect(() => requireJwtSecret(undefined)).toThrow('JWT_SECRET');
    expect(() => requireJwtSecret('short-secret')).toThrow('ít nhất 32 byte');
    expect(() =>
      requireJwtSecret('replace_with_at_least_32_random_characters'),
    ).toThrow('JWT_SECRET');
  });

  it('trả về JWT secret hợp lệ đã được chuẩn hóa', () => {
    const secret = '0123456789abcdef0123456789abcdef';

    expect(requireJwtSecret(`  ${secret}  `)).toBe(secret);
  });

  it('ký và xác minh access token bằng khóa tạo sẵn', () => {
    const jwt = new JwtService({
      secret: createJwtKey('0123456789abcdef0123456789abcdef'),
      verifyOptions: { algorithms: ['HS256'] },
    });
    const token = jwt.sign({ tokenType: 'access', user: { _id: 'user-id' } });
    expect(jwt.verify(token)).toMatchObject({
      tokenType: 'access',
      user: { _id: 'user-id' },
    });
  });
});
