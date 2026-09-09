import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Pool } from 'mysql2/promise';
import { hashRequest } from './utils';
import { AuditService } from './services/audit.service';
import { DATABASE } from './database.module';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    request.requestId = request.headers['x-request-id']?.toString() ?? randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    return next.handle();
  }
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DATABASE) private readonly database: Pool) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return next.handle();

    const key = request.headers['idempotency-key'];
    if (!key || Array.isArray(key)) return next.handle();

    return new Observable((subscriber) => {
      void (async () => {
        const requestHash = hashRequest({ body: request.body, query: request.query });
        const [existing] = await this.database
          .query(
            `SELECT response_status, response_body FROM idempotency_keys
             WHERE idempotency_key = ? LIMIT 1`,
            [key],
          )
          .then(([rows]) => rows as any[]);

        if (existing) {
          if (existing.response_body?.request_hash !== requestHash) {
            subscriber.error(Object.assign(new Error('同一幂等键的请求内容不一致'), { status: 400 }));
            return;
          }
          response.status(existing.response_status);
          subscriber.next(existing.response_body?.body);
          subscriber.complete();
          return;
        }

        next.handle().subscribe({
          next: (value) => {
            void this.database
              .query(
                `INSERT INTO idempotency_keys
                 (id, idempotency_key, actor_id, endpoint, request_hash, response_status, response_body, created_at, expires_at)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
                [
                  key,
                  request.auth?.userId ?? request.auth?.staffId ?? null,
                  request.originalUrl,
                  requestHash,
                  response.statusCode,
                  JSON.stringify({ request_hash: requestHash, body: value ?? null }),
                ],
              )
              .catch((error) => console.error('[idempotency:save]', error));
            subscriber.next(value);
          },
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      })();
    });
  }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit
            .record(request, {
              action: `${request.method.toLowerCase()}_request`,
              objectType: 'http_endpoint',
              objectId: null,
              result: 'success',
              reason: request.originalUrl,
            })
            .catch((error) => console.error('[audit:save]', error));
        },
        error: (error) => {
          void this.audit
            .record(request, {
              action: `${request.method.toLowerCase()}_request`,
              objectType: 'http_endpoint',
              objectId: null,
              result: 'failed',
              reason: error instanceof Error ? error.message : 'unknown',
            })
            .catch((auditError) => console.error('[audit:save:failed]', auditError));
        },
      }),
    );
  }
}
