import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { sha256 } from '../security';
import { uuid } from '../utils';

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly database: Pool) {}

  async record(
    request: Request | undefined,
    input: {
      action: string;
      objectType: string;
      objectId?: string | null;
      result?: string;
      reason?: string | null;
    },
  ): Promise<void> {
    const auth = request?.auth;
    await this.database.execute(
      `INSERT INTO audit_logs
       (id, actor_id, actor_role, action, object_type, object_id, result, reason, occurred_at, request_id, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?)`,
      [
        uuid(),
        auth?.userId ?? auth?.staffId ?? null,
        auth?.role ?? 'system',
        input.action,
        input.objectType,
        input.objectId ?? null,
        input.result ?? 'success',
        input.reason ?? null,
        request?.requestId ?? uuid(),
        request?.ip ? sha256(request.ip) : null,
      ],
    );
  }
}
