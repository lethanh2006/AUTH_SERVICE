import { randomUUID } from 'node:crypto';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { SAFE_REQUEST_ID } from '@nrapp/observability';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection?: amqp.ChannelModel; // kết nối tới RabbitMQ server
  private channel?: amqp.ConfirmChannel; // "kênh" để gửi/nhận tin, làm việc thật sự qua đây
  private connectionPromise?: Promise<void>; // tránh việc connect nhiều lần cùng lúc
  private shuttingDown = false; // cờ đánh dấu app đang tắt
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private configService: ConfigService) {}

  onModuleInit(): void {
    void this.ensureConnection();
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
          this.configService.get<string>('RABBITMQ_USER') ||
          this.configService.get<string>('Rabbitmq_Username') ||
          'guest';
        const password =
          this.configService.get<string>('RABBITMQ_PASSWORD') ||
          this.configService.get<string>('Rabbitmq_Password') ||
          'guest';
        const port = Number(
          this.configService.get<string>('RABBITMQ_AMQP_HOST_PORT') ||
            this.configService.get<string>('Rabbitmq_Port') ||
            5672,
        );

        const connection = await amqp.connect({
          protocol: 'amqp',
          hostname: host,
          port,
          username,
          password,
        });
        if (this.shuttingDown) {
          await connection.close().catch(() => undefined);
          return;
        }
        const channel = await connection.createConfirmChannel();
        if (this.shuttingDown) {
          await channel.close().catch(() => undefined);
          await connection.close().catch(() => undefined);
          return;
        }

        this.connection = connection;
        this.channel = channel;
        attempt = 0;

        connection.on('error', (error) => {
          this.logger.error(`RabbitMQ connection error: ${error.message}`);
        });
        connection.on('close', () => this.handleDisconnect(connection));
        channel.on('close', () => {
          if (this.channel !== channel) return;
          this.handleDisconnect(connection);
          void connection.close().catch(() => undefined);
        });
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

  isReady(): boolean {
    return Boolean(this.channel) && !this.shuttingDown;
  }

  async publish(
    queueName: string,
    message: unknown,
    requestId?: string,
  ): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ Channel is not initialized');

    await channel.assertQueue(queueName, { durable: true });
    const headers =
      requestId && SAFE_REQUEST_ID.test(requestId)
        ? { 'x-request-id': requestId }
        : {};
    const messageId = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        channel.off('return', onReturn);
      };
      const onReturn = (returned: amqp.Message) => {
        if (returned.properties.messageId !== messageId) return;
        cleanup();
        reject(new Error('RabbitMQ message was not routed'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('RabbitMQ publisher confirm timed out'));
      }, 10000);
      channel.on('return', onReturn);
      try {
        channel.sendToQueue(
          queueName,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            mandatory: true,
            contentType: 'application/json',
            messageId,
            headers,
          },
          (error: unknown) => {
            cleanup();
            if (error)
              reject(
                error instanceof Error
                  ? error
                  : new Error('RabbitMQ publish failed'),
              );
            else resolve();
          },
        );
      } catch (error: unknown) {
        cleanup();
        reject(
          error instanceof Error ? error : new Error('RabbitMQ publish failed'),
        );
      }
    });
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
