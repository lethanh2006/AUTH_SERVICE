import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import {
  OutboxEvent,
  OutboxEventDocument,
} from '../../schemas/outbox-event.schema';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private readonly intervalMs: number;

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly model: Model<OutboxEventDocument>,
    private readonly rabbit: RabbitMQService,
    config: ConfigService,
  ) {
    const interval = Number(
      config.get<string>('AUTH_OUTBOX_INTERVAL_MS') ?? 1000,
    );
    this.intervalMs =
      Number.isSafeInteger(interval) && interval >= 250 ? interval : 1000;
  }

  async onModuleInit(): Promise<void> {
    await this.model.init();
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
    void this.flush();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  async flush(): Promise<void> {
    if (this.running || this.stopping || !this.rabbit.isReady()) return;
    this.running = true;
    try {
      for (let i = 0; i < 20 && !this.stopping; i += 1) {
        const leaseToken = randomUUID();
        const event = await this.model
          .findOneAndUpdate(
            { publishedAt: null, nextAttemptAt: { $lte: new Date() } },
            {
              $set: { leaseToken, nextAttemptAt: new Date(Date.now() + 30000) },
              $inc: { attempts: 1 },
            },
            { returnDocument: 'after', sort: { createdAt: 1, _id: 1 } },
          )
          .exec();
        if (!event) break;
        const filter = {
          eventId: event.eventId,
          leaseToken,
          publishedAt: null,
        };
        try {
          await this.rabbit.publish(
            'user-profile-sync',
            event.payload,
            event.requestId,
          );
          await this.model
            .updateOne(filter, {
              $set: {
                publishedAt: new Date(),
                leaseToken: null,
                lastError: null,
              },
            })
            .exec();
        } catch (error: unknown) {
          // Retry vô hạn; lease token ngăn worker cũ ghi đè worker đã claim lại.
          await this.model
            .updateOne(filter, {
              $set: {
                leaseToken: null,
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.min(300000, 1000 * 2 ** Math.min(event.attempts, 8)),
                ),
                lastError: error instanceof Error ? error.name : 'PublishError',
              },
            })
            .exec();
          this.logger.warn(
            `Sẽ gửi lại outbox ${event.eventId}, lần thử ${event.attempts}`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `Không xử lý được outbox: ${error instanceof Error ? error.name : 'DatabaseError'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
