import { Controller, Post, Get, Patch, Delete, Param, Body, Headers, UnauthorizedException, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('api/auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }
    @Post('register')
    async register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }
    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }
    @Post('verify')
    @HttpCode(HttpStatus.OK)
    async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
        return this.authService.verifyOtp(verifyOtpDto);
    }
    // API dành riêng cho API Gateway gọi vào để xác thực JWT token của Client
    @Post('introspect')
    @HttpCode(HttpStatus.OK)
    async introspect(@Headers('authorization') authHeader: string) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Không có Token hoặc định dạng Authorization sai');
        }
        const token = authHeader.split(' ')[1];
        const result = await this.authService.validateToken(token);

        if (!result.valid) {
            throw new UnauthorizedException(result.message || 'Token không hợp lệ hoặc đã hết hạn');
        }

        return result;
    }

    // API Cập nhật vai trò người dùng (chỉ gọi nội bộ hoặc từ trang Admin quản trị)
    @Patch('users/:id/role')
    @HttpCode(HttpStatus.OK)
    async updateUserRole(@Param('id') id: string, @Body() body: { role: string }) {
        return this.authService.updateUserRole(id, body.role);
    }

    // API Làm mới Access Token
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Body() body: { token: string }) {
        return this.authService.refreshToken(body.token);
    }

    // API Đăng nhập bằng Google
    @Post('login-google')
    @HttpCode(HttpStatus.OK)
    async loginGoogle(@Body() body: { token: string }) {
        return this.authService.loginWithGoogle(body.token);
    }

    // API Lấy thông tin credential của bản thân
    @Get('me')
    async getMyProfile(@Headers('x-user-payload') userPayload: string) {
        return this.authService.getMyProfile(userPayload);
    }

    // API Cập nhật email của bản thân
    @Patch('me/email')
    async updateMyEmail(@Headers('x-user-payload') userPayload: string, @Body() body: { email: string }) {
        return this.authService.updateMyEmail(userPayload, body.email);
    }

    // API Xóa tài khoản của bản thân
    @Delete('me')
    async deleteMyAccount(@Headers('x-user-payload') userPayload: string) {
        return this.authService.deleteMyAccount(userPayload);
    }

    // API Admin lấy credential của user bất kỳ
    @Get('users/:userId')
    async getUserProfileByAdmin(@Param('userId') userId: string) {
        return this.authService.getUserProfileByAdmin(userId);
    }

    // API Admin xóa tài khoản của user bất kỳ
    @Delete('users/:userId')
    async deleteUserByAdmin(@Param('userId') userId: string) {
        return this.authService.deleteUserByAdmin(userId);
    }
}