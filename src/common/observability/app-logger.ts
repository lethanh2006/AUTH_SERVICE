import { createAppLogger } from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'auth',
});
