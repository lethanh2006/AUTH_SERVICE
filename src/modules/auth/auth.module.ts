import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Credential, CredentialSchema } from '../../schemas/credential.schema';
import { RedisModule } from '../redis/redis.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
@Module({
    imports: [
        // Đăng ký model Credential với MongooseModule để truy vấn DB
        MongooseModule.forFeature([{ name: Credential.name, schema: CredentialSchema }]),
        // Đăng ký dịch vụ tạo & xác thực JWT
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET') || 'your-super-secret-key-chatapp',
                signOptions: { expiresIn: '7d' },
            }),
            inject: [ConfigService],
        }),
        RedisModule,
        RabbitMQModule,
    ],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService],
})
export class AuthModule { }