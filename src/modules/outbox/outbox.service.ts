import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { injectTraceHeaders } from '@nrapp/observability';
import { randomUUID } from 'node:crypto';
import { ClientSession, Model } from 'mongoose';
import {
  OutboxEvent,
  OutboxEventDocument,
} from '../../schemas/outbox-event.schema';

@Injectable()
export class OutboxService implements OnModuleInit {
  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly model: Model<OutboxEventDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.model.init();
  }

  async enqueue(
    payload: Record<string, unknown>,
    session: ClientSession,
    requestId: string,
  ): Promise<void> {
    const eventId = randomUUID();
    await this.model.create(
      [
        {
          eventId,
          aggregateId: String(payload.userId),
          payload: { ...payload, eventId },
          requestId,
          traceHeaders: Object.fromEntries(
            Object.entries(injectTraceHeaders()).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === 'string',
            ),
          ),
        },
      ],
      { session },
    );
  }
}
