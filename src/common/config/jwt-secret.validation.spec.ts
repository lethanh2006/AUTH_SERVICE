import { requireJwtSecret } from './jwt-secret';

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
});
