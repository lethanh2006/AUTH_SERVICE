import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
@Module({
    providers: [RedisService],
    exports: [RedisService], // Phải export để các module khác import và dùng được RedisService
})
export class RedisModule { }