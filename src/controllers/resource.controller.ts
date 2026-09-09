import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { Public } from '../auth';
import { parseJsonField } from '../utils';

@Controller('resources')
export class ResourceController {
  constructor(@Inject(DATABASE) private readonly database: Pool) {}

  @Public()
  @Get()
  async list(@Query('region') region = 'shanghai', @Query('category') category?: string) {
    const rows = await this.database
      .query(
        category
          ? 'SELECT * FROM resources WHERE region = ? AND category = ? AND status = ? ORDER BY verified_at DESC'
          : 'SELECT * FROM resources WHERE region = ? AND status = ? ORDER BY verified_at DESC',
        category ? [region, category, 'verified'] : [region, 'verified'],
      )
      .then(([rows]) => rows as any[]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        region: row.region,
        contact: parseJsonField(row.contact, {}),
        service_time: parseJsonField(row.service_time, {}),
        service_target: row.service_target,
        fee_info: row.fee_info,
        official_source: row.official_source,
        verified_at: row.verified_at,
        status: row.status,
        limitations: row.limitations,
      })),
    };
  }
}
