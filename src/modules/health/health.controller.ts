import { Controller, Get } from '@nestjs/common';
import { HealthService, type AuthHealth } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get(['', 'live'])
  getLiveness(): AuthHealth {
    return this.healthService.getLiveness();
  }
}
