import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './errors';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          request_id: request.requestId,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json({
        error: {
          code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
          message:
            typeof body === 'string'
              ? body
              : ((body as { message?: string | string[] }).message ?? exception.message),
          request_id: request.requestId,
          details: typeof body === 'object' ? body : undefined,
        },
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : '服务器内部错误';
    console.error('[unhandled]', exception);
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message,
        request_id: request.requestId,
      },
    });
  }
}
