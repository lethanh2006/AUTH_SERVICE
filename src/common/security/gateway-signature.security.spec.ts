import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { GatewaySignatureService } from './gateway-signature.service';

describe('GatewaySignatureService', () => {
  const secret = '0123456789abcdef0123456789abcdef';

  it('chấp nhận chữ ký đúng và ràng buộc method/path', () => {
    const service = new GatewaySignatureService(
      new ConfigService({ JWT_SECRET: secret }),
    );
    const timestamp = Date.now().toString();
    const context = 'GET:/api/auth/me';
    const payload = 'encoded-user';
    const requestId = 'request-123';
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${requestId}.${payload}.${context}`)
      .digest('hex');

    expect(() =>
      service.assertTrusted({
        context,
        payload,
        requestId,
        signature,
        timestamp,
      }),
    ).not.toThrow();
    expect(() =>
      service.assertTrusted({
        context: 'DELETE:/api/auth/me',
        payload,
        requestId,
        signature,
        timestamp,
      }),
    ).toThrow('Chữ ký Gateway không hợp lệ');
  });

  it('từ chối secret yếu', () => {
    expect(
      () =>
        new GatewaySignatureService(
          new ConfigService({ JWT_SECRET: 'short' }),
        ),
    ).toThrow('ít nhất 32 byte');
  });

  it('từ chối secret mẫu dù đủ độ dài', () => {
    expect(
      () =>
        new GatewaySignatureService(
          new ConfigService({
            AUTH_INTERNAL_SECRET:
              'replace_with_at_least_32_random_characters',
            JWT_SECRET: secret,
          }),
        ),
    ).toThrow('ít nhất 32 byte');
  });
});
