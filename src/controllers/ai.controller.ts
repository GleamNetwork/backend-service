import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { AIService } from '../services/ai.service';
import { errors } from '../errors';
import { parseJsonField } from '../utils';

@Controller('ai')
export class AIController {
  constructor(
    @Inject(DATABASE) private readonly database: Pool,
    @Inject(AIService) private readonly ai: AIService,
  ) {}

  @Post('diary/draft')
  async diaryDraft(@Req() request: Request, @Body() body: any) {
    return this.ai.run({
      taskType: 'diary_draft',
      requestedBy: request.auth?.userId ?? request.auth?.staffId ?? 'system',
      userId: request.auth?.userId,
      context: { feeling: body?.feeling ?? null, free_text: body?.free_text ?? '' },
    });
  }

  @Post('chat/suggestion')
  async chatSuggestion(@Req() request: Request, @Body() body: any) {
    return this.ai.run({
      taskType: 'chat_suggestion',
      requestedBy: request.auth?.userId ?? request.auth?.staffId ?? 'system',
      userId: request.auth?.userId,
      caseId: body?.case_id ?? null,
      context: {
        main_request: body?.main_request ?? null,
        current_safety: body?.current_safety ?? 'unknown',
        goal: body?.goal ?? 'empathetic_listening',
      },
    });
  }


  @Post('chat/stream')
  async chatStream(@Req() request: Request, @Body() body: any, @Res() response: Response) {
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const send = (event: string, payload: unknown) => {
      if (response.writableEnded) return;
      response.write('event: ' + event + '\n');
      response.write('data: ' + JSON.stringify(payload) + '\n\n');
    };
    try {
      const result = await this.ai.streamChatSuggestion({
        requestedBy: request.auth?.userId ?? request.auth?.staffId ?? 'system',
        userId: request.auth?.userId,
        caseId: body?.case_id ?? null,
        context: {
          main_request: body?.main_request ?? body?.free_text ?? null,
          current_safety: body?.current_safety ?? 'unknown',
          goal: body?.goal ?? 'empathetic_listening',
        },
        onDelta: (text) => send('delta', { text }),
      });
      send('done', result);
    } catch (error) {
      send('error', { message: error instanceof Error ? error.message : '实时聊天失败，请稍后重试' });
    } finally {
      response.end();
    }
  }

  @Post('transfer-summary')
  async transferSummary(@Req() request: Request, @Body() body: any) {
    const requestedBy = request.auth?.staffId;
    if (!requestedBy) throw errors.permissionDenied('需要志愿者或专业督导身份');
    return this.ai.run({
      taskType: 'transfer_summary',
      requestedBy,
      caseId: body?.case_id ?? null,
      context: { summary_scope: body?.summary_scope ?? [] },
    });
  }

  @Post('safety-check')
  async safetyCheck(@Body() body: any) {
    const result = this.ai.checkSafety(String(body?.content ?? ''));
    return {
      passed: result.passed,
      reason: result.reason ?? null,
      requires_human_confirmation: true,
    };
  }

  @Post('resource-recommendation')
  async resourceRecommendation(@Body() body: any) {
    const rows = await this.database
      .query(
        `SELECT * FROM resources
         WHERE status = 'verified' AND region = ? AND (? IS NULL OR category = ?)
         ORDER BY verified_at DESC LIMIT 20`,
        [body?.region ?? 'shanghai', body?.category ?? null, body?.category ?? null],
      )
      .then(([rows]) => rows as any[]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        region: row.region,
        contact: parseJsonField(row.contact, {}),
        verified_at: row.verified_at,
        status: row.status,
      })),
      requires_human_confirmation: true,
    };
  }

  @Get('health')
  async health() {
    const config = await this.ai.getActiveConfig();
    return {
      enabled: Boolean(config?.enabled),
      provider: config?.provider ?? null,
      model: config?.model ?? null,
      api_key_configured: Boolean(process.env.DEEPSEEK_API_KEY),
      mode: process.env.DEEPSEEK_API_KEY ? 'deepseek' : process.env.AI_ALLOW_MOCK === 'false' ? 'disabled' : 'mock',
    };
  }
}
