import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Credential, CredentialSchema } from '../../schemas/credential.schema';
import { RedisModule } from '../redis/redis.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { requireJwtSecret } from '../../common/config/jwt-secret';
import { GatewayIdentityGuard } from '../../common/guards/gateway-identity.guard';
import { GatewaySignatureService } from '../../common/security/gateway-signature.service';
@Module({
  imports: [
    // Đăng ký model Credential với MongooseModule để truy vấn DB
    MongooseModule.forFeature([
      { name: Credential.name, schema: CredentialSchema },
    ]),
    // Đăng ký dịch vụ tạo & xác thực JWT
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: requireJwtSecret(configService.get<string>('JWT_SECRET')),
        signOptions: { expiresIn: '7d', algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    RabbitMQModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, GatewayIdentityGuard, GatewaySignatureService],
  exports: [AuthService],
})
export class AuthModule {}
