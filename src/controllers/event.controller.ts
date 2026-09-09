import { Controller, Get, Inject, Query, Req, Res, Sse } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EventService } from '../services/event.service';
import { config } from '../config';
import type { Observable } from 'rxjs';
import { interval, map, switchMap, takeWhile } from 'rxjs';

@Controller('events')
export class EventController {
  constructor(@Inject(EventService) private readonly events: EventService) {}

  @Get()
  async stream(@Req() request: Request, @Res() response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    let lastEventId = Number(request.headers['last-event-id'] ?? 0);
    if (!Number.isFinite(lastEventId) || lastEventId < 0) lastEventId = 0;

    const timer = setInterval(async () => {
      try {
        const rows = await this.listForAuth(request, lastEventId, 50);
        for (const row of rows) {
          lastEventId = Number(row.id);
          response.write(`id: ${row.id}\n`);
          response.write(`event: ${row.event_type}\n`);
          response.write(`data: ${JSON.stringify({
            id: row.id,
            event: row.event_type,
            aggregate_type: row.aggregate_type,
            aggregate_id: row.aggregate_id,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            occurred_at: row.occurred_at,
          })}\n\n`);
        }
      } catch {
        // Polling errors should not close the stream; frontend has /events/poll fallback.
      }
    }, config.eventPollIntervalMs);

    request.on('close', () => {
      clearInterval(timer);
      response.end();
    });
  }

  @Get('poll')
  async poll(@Req() request: Request, @Query('after_event_id') afterEventId = '0') {
    const rows = await this.listForAuth(request, Number(afterEventId) || 0, 50);
    return {
      events: rows.map((row) => ({
        id: row.id,
        event: row.event_type,
        aggregate_type: row.aggregate_type,
        aggregate_id: row.aggregate_id,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        occurred_at: row.occurred_at,
      })),
      next_after_event_id: rows.length ? Number(rows[rows.length - 1].id) : Number(afterEventId) || 0,
      has_more: rows.length === 50,
    };
  }

  private async listForAuth(request: Request, afterEventId: number, limit: number) {
    const auth = request.auth;
    if (!auth) return [];
    if (auth.role === 'user' && auth.userId) {
      return this.events.listForAudience('user', auth.userId, afterEventId, limit);
    }
    if (auth.staffId) {
      const rows = await this.events.listForAudience('staff', auth.staffId, afterEventId, limit);
      const districtRows = (auth.districtIds ?? []).length
        ? await Promise.all(
            auth.districtIds!.map((districtId) =>
              this.events.listForAudience('district', districtId, afterEventId, limit),
            ),
          )
        : [];
      return [...rows, ...districtRows.flat()].sort((a, b) => Number(a.id) - Number(b.id));
    }
    return this.events.listGlobal(afterEventId, limit);
  }
}
