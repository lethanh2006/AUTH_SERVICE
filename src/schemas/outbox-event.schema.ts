import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema } from 'mongoose';

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;

@Schema({ timestamps: true, collection: 'auth_outbox_events' })
export class OutboxEvent {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop({ required: true })
  aggregateId!: string;

  @Prop({ required: true, type: MongoSchema.Types.Mixed })
  payload!: Record<string, unknown>;

  @Prop()
  requestId?: string;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ default: Date.now })
  nextAttemptAt!: Date;

  @Prop({ type: String, default: null })
  leaseToken!: string | null;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: String, default: null })
  lastError!: string | null;
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);
OutboxEventSchema.index({ publishedAt: 1, nextAttemptAt: 1 });
// Chỉ record đã gửi mới có publishedAt là Date và được TTL dọn sau 7 ngày.
OutboxEventSchema.index({ publishedAt: 1 }, { expireAfterSeconds: 7 * 86400 });
