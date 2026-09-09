import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { Public } from '../auth';
import { config } from '../config';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: Pool) {}

  @Public()
  @Get()
  async health() {
    await this.database.query('SELECT 1');
    return {
      status: 'ok',
      service: 'tongpin-b2-backend',
      database: 'ok',
      ai: {
        enabled: config.ai.enabled,
        provider: 'deepseek',
        model: config.ai.model,
        mode: config.ai.apiKey ? 'deepseek' : config.ai.allowMock ? 'mock' : 'disabled',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
