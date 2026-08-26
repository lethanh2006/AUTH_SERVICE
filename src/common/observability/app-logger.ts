import { createAppLogger, PinoNestLogger } from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'auth',
});

export const nestLogger = new PinoNestLogger(appLogger, 'Auth');
