import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OutboxService } from '../outbox/outbox.service';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import {
  Credential,
  CredentialDocument,
} from '../../schemas/credential.schema';
import { RedisService } from '../redis/redis.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import axios from 'axios';
import { APP_ROLES, AppRole } from '../../common/enums/app-role.enum';
import { randomInt, randomUUID } from 'node:crypto';
import { toError } from '../../common/utils/error.util';
import { InFlightReads } from '../../common/utils/in-flight-reads';
import type { GatewayIdentity } from '../../common/interfaces/gateway-identity.interface';
import { parseGatewayIdentity } from '../../common/utils/gateway-identity.util';

interface UserServiceResponse {
  user?: {
    username?: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();
  private readonly refreshTokenTtlSeconds = 30 * 24 * 60 * 60;
  private readonly credentialIdentityReads: InFlightReads<Pick<
    CredentialDocument,
    '_id' | 'email' | 'role'
  > | null>;
  constructor(
    @InjectModel(Credential.name)
    private credentialModel: Model<CredentialDocument>,
    private jwtService: JwtService,
    private redisService: RedisService,
    private rabbitMQService: RabbitMQService,
    private configService: ConfigService,
    private readonly outboxService: OutboxService,
  ) {
    const ttlMs = Number(
      this.configService.get<string>('AUTH_IDENTITY_CACHE_TTL_MS') ?? 0,
    );
    if (!Number.isInteger(ttlMs) || ttlMs < 0 || ttlMs > 5000) {
      throw new Error(
        'AUTH_IDENTITY_CACHE_TTL_MS must be 0..5000; enable only for a single Auth instance',
      );
    }
    this.credentialIdentityReads = new InFlightReads(ttlMs);
  }

  private get userServiceUrl(): string {
    return (
      this.configService.get<string>('USER_SERVICE') || 'http://localhost:5000'
    );
  }
  async register(registerDto: RegisterDto, requestId: string) {
    const { email, password, username } = registerDto;
    const existingCred = await this.credentialModel.findOne({ email });
    if (existingCred) {
      throw new BadRequestException('Email đã được đăng ký trước đó!');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const newCred = await this.createCredential(
      email,
      passwordHash,
      username,
      requestId,
    );
    return {
      message: 'Đăng ký tài khoản thành công. Hãy đăng nhập để nhận mã OTP.',
      userId: newCred._id,
    };
  }
  // 2. Đăng nhập - Tạo OTP và đẩy vào RabbitMQ
  async login(loginDto: LoginDto, requestId: string) {
    const { email, password } = loginDto;
    const cred = await this.credentialModel.findOne({ email });
    if (!cred) {
      throw new BadRequestException('Email hoặc mật khẩu không hợp lệ!');
    }
    const isMatch = await bcrypt.compare(password, cred.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Email hoặc mật khẩu không hợp lệ!');
    }
    // Kiểm tra Rate Limit gửi OTP (1 phút tối đa 1 lần)
    const rateLimitKey = `otp:ratelimit:${email}`;
    const isRateLimited = await this.redisService.get(rateLimitKey);
    if (isRateLimited) {
      throw new HttpException(
        'Vui lòng đợi 1 phút trước khi yêu cầu mã OTP mới.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Sinh OTP bằng bộ tạo số ngẫu nhiên mật mã.
    const otp = randomInt(100000, 1000000).toString();
    // Lưu OTP vào Redis tồn tại trong 5 phút
    await this.redisService.set(`login_otp:${email}`, otp, 5 * 60);
    await this.redisService.del(`otp_attempts:${email}`);
    // Lưu Rate Limit khóa gửi OTP trong 60 giây
    await this.redisService.set(rateLimitKey, '1', 60);
    // Đẩy sự kiện gửi mail sang RabbitMQ
    const mailMessage = {
      to: email,
      subject: 'Mã xác thực đăng nhập CHATAPP (OTP)',
      body: `Mã OTP xác thực đăng nhập của bạn là: ${otp}. Mã này có giá trị trong 5 phút.`,
    };
    await this.rabbitMQService.publish('send-otp', mailMessage, requestId);
    return {
      message:
        'Mã OTP đã được gửi về email của bạn. Vui lòng kiểm tra và xác nhận.',
      email,
    };
  }
  // 3. Xác thực OTP & cấp JWT
  async verifyOtp(verifyOtpDto: VerifyOtpDto, requestId: string) {
    const { email, otp: enteredOtp } = verifyOtpDto;
    const otpKey = `login_otp:${email}`;
    const attemptKey = `otp_attempts:${email}`;
    const currentAttempts = Number(
      (await this.redisService.get(attemptKey)) ?? 0,
    );
    if (currentAttempts >= 5) {
      throw new HttpException(
        'Bạn đã nhập sai OTP quá nhiều lần. Vui lòng yêu cầu mã mới.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const storedOtp = await this.redisService.get(otpKey);
    if (!storedOtp || storedOtp !== enteredOtp) {
      const attempts = await this.redisService.incrementWithExpiry(
        attemptKey,
        5 * 60,
      );
      if (attempts >= 5) {
        await this.redisService.del(otpKey);
        throw new HttpException(
          'Bạn đã nhập sai OTP quá nhiều lần. Vui lòng yêu cầu mã mới.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new BadRequestException('Mã OTP không hợp lệ hoặc đã hết hạn!');
    }
    // Xóa OTP ngay sau khi xác thực thành công
    await this.redisService.del(otpKey);
    await this.redisService.del(attemptKey);
    const cred = await this.credentialModel.findOne({ email });
    if (!cred) {
      throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
    }
    // Lấy thông tin username từ User Service thông qua API internal
    let username = '';
    try {
      const response = await axios.get<UserServiceResponse>(
        `${this.userServiceUrl}/api/user/internal/${String(cred._id)}`,
        {
          headers: { 'x-request-id': requestId },
        },
      );
      username = response.data.user?.username || '';
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.warn(
        `Không lấy được thông tin username từ User Service: ${error.message}`,
      );
    }
    const session = await this.issueSessionTokens(cred, username);
    return {
      message: 'Xác thực thành công!',
      ...session,
    };
  }

  // 4. Introspect Endpoint để Gateway kiểm tra JWT
  async validateToken(token: string) {
    try {
      const decoded = this.jwtService.verify<Record<string, unknown>>(token);
      if (decoded.tokenType === 'refresh') {
        return {
          valid: false,
          message: 'Refresh token không thể dùng để truy cập API',
        };
      }
      const userPayload = parseGatewayIdentity(decoded.user);
      if (!userPayload) {
        return { valid: false, message: 'Token payload không hợp lệ' };
      }

      const credential = await this.credentialIdentityReads.run(
        userPayload._id,
        async () =>
          this.credentialModel
            .findById(userPayload._id)
            .select({ _id: 1, email: 1, role: 1 })
            .lean<Pick<CredentialDocument, '_id' | 'email' | 'role'> | null>(),
      );
      if (!credential) {
        return { valid: false, message: 'Tài khoản không còn tồn tại' };
      }

      return {
        valid: true,
        user: {
          _id: String(credential._id),
          email: credential.email,
          username: userPayload.username || '',
          role: normalizeAppRole(credential.role),
        },
      };
    } catch (err: unknown) {
      return {
        valid: false,
        message: toError(err).message,
      };
    }
  }

  // 5. Cập nhật role của user
  async updateUserRole(userId: string, newRole: string, requestId: string) {
    const normalizedRole = newRole.trim().toLowerCase() as AppRole;
    if (!APP_ROLES.includes(normalizedRole)) {
      throw new BadRequestException(`Vai trò ${newRole} không hợp lệ!`);
    }

    await this.changeCredential(
      userId,
      'UPDATE_ROLE',
      { role: normalizedRole },
      requestId,
    );

    return {
      message: 'Cập nhật vai trò người dùng thành công!',
      userId,
      role: normalizedRole,
    };
  }

  // 6. Làm mới Access Token
  async refreshToken(refreshToken: string, requestId: string) {
    try {
      const decoded =
        this.jwtService.verify<Record<string, unknown>>(refreshToken);
      const { tokenType, sub, jti } = decoded;
      if (
        tokenType !== 'refresh' ||
        typeof sub !== 'string' ||
        typeof jti !== 'string'
      ) {
        throw new UnauthorizedException('Refresh token không hợp lệ');
      }

      const cred = await this.credentialModel.findById(sub);
      if (!cred) {
        await this.redisService.del(this.refreshTokenKey(sub));
        throw new UnauthorizedException('Tài khoản không còn tồn tại');
      }

      let username = '';
      try {
        const response = await axios.get<UserServiceResponse>(
          `${this.userServiceUrl}/api/user/internal/${String(cred._id)}`,
          {
            headers: { 'x-request-id': requestId },
          },
        );
        username = response.data.user?.username || '';
      } catch {
        // fallback
      }

      const session = await this.issueSessionTokens(cred, username, jti);
      return {
        message: 'Làm mới token thành công!',
        ...session,
      };
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }
  }

  // 7. Đăng nhập bằng Google
  async loginWithGoogle(token: string, requestId: string) {
    try {
      const clientId = this.configService
        .get<string>('GOOGLE_WEB_CLIENT_ID')
        ?.trim();
      if (!clientId) {
        throw new Error('Thiếu GOOGLE_WEB_CLIENT_ID trong cấu hình Auth');
      }

      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      const email = payload?.email?.trim().toLowerCase();
      const name =
        payload?.name?.trim() ||
        payload?.given_name?.trim() ||
        email?.split('@')[0] ||
        '';

      if (!email || payload?.email_verified !== true) {
        throw new BadRequestException(
          'Google Token không có email đã được xác minh',
        );
      }

      let cred: CredentialDocument | null = await this.credentialModel.findOne({
        email,
      });
      if (!cred) {
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        cred = await this.createCredential(
          email,
          passwordHash,
          name,
          requestId,
        );
      }

      let username = name;
      try {
        const response = await axios.get<UserServiceResponse>(
          `${this.userServiceUrl}/api/user/internal/${String(cred._id)}`,
          {
            headers: { 'x-request-id': requestId },
          },
        );
        username = response.data.user?.username || name;
      } catch {
        // fallback
      }

      const session = await this.issueSessionTokens(cred, username);
      return {
        message: 'Đăng nhập bằng Google thành công!',
        ...session,
      };
    } catch (error: unknown) {
      const errorMessage = toError(error).message;
      throw new BadRequestException(
        `Đăng nhập Google thất bại: ${errorMessage}`,
      );
    }
  }

  // 8. Lấy thông tin credential của bản thân
  async getMyProfile(userPayloadBase64: string) {
    if (!userPayloadBase64) {
      throw new UnauthorizedException('Thiếu payload thông tin người dùng');
    }
    const user = this.parseUserPayload(userPayloadBase64);

    const cred = await this.credentialModel.findById(user._id);
    if (!cred) {
      throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
    }
    return {
      _id: cred._id,
      email: cred.email,
      role: normalizeAppRole(cred.role),
    };
  }

  // 9. Cập nhật email của bản thân
  async updateMyEmail(
    userPayloadBase64: string,
    email: string,
    requestId: string,
  ) {
    if (!userPayloadBase64) {
      throw new UnauthorizedException('Thiếu payload thông tin người dùng');
    }
    const user = this.parseUserPayload(userPayloadBase64);

    const existing = await this.credentialModel.findOne({
      email,
      _id: { $ne: user._id },
    });
    if (existing) {
      throw new BadRequestException(
        'Email này đã được đăng ký bởi người dùng khác!',
      );
    }

    const cred = await this.changeCredential(
      user._id,
      'UPDATE_EMAIL',
      { email },
      requestId,
    );

    return {
      message: 'Cập nhật email thành công!',
      email: cred.email,
    };
  }

  // 10. Xóa tài khoản của bản thân
  async deleteMyAccount(userPayloadBase64: string, requestId: string) {
    if (!userPayloadBase64) {
      throw new UnauthorizedException('Thiếu payload thông tin người dùng');
    }
    const user = this.parseUserPayload(userPayloadBase64);

    await this.changeCredential(user._id, 'DELETE', {}, requestId);
    await this.redisService.del(this.refreshTokenKey(String(user._id)));

    return {
      message: 'Xóa tài khoản thành công!',
    };
  }

  // 11. Admin lấy credential của user bất kỳ
  async getUserProfileByAdmin(userId: string) {
    const cred = await this.credentialModel.findById(userId);
    if (!cred) {
      throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
    }
    return {
      _id: cred._id,
      email: cred.email,
      role: normalizeAppRole(cred.role),
    };
  }

  // 12. Admin xóa tài khoản của user bất kỳ
  async deleteUserByAdmin(userId: string, requestId: string) {
    await this.changeCredential(userId, 'DELETE', {}, requestId);
    await this.redisService.del(this.refreshTokenKey(String(userId)));

    return {
      message: 'Admin xóa tài khoản người dùng thành công!',
    };
  }

  private async createCredential(
    email: string,
    passwordHash: string,
    username: string,
    requestId: string,
  ): Promise<CredentialDocument> {
    return this.credentialModel.db.transaction(
      async (session) => {
        const [cred] = await this.credentialModel.create(
          [
            {
              email,
              passwordHash,
              role: AppRole.USER,
              syncVersion: 1,
              syncUsername: username,
            },
          ],
          { session },
        );
        await this.enqueueProfile(cred, 'CREATE', 1, session, requestId);
        return cred;
      },
      { writeConcern: { w: 'majority' } },
    );
  }

  private async changeCredential(
    userId: string,
    action: 'UPDATE_EMAIL' | 'UPDATE_ROLE' | 'DELETE',
    changes: { email?: string; role?: string },
    requestId: string,
  ): Promise<CredentialDocument> {
    this.credentialIdentityReads.invalidate(userId);
    try {
      return await this.credentialModel.db.transaction(
        async (session) => {
          const cred =
            action === 'DELETE'
              ? await this.credentialModel.findByIdAndDelete(userId, {
                  session,
                })
              : await this.credentialModel.findByIdAndUpdate(
                  userId,
                  { $set: changes, $inc: { syncVersion: 1 } },
                  { returnDocument: 'after', session, runValidators: true },
                );
          if (!cred)
            throw new BadRequestException(
              'Không tìm thấy tài khoản người dùng!',
            );
          const version =
            action === 'DELETE'
              ? (cred.syncVersion ?? 0) + 1
              : cred.syncVersion;
          await this.enqueueProfile(cred, action, version, session, requestId);
          return cred;
        },
        { writeConcern: { w: 'majority' } },
      );
    } finally {
      // Fence any old read/cache fill racing the transaction, including errors.
      this.credentialIdentityReads.invalidate(userId);
    }
  }

  private async enqueueProfile(
    cred: CredentialDocument,
    action: string,
    version: number,
    session: import('mongoose').ClientSession,
    requestId: string,
  ): Promise<void> {
    await this.outboxService.enqueue(
      {
        action,
        userId: String(cred._id),
        version,
        ...(action === 'DELETE'
          ? {}
          : {
              email: cred.email,
              role: normalizeAppRole(cred.role),
              username: cred.syncUsername || cred.email.split('@')[0],
            }),
      },
      session,
      requestId,
    );
  }

  private async issueSessionTokens(
    cred: CredentialDocument,
    username: string,
    currentRefreshTokenId?: string,
  ) {
    const user = {
      _id: cred._id,
      email: cred.email,
      username,
      role: normalizeAppRole(cred.role),
    };
    const token = this.jwtService.sign({ user, tokenType: 'access' });
    const refreshTokenId = randomUUID();
    const refreshToken = this.jwtService.sign(
      {
        sub: String(cred._id),
        jti: refreshTokenId,
        tokenType: 'refresh',
      },
      { expiresIn: this.refreshTokenTtlSeconds },
    );
    const refreshKey = this.refreshTokenKey(String(cred._id));
    if (currentRefreshTokenId) {
      const rotated = await this.redisService.rotate(
        refreshKey,
        currentRefreshTokenId,
        refreshTokenId,
        this.refreshTokenTtlSeconds,
      );
      if (!rotated) {
        throw new UnauthorizedException(
          'Refresh token đã bị thu hồi hoặc thay thế',
        );
      }
    } else {
      await this.redisService.set(
        refreshKey,
        refreshTokenId,
        this.refreshTokenTtlSeconds,
      );
    }

    return { token, refreshToken, user };
  }

  private refreshTokenKey(userId: string): string {
    return `refresh_token:${userId}`;
  }

  private parseUserPayload(userPayloadBase64: string): GatewayIdentity {
    const userJson = Buffer.from(userPayloadBase64, 'base64').toString('utf8');
    const user = parseGatewayIdentity(JSON.parse(userJson) as unknown);
    if (!user) {
      throw new UnauthorizedException(
        'Payload thông tin người dùng không hợp lệ',
      );
    }

    return user;
  }
}

/** Role cũ không còn trong hợp đồng mới được hạ về user khi đọc dữ liệu. */
function normalizeAppRole(role: unknown): AppRole {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return normalized === 'admin' ? AppRole.ADMIN : AppRole.USER;
}
