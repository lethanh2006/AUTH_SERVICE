import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const FORBIDDEN_INTERNAL_SECRETS = new Set([
  'replace_with_at_least_32_random_characters',
  'your-super-secret-key-chatapp',
  'your_jwt_secret_here',
]);

interface SignedGatewayHeaders {
  context: string;
  payload: string;
  requestId?: string;
  signature?: string;
  timestamp?: string;
}

@Injectable()
export class GatewaySignatureService {
  private readonly maxAgeMs: number;
  private readonly secret: string;

  constructor(configService: ConfigService) {
    const dedicatedSecret = configService
      .get<string>('AUTH_INTERNAL_SECRET')
      ?.trim();
    const secret =
      dedicatedSecret || configService.get<string>('JWT_SECRET')?.trim();
    if (
      !secret ||
      Buffer.byteLength(secret) < 32 ||
      FORBIDDEN_INTERNAL_SECRETS.has(secret.toLowerCase())
    ) {
      throw new Error(
        'AUTH_INTERNAL_SECRET hoặc JWT_SECRET phải có ít nhất 32 byte',
      );
    }
    this.secret = secret;

    const configuredMaxAge = Number(
      configService.get<string>('AUTH_SIGNATURE_MAX_AGE_MS') ?? 300_000,
    );
    this.maxAgeMs =
      Number.isSafeInteger(configuredMaxAge) && configuredMaxAge > 0
        ? configuredMaxAge
        : 300_000;
  }

  assertTrusted(headers: SignedGatewayHeaders): void {
    const { context, payload, requestId, signature, timestamp } = headers;
    if (!requestId || !signature || !timestamp) {
      throw new UnauthorizedException('Thông tin Gateway không hợp lệ');
    }

    const timestampNumber = Number(timestamp);
    if (
      !Number.isSafeInteger(timestampNumber) ||
      Math.abs(Date.now() - timestampNumber) > this.maxAgeMs
    ) {
      throw new UnauthorizedException('Thông tin Gateway đã hết hạn');
    }

    const expected = createHmac('sha256', this.secret)
      .update(`${timestamp}.${requestId}.${payload}.${context}`)
      .digest('hex');
    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Chữ ký Gateway không hợp lệ');
    }
  }
}
