import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OutboxEvent,
  OutboxEventSchema,
} from '../../schemas/outbox-event.schema';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { OutboxService } from './outbox.service';
import { OutboxPublisher } from './outbox.publisher';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
    RabbitMQModule,
  ],
  providers: [OutboxService, OutboxPublisher],
  exports: [OutboxService],
})
export class OutboxModule {}
