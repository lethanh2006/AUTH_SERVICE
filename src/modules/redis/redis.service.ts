import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.client = createClient({
      url: redisUrl,
      RESP: 2,
    }) as unknown as RedisClientType;

    this.client.on('error', (err) => this.logger.error('Redis Error:', err));
    await this.client.connect();
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, { EX: ttlSeconds });
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async rotate(
    key: string,
    expectedValue: string,
    replacementValue: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.eval(
      `
                if redis.call('GET', KEYS[1]) == ARGV[1] then
                    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
                    return 1
                end
                return 0
            `,
      {
        keys: [key],
        arguments: [expectedValue, replacementValue, String(ttlSeconds)],
      },
    );
    return result === 1;
  }

  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    const result = await this.client.eval(
      `
                local value = redis.call('INCR', KEYS[1])
                if value == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return value
            `,
      {
        keys: [key],
        arguments: [String(ttlSeconds)],
      },
    );
    return Number(result);
  }

  async onModuleDestroy() {
    await this.client.disconnect();
  }
}
