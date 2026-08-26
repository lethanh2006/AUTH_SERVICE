import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { injectTraceHeaders, withMessageSpan } from '@nrapp/observability';
import * as amqp from 'amqplib';
import { SAFE_REQUEST_ID } from '../../common/middleware/request-id.middleware';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection?: amqp.ChannelModel; // kết nối tới RabbitMQ server
  private channel?: amqp.Channel; // "kênh" để gửi/nhận tin, làm việc thật sự qua đây
  private connectionPromise?: Promise<void>; // tránh việc connect nhiều lần cùng lúc
  private shuttingDown = false; // cờ đánh dấu app đang tắt
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.ensureConnection();
  }

  private ensureConnection(): Promise<void> {
    if (this.channel) return Promise.resolve();
    if (!this.connectionPromise) {
      this.connectionPromise = this.connectWithRetry().finally(() => {
        this.connectionPromise = undefined;
      });
    }
    return this.connectionPromise;
  }

  private async connectWithRetry(): Promise<void> {
    let attempt = 0;
    while (!this.shuttingDown && !this.channel) {
      try {
        const host =
          this.configService.get<string>('Rabbitmq_Host') || 'localhost';
        const username =
          this.configService.get<string>('Rabbitmq_Username') || 'guest';
        const password =
          this.configService.get<string>('Rabbitmq_Password') || 'guest';

        const connection = await amqp.connect({
          protocol: 'amqp',
          hostname: host,
          port: 5672,
          username,
          password,
        });
        const channel = await connection.createChannel();

        this.connection = connection;
        this.channel = channel;
        attempt = 0;

        connection.on('error', (error) => {
          this.logger.error(`RabbitMQ connection error: ${error.message}`);
        });
        connection.on('close', () => this.handleDisconnect(connection));
        channel.on('error', (error) => {
          this.logger.error(`RabbitMQ channel error: ${error.message}`);
        });

        this.logger.log('Connected to RabbitMQ successfully');
        return;
      } catch (error) {
        attempt += 1;
        const retryDelay = Math.min(
          1000 * 2 ** Math.min(attempt - 1, 4),
          15000,
        );
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `RabbitMQ is unavailable (${message}). Retrying in ${retryDelay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  private handleDisconnect(connection: amqp.ChannelModel) {
    if (this.connection !== connection) return;
    this.connection = undefined;
    this.channel = undefined;
    if (this.shuttingDown) return;
    this.logger.warn('RabbitMQ connection closed. Reconnecting...');
    void this.ensureConnection();
  }

  async publish(
    queueName: string,
    message: unknown,
    requestId?: string,
  ): Promise<void> {
    await this.ensureConnection();
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ Channel is not initialized');

    await withMessageSpan(
      `${queueName} publish`,
      {},
      async () => {
        await channel.assertQueue(queueName, { durable: true });
        const headers = injectTraceHeaders(
          requestId && SAFE_REQUEST_ID.test(requestId)
            ? { 'x-request-id': requestId }
            : {},
        );
        channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
          persistent: true,
          headers,
        });
      },
      {
        kind: 3,
        attributes: {
          'messaging.system': 'rabbitmq',
          'messaging.destination.name': queueName,
          'messaging.operation.type': 'publish',
        },
      },
    );
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }
}
