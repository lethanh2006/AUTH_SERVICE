import { Injectable } from '@nestjs/common';

export interface AuthHealth {
  status: 'ok';
  service: 'auth';
}

@Injectable()
export class HealthService {
  getLiveness(): AuthHealth {
    return { status: 'ok', service: 'auth' };
  }
}
