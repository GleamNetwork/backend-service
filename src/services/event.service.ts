import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database.module';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface PublishEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  audienceType: 'user' | 'staff' | 'district' | 'all';
  audienceId?: string | null;
  payload?: Record<string, unknown>;
  connection?: PoolConnection;
}

export interface EventRecord extends RowDataPacket {
  id: number;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  audience_type: string;
  audience_id: string | null;
  payload: unknown;
  occurred_at: Date;
  published_at: Date | null;
  delivery_status: string;
  retry_count: number;
}

@Injectable()
export class EventService {
  constructor(@Inject(DATABASE) private readonly database: Pool) {}

  async publish(input: PublishEventInput): Promise<number> {
    const sql = `
      INSERT INTO events
      (event_type, aggregate_type, aggregate_id, audience_type, audience_id, payload, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))
    `;
    const values = [
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.audienceType,
      input.audienceId ?? null,
      JSON.stringify(input.payload ?? {}),
    ];
    if (input.connection) {
      const [result] = await input.connection.query<ResultSetHeader>(sql, values);
      return result.insertId;
    }
    const [result] = await this.database.query<ResultSetHeader>(sql, values);
    return result.insertId;
  }

  async listForAudience(
    audienceType: string,
    audienceId: string,
    afterEventId = 0,
    limit = 50,
  ): Promise<EventRecord[]> {
    const [rows] = await this.database.query<EventRecord[]>(
      `SELECT * FROM events
       WHERE audience_type = ? AND audience_id = ? AND id > ?
       ORDER BY id ASC LIMIT ?`,
      [audienceType, audienceId, afterEventId, Math.min(limit, 200)],
    );
    return rows;
  }

  async listGlobal(afterEventId = 0, limit = 50): Promise<EventRecord[]> {
    const [rows] = await this.database.query<EventRecord[]>(
      `SELECT * FROM events
       WHERE (audience_type = 'all' OR audience_type = 'district')
         AND id > ?
       ORDER BY id ASC LIMIT ?`,
      [afterEventId, Math.min(limit, 200)],
    );
    return rows;
  }
}
