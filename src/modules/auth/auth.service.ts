import { Injectable, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
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
import { RolePermissions } from '../../config/roles-permissions';
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
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
    // 1. Đăng ký tài khoản
    async register(registerDto: RegisterDto) {
        const { email, password, username } = registerDto;
        const existingCred = await this.credentialModel.findOne({ email });
        if (existingCred) {
            throw new BadRequestException('Email đã được đăng ký trước đó!');
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const newCred = await this.credentialModel.create({
            email,
            passwordHash,
            role: 'user',
        });
        // Đồng bộ thông tin profile sang User Service qua REST API nội bộ
        try {
            await axios.post(`${this.userServiceUrl}/api/user/internal/create-profile`, {
                userId: newCred._id,
                username,
                email,
            });
        } catch (err) {
            this.logger.error(`Đồng bộ sang User Service thất bại: ${err.message}`);
        }
        return {
            message: 'Đăng ký tài khoản thành công. Hãy đăng nhập để nhận mã OTP.',
            userId: newCred._id,
        };
    }
    // 2. Đăng nhập - Tạo OTP và đẩy vào RabbitMQ
    async login(loginDto: LoginDto) {
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
        // Tạo mã OTP ngẫu nhiên 6 số
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // Lưu OTP vào Redis tồn tại trong 5 phút
        await this.redisService.set(`login_otp:${email}`, otp, 5 * 60);
        // Lưu Rate Limit khóa gửi OTP trong 60 giây
        await this.redisService.set(rateLimitKey, '1', 60);
        // Đẩy sự kiện gửi mail sang RabbitMQ
        const mailMessage = {
            to: email,
            subject: 'Mã xác thực đăng nhập CHATAPP (OTP)',
            body: `Mã OTP xác thực đăng nhập của bạn là: ${otp}. Mã này có giá trị trong 5 phút.`,
        };
        await this.rabbitMQService.publish('send-otp', mailMessage);
        return {
            message: 'Mã OTP đã được gửi về email của bạn. Vui lòng kiểm tra và xác nhận.',
            email,
        };
    }
    // 3. Xác thực OTP & cấp JWT
    async verifyOtp(verifyOtpDto: VerifyOtpDto) {
        const { email, otp: enteredOtp } = verifyOtpDto;
        const otpKey = `login_otp:${email}`;
        const storedOtp = await this.redisService.get(otpKey);
        if (!storedOtp || storedOtp !== enteredOtp) {
            throw new BadRequestException('Mã OTP không hợp lệ hoặc đã hết hạn!');
        }
        // Xóa OTP ngay sau khi xác thực thành công
        await this.redisService.del(otpKey);
        const cred = await this.credentialModel.findOne({ email });
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }
        // Lấy thông tin username từ User Service thông qua API internal
        let username = '';
        try {
            const response = await axios.get(`${this.userServiceUrl}/api/user/internal/${cred._id}`);
            username = response.data.user?.username || '';
        } catch (err) {
            this.logger.warn(`Không lấy được thông tin username từ User Service: ${err.message}`);
        }
        const permissions = RolePermissions[cred.role] || [];
        const payload = {
            user: {
                _id: cred._id,
                email: cred.email,
                username: username,
            },
        };
        // Tạo JWT Token có thời hạn sử dụng 7 ngày
        const accessToken = this.jwtService.sign(payload);
        return {
            message: 'Xác thực thành công!',
            token: accessToken,
            user: {
                _id: cred._id,
                email: cred.email,
                username: username,
                role: cred.role,
                permissions: permissions,
            },
        };
    }
    // 4. Introspect Endpoint để Gateway kiểm tra JWT
    async validateToken(token: string) {
        try {
            const decoded = this.jwtService.verify(token);
            const userPayload = decoded.user;
            if (!userPayload || !userPayload._id) {
                return { valid: false, message: 'Token payload không hợp lệ' };
            }
            const userId = userPayload._id;
            const cacheKey = `user:roles-permissions:${userId}`;
            let role: string;
            let permissions: string[];

            const cachedDataStr = await this.redisService.get(cacheKey);
            if (cachedDataStr) {
                const cachedData = JSON.parse(cachedDataStr);
                role = cachedData.role;
                permissions = cachedData.permissions;
            } else {
                const cred = await this.credentialModel.findById(userId);
                if (!cred) {
                    return { valid: false, message: 'Tài khoản người dùng không tồn tại' };
                }
                role = cred.role || 'user';
                permissions = RolePermissions[role] || [];
                // Lưu vào Redis cache trong 1 giờ (3600 giây)
                await this.redisService.set(cacheKey, JSON.stringify({ role, permissions }), 3600);
            }

            return {
                valid: true,
                user: {
                    ...userPayload,
                    role,
                    permissions,
                },
            };
        } catch (err) {
            return {
                valid: false,
                message: err.message,
            };
        }
    }

    // 5. Cập nhật role của user & Invalidate cache permissions trên Redis
    async updateUserRole(userId: string, newRole: string) {
        if (!RolePermissions[newRole]) {
            throw new BadRequestException(`Vai trò ${newRole} không hợp lệ!`);
        }

        const cred = await this.credentialModel.findByIdAndUpdate(userId, { role: newRole }, { new: true });
        if (!cred) {
            throw new BadRequestException('Không tìm thấy tài khoản người dùng!');
        }

        // Xóa cache permissions trên Redis của user đó ngay lập tức
        const cacheKey = `user:roles-permissions:${userId}`;
        await this.redisService.del(cacheKey);

        // Gọi đồng bộ vai trò sang User Service bằng REST API nội bộ
        try {
            await axios.patch(`${this.userServiceUrl}/api/user/internal/${userId}/role`, {
                role: newRole,
            });
        } catch (err) {
            this.logger.warn(`Đồng bộ cập nhật role sang User Service thất bại: ${err.message}`);
        }

        return {
            message: 'Cập nhật vai trò người dùng thành công và xóa cache thành công!',
            userId,
            role: newRole,
        };
    }
}