import { Injectable } from '@nestjs/common';
import { appLogger } from './app-logger';

export type LogDetails = Record<string, unknown>;

/**
 * Xuất log JSON ra stdout/stderr để Loki, ELK, Datadog hoặc collector đọc.
 * Telegram/Discord được cấu hình từ monitoring, không gọi tại đây.
 */
@Injectable()
export class StructuredLoggerService {
  info(event: string, details: LogDetails): void {
    appLogger.info({ ...details, 'event.name': event }, event);
  }

  warn(event: string, details: LogDetails): void {
    appLogger.warn({ ...details, 'event.name': event }, event);
  }

  error(event: string, details: LogDetails, stack?: string): void {
    appLogger.error(
      {
        ...details,
        'event.name': event,
        ...(stack ? { 'exception.stacktrace': stack } : {}),
      },
      event,
    );
  }
}
