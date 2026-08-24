import { Injectable, BadRequestException, HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Credential, CredentialDocument } from '../../schemas/credential.schema';
import { RedisService } from '../redis/redis.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import axios from 'axios';
import { APP_ROLES, AppRole } from '../../common/enums/app-role.enum';
import { randomInt, randomUUID } from 'node:crypto';
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly refreshTokenTtlSeconds = 30 * 24 * 60 * 60;
    constructor(
        @InjectModel(Credential.name) private credentialModel: Model<CredentialDocument>,
        private jwtService: JwtService,
        private redisService: RedisService,
        private rabbitMQService: RabbitMQService,
        private configService: ConfigService,
    ) { }

    private get userServiceUrl(): string {
        return this.configService.get<string>('USER_SERVICE') || 'http://localhost:5000';
    }
    async register(registerDto: RegisterDto, requestId: string) {
        const { email, password, username } = registerDto;
        const existingCred = await this.credentialModel.findOne({ email });
        if (existingCred) {
            throw new BadRequestException('Email đã được đăng ký trước đó!');
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const newCred = await this.credentialModel.create({
            email,
            passwordHash,
            role: AppRole.USER,
        });
        try {
            await this.rabbitMQService.publish('user-profile-sync', {
                action: 'CREATE',
                userId: newCred._id,
                username,
                email,
                role: newCred.role,
            }, requestId);
        } catch (err: any) {
            this.logger.error(`Đồng bộ sang User Service qua RabbitMQ thất bại: ${err.message}`);
        }
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
            message: 'Mã OTP đã được gửi về email của bạn. Vui lòng kiểm tra và xác nhận.',
            email,
        };
    }
    // 3. Xác thực OTP & cấp JWT
    async verifyOtp(verifyOtpDto: VerifyOtpDto, requestId: string) {
        const { email, otp: enteredOtp } = verifyOtpDto;
        const otpKey = `login_otp:${email}`;
        const attemptKey = `otp_attempts:${email}`;
        const currentAttempts = Number((await this.redisService.get(attemptKey)) ?? 0);
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
            const response = await axios.get(`${this.userServiceUrl}/api/user/internal/${cred._id}`, {
                headers: { 'x-request-id': requestId },
            });
            username = response.data.user?.username || '';
        } catch (err: any) {
            this.logger.warn(`Không lấy được thông tin username từ User Service: ${err.message}`);
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
            const decoded = this.jwtService.verify(token);
            if (decoded.tokenType === 'refresh') {
                return { valid: false, message: 'Refresh token không thể dùng để truy cập API' };
            }
            const userPayload = decoded.user;
            if (!userPayload || !userPayload._id) {
                return { valid: false, message: 'Token payload không hợp lệ' };
            }

            const credential = await this.credentialModel.findById(userPayload._id).lean();
            if (!credential) {
                return { valid: false, message: 'Tài khoản không còn tồn tại' };
            }

            return {
                valid: true,
                user: {
                    _id: String(credential._id),
                    email: credential.email,
                    username: userPayload.username || '',
                    role: credential.role,
                },
            };
        } catch (err: any) {
            return {
                valid: false,
                message: err?.message || String(err),
            };
        }
    }

    // 5. Cập nhật role của user
    async updateUserRole(userId: string, newRole: string, requestId: string) {
        const normalizedRole = newRole.trim().toLowerCase() as AppRole;
        if (!APP_ROLES.includes(normalizedRole)) {
            throw new BadRequestException(`Vai trò ${newRole} không hợp lệ!`);
        }

        const cred = await this.credentialModel.findByIdAndUpdate(userId, { role: normalizedRole }, { new: true });
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }

        try {
            await this.rabbitMQService.publish('user-profile-sync', {
                action: 'UPDATE_ROLE',
                userId,
                role: normalizedRole,
            }, requestId);
        } catch (err: any) {
            this.logger.warn(`Đồng bộ cập nhật role sang User Service qua RabbitMQ thất bại: ${err.message}`);
        }

        return {
            message: 'Cập nhật vai trò người dùng thành công!',
            userId,
            role: normalizedRole,
        };
    }

    // 6. Làm mới Access Token
    async refreshToken(refreshToken: string, requestId: string) {
        try {
            const decoded = this.jwtService.verify(refreshToken);
            if (
                decoded.tokenType !== 'refresh' ||
                typeof decoded.sub !== 'string' ||
                typeof decoded.jti !== 'string'
            ) {
                throw new UnauthorizedException('Refresh token không hợp lệ');
            }

            const cred = await this.credentialModel.findById(decoded.sub);
            if (!cred) {
                await this.redisService.del(this.refreshTokenKey(decoded.sub));
                throw new UnauthorizedException('Tài khoản không còn tồn tại');
            }

            let username = '';
            try {
                const response = await axios.get(`${this.userServiceUrl}/api/user/internal/${cred._id}`, {
                    headers: { 'x-request-id': requestId },
                });
                username = response.data.user?.username || '';
            } catch (err) {
                // fallback
            }

            const session = await this.issueSessionTokens(
                cred,
                username,
                decoded.jti,
            );
            return {
                message: 'Làm mới token thành công!',
                ...session,
            };
        } catch (err: any) {
            if (err instanceof UnauthorizedException) throw err;
            throw new UnauthorizedException(
                'Refresh token không hợp lệ hoặc đã hết hạn',
            );
        }
    }

    // 7. Đăng nhập bằng Google
    async loginWithGoogle(token: string, requestId: string) {
        try {
            let email: string = '';
            let name: string = '';
            try {
                const res = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
                email = res.data.email;
                name = res.data.name || res.data.given_name || email.split('@')[0];
            } catch (err) {
                const res = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                email = res.data.email;
                name = res.data.name || res.data.given_name || email.split('@')[0];
            }

            if (!email) {
                throw new BadRequestException('Không thể lấy thông tin email từ Google Token');
            }

            let cred = await this.credentialModel.findOne({ email });
            let isNew = false;
            if (!cred) {
                const passwordHash = await bcrypt.hash(Math.random().toString(36), 10);
                cred = await this.credentialModel.create({
                    email,
                    passwordHash,
                    role: AppRole.USER,
                });
                isNew = true;
            }

            if (isNew) {
                try {
                    await this.rabbitMQService.publish('user-profile-sync', {
                        action: 'CREATE',
                        userId: cred._id,
                        username: name,
                        email,
                        role: cred.role,
                    }, requestId);
                } catch (err: any) {
                    this.logger.error(`Đăng ký sự kiện tạo profile Google thất bại: ${err.message}`);
                }
            }

            let username = name;
            try {
                const response = await axios.get(`${this.userServiceUrl}/api/user/internal/${cred._id}`, {
                    headers: { 'x-request-id': requestId },
                });
                username = response.data.user?.username || name;
            } catch (err) {
                // fallback
            }

            const session = await this.issueSessionTokens(cred, username);
            return {
                message: 'Đăng nhập bằng Google thành công!',
                ...session,
            };
        } catch (error: any) {
            throw new BadRequestException('Đăng nhập Google thất bại: ' + (error.response?.data?.error_description || error.message));
        }
    }

    // 8. Lấy thông tin credential của bản thân
    async getMyProfile(userPayloadBase64: string) {
        if (!userPayloadBase64) {
            throw new UnauthorizedException('Thiếu payload thông tin người dùng');
        }
        const userStr = Buffer.from(userPayloadBase64, 'base64').toString('utf8');
        const user = JSON.parse(userStr);

        const cred = await this.credentialModel.findById(user._id);
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }
        return {
            _id: cred._id,
            email: cred.email,
            role: cred.role,
        };
    }

    // 9. Cập nhật email của bản thân
    async updateMyEmail(userPayloadBase64: string, email: string, requestId: string) {
        if (!userPayloadBase64) {
            throw new UnauthorizedException('Thiếu payload thông tin người dùng');
        }
        const userStr = Buffer.from(userPayloadBase64, 'base64').toString('utf8');
        const user = JSON.parse(userStr);

        const existing = await this.credentialModel.findOne({ email, _id: { $ne: user._id } });
        if (existing) {
            throw new BadRequestException('Email này đã được đăng ký bởi người dùng khác!');
        }

        const cred = await this.credentialModel.findByIdAndUpdate(user._id, { email }, { new: true });
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }

        try {
            await this.rabbitMQService.publish('user-profile-sync', {
                action: 'UPDATE_EMAIL',
                userId: cred._id,
                email: cred.email,
            }, requestId);
        } catch (err: any) {
            this.logger.error(`Đăng ký sự kiện cập nhật email thất bại: ${err.message}`);
        }

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
        const userStr = Buffer.from(userPayloadBase64, 'base64').toString('utf8');
        const user = JSON.parse(userStr);

        const cred = await this.credentialModel.findByIdAndDelete(user._id);
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }
        await this.redisService.del(this.refreshTokenKey(String(user._id)));

        try {
            await this.rabbitMQService.publish('user-profile-sync', {
                action: 'DELETE',
                userId: user._id,
            }, requestId);
        } catch (err: any) {
            this.logger.error(`Đăng ký sự kiện xóa tài khoản thất bại: ${err.message}`);
        }

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
            role: cred.role,
        };
    }

    // 12. Admin xóa tài khoản của user bất kỳ
    async deleteUserByAdmin(userId: string, requestId: string) {
        const cred = await this.credentialModel.findByIdAndDelete(userId);
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }
        await this.redisService.del(this.refreshTokenKey(userId));

        try {
            await this.rabbitMQService.publish('user-profile-sync', {
                action: 'DELETE',
                userId,
            }, requestId);
        } catch (err: any) {
            this.logger.error(`Đăng ký sự kiện admin xóa tài khoản thất bại: ${err.message}`);
        }

        return {
            message: 'Admin xóa tài khoản người dùng thành công!',
        };
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
            role: cred.role,
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
}
