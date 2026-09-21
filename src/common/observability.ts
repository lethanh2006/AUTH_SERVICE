import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  createAppLogger,
  flushLoggerAndShutdownTelemetry,
  PinoNestLogger,
} from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'auth',
});

export const nestLogger = new PinoNestLogger(appLogger, 'Auth');

export type LogDetails = Record<string, unknown>;

/** Xuất log JSON để hệ thống giám sát thu thập. */
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

@Injectable()
export class TelemetryLifecycleService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await flushLoggerAndShutdownTelemetry(appLogger, 3_000);
  }
}
