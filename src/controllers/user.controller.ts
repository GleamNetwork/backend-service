import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { errors } from '../errors';
import { CaseService } from '../services/case.service';
import { AuthService } from '../services/auth.service';
import { EventService } from '../services/event.service';
import { parseJsonField, uuid } from '../utils';

@Controller()
export class UserController {
  constructor(
    @Inject(DATABASE) private readonly database: Pool,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CaseService) private readonly cases: CaseService,
    @Inject(EventService) private readonly events: EventService,
  ) {}

  private async userId(request: Request): Promise<string> {
    return this.auth.assertUser(request.auth);
  }

  @Get('me')
  async me(@Req() request: Request) {
    const userId = await this.userId(request);
    const [user] = await this.database
      .query('SELECT * FROM users WHERE id = ?', [userId])
      .then(([rows]) => rows as any[]);
    const consents = await this.getConsents(userId);
    return { ...user, consents };
  }

  @Patch('me')
  async updateMe(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    await this.database.execute(
      `UPDATE users SET display_name = COALESCE(?, display_name), age_band = COALESCE(?, age_band), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
      [body?.display_name ?? null, body?.age_band ?? null, userId],
    );
    return this.me(request);
  }

  @Get('me/consents')
  async consents(@Req() request: Request) {
    return { consents: await this.getConsents(await this.userId(request)) };
  }

  @Patch('me/consents')
  async updateConsents(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const allowed = [
      'device_metrics',
      'activity_reminder',
      'trend_summary_share',
      'diary_share',
      'chat_share',
    ];
    for (const key of allowed) {
      if (body && key in body) {
        await this.database.execute(
          `INSERT INTO consents (id, user_id, consent_type, granted, granted_at, scope)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), JSON_OBJECT())
           ON DUPLICATE KEY UPDATE granted = VALUES(granted), granted_at = UTC_TIMESTAMP(6)`,
          [uuid(), userId, key, Boolean(body[key])],
        );
      }
    }
    return { user_id: userId, consents: await this.getConsents(userId), updated_at: new Date().toISOString() };
  }

  @Get('me/device/metrics')
  async deviceMetrics(@Req() request: Request) {
    const userId = await this.userId(request);
    const rows = await this.database
      .query(
        `SELECT * FROM device_metrics WHERE user_id = ? ORDER BY sampled_at DESC, created_at DESC LIMIT 50`,
        [userId],
      )
      .then(([rows]) => rows as any[]);
    return {
      items: rows.map((row: any) => ({
        metric_type: row.metric_type,
        value: row.value === null ? null : Number(row.value),
        unit: row.unit,
        source: row.source,
        sampled_at: row.sampled_at,
        quality: row.quality,
        context: row.context,
      })),
    };
  }

  @Get('me/device/trends')
  async deviceTrends(@Req() request: Request) {
    const userId = await this.userId(request);
    const rows = await this.database
      .query(
        `SELECT * FROM metric_summaries WHERE user_id = ? ORDER BY time_window_start DESC LIMIT 30`,
        [userId],
      )
      .then(([rows]) => rows as any[]);
    return {
      items: rows.map((row: any) => ({
        metric_type: row.metric_type,
        time_window_start: row.time_window_start,
        time_window_end: row.time_window_end,
        summary_value: parseJsonField(row.summary_value, {}),
        completeness: Number(row.completeness),
        source: row.source,
      })),
    };
  }

  @Post('me/device/care-responses')
  async createCareResponse(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const id = uuid();
    await this.database.execute(
      `INSERT INTO care_responses (id, user_id, scenario, want_exercise, note, created_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
      [
        id,
        userId,
        String(body?.scenario ?? 'unknown'),
        Boolean(body?.want_exercise),
        body?.note ?? null,
      ],
    );
    return { id, user_id: userId, scenario: body?.scenario, want_exercise: Boolean(body?.want_exercise) };
  }

  @Get('me/diary')
  async listDiary(@Req() request: Request) {
    const userId = await this.userId(request);
    const rows = await this.database
      .query('SELECT * FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC', [userId])
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Post('me/diary/drafts')
  async createDiaryDraft(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const id = uuid();
    const content = String(body?.free_text ?? body?.content ?? '');
    await this.database.execute(
      `INSERT INTO diary_entries (id, user_id, feeling, content, status, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [id, userId, body?.feeling ?? null, content],
    );
    await this.database.execute(
      `INSERT INTO diary_versions (id, diary_id, version, content, created_at, created_by)
       VALUES (?, ?, 1, ?, UTC_TIMESTAMP(6), ?)`,
      [uuid(), id, content, userId],
    );
    const [row] = await this.database
      .query('SELECT * FROM diary_entries WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return { ...row, ai_generated: false };
  }

  @Patch('me/diary/:diary_id')
  async updateDiary(@Req() request: Request, @Param('diary_id') diaryId: string, @Body() body: any) {
    const userId = await this.userId(request);
    const [entry] = await this.database
      .query('SELECT * FROM diary_entries WHERE id = ? AND user_id = ?', [diaryId, userId])
      .then(([rows]) => rows as any[]);
    if (!entry) throw errors.notFound('日记不存在');
    const nextVersion = Number(entry.current_version) + 1;
    const content = String(body?.content ?? entry.content);
    await this.database.execute(
      `UPDATE diary_entries
       SET content = ?, feeling = COALESCE(?, feeling), status = 'draft', confirmed_at = NULL,
           shared_scope = NULL, current_version = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [content, body?.feeling ?? null, nextVersion, diaryId],
    );
    await this.database.execute(
      `INSERT INTO diary_versions (id, diary_id, version, content, created_at, created_by)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
      [uuid(), diaryId, nextVersion, content, userId],
    );
    await this.database.execute('UPDATE diary_shares SET revoked_at = UTC_TIMESTAMP(6) WHERE diary_id = ?', [diaryId]);
    const [row] = await this.database
      .query('SELECT * FROM diary_entries WHERE id = ?', [diaryId])
      .then(([rows]) => rows as any[]);
    return row;
  }

  @Post('me/diary/:diary_id/confirm')
  async confirmDiary(@Req() request: Request, @Param('diary_id') diaryId: string) {
    const userId = await this.userId(request);
    const result = await this.database
      .execute(
        `UPDATE diary_entries SET status = 'confirmed', confirmed_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND user_id = ?`,
        [diaryId, userId],
      )
      .then(([result]) => result as any);
    if (result.affectedRows === 0) throw errors.notFound('日记不存在');
    const [row] = await this.database
      .query('SELECT * FROM diary_entries WHERE id = ?', [diaryId])
      .then(([rows]) => rows as any[]);
    return row;
  }

  @Post('me/diary/:diary_id/share')
  async shareDiary(@Req() request: Request, @Param('diary_id') diaryId: string, @Body() body: any) {
    const userId = await this.userId(request);
    const [entry] = await this.database
      .query(`SELECT * FROM diary_entries WHERE id = ? AND user_id = ? AND status = 'confirmed'`, [diaryId, userId])
      .then(([rows]) => rows as any[]);
    if (!entry) throw errors.stateConflict('日记必须先由本人确认后才能分享');
    const scope = String(body?.scope ?? 'current_case_volunteer');
    await this.database.execute(
      `INSERT INTO diary_shares (id, diary_id, diary_version, case_id, recipient_role, shared_at, expires_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
      [uuid(), diaryId, entry.current_version, body?.case_id ?? null, scope],
    );
    await this.database.execute(
      `UPDATE diary_entries SET shared_scope = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
      [scope, diaryId],
    );
    const [row] = await this.database
      .query('SELECT * FROM diary_entries WHERE id = ?', [diaryId])
      .then(([rows]) => rows as any[]);
    return { ...row, shared_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
  }

  @Delete('me/diary/:diary_id/share')
  async revokeDiary(@Req() request: Request, @Param('diary_id') diaryId: string) {
    const userId = await this.userId(request);
    await this.database.execute(
      `UPDATE diary_shares SET revoked_at = UTC_TIMESTAMP(6) WHERE diary_id = ?`,
      [diaryId],
    );
    await this.database.execute(
      `UPDATE diary_entries SET shared_scope = NULL, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND user_id = ?`,
      [diaryId, userId],
    );
    return { diary_id: diaryId, shared_scope: null, revoked_at: new Date().toISOString() };
  }

  @Get('me/chat/messages')
  async listChat(@Req() request: Request) {
    const userId = await this.userId(request);
    const chatRows = await this.database
      .query(
        `SELECT id, user_id, NULL AS case_id, sender_role, content, ai_assisted, created_at
         FROM chat_messages
         WHERE user_id = ?
         ORDER BY created_at ASC
         LIMIT 200`,
        [userId],
      )
      .then(([rows]) => rows as any[]);

    const [caseRow] = await this.database
      .query(
        `SELECT id
         FROM service_cases
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
      )
      .then(([rows]) => rows as any[]);
    const caseRows = caseRow
      ? await this.database
          .query(
            `SELECT id, case_id, sender_role, sender_id, content, ai_assisted, visibility_scope, created_at
             FROM case_messages
             WHERE case_id = ?
             ORDER BY created_at ASC
             LIMIT 200`,
            [caseRow.id],
          )
          .then(([rows]) => rows as any[])
      : [];

    const items = [
      ...chatRows,
      ...caseRows.map((row: any) => ({
        id: row.id,
        user_id: userId,
        case_id: row.case_id,
        sender_role: row.sender_role,
        sender_id: row.sender_id,
        content: row.content,
        ai_assisted: row.ai_assisted,
        visibility_scope: row.visibility_scope,
        created_at: row.created_at,
      })),
    ].sort((left: any, right: any) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

    return { items: items.slice(-200) };
  }

  @Post('me/chat/messages')
  async sendChat(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const content = String(body?.content ?? '');
    const [activeCase] = await this.database
      .query(
        `SELECT id, district_id, assigned_volunteer_id
         FROM service_cases
         WHERE user_id = ?
           AND status IN ('waiting_assignment', 'in_progress', 'awaiting_transfer', 'professional_takeover_requested', 'professional_taken_over')
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
      )
      .then(([rows]) => rows as any[]);

    if (activeCase) {
      const id = uuid();
      await this.database.execute(
        `INSERT INTO case_messages
         (id, case_id, sender_role, sender_id, content, ai_assisted, visibility_scope, created_at)
         VALUES (?, ?, 'user', ?, ?, FALSE, 'case_participants', UTC_TIMESTAMP(6))`,
        [id, activeCase.id, userId, content],
      );
      if (activeCase.assigned_volunteer_id) {
        await this.events.publish({
          eventType: 'case.message.created',
          aggregateType: 'case',
          aggregateId: activeCase.id,
          audienceType: 'staff',
          audienceId: activeCase.assigned_volunteer_id,
          payload: { message_id: id, sender_role: 'user' },
        });
      } else {
        await this.events.publish({
          eventType: 'case.message.created',
          aggregateType: 'case',
          aggregateId: activeCase.id,
          audienceType: 'district',
          audienceId: activeCase.district_id,
          payload: { message_id: id, sender_role: 'user' },
        });
      }
      return {
        id,
        user_id: userId,
        case_id: activeCase.id,
        sender_role: 'user',
        content,
        ai_assisted: false,
        created_at: new Date().toISOString(),
        delivered: true,
      };
    }

    const id = uuid();
    await this.database.execute(
      `INSERT INTO chat_messages (id, user_id, sender_role, content, ai_assisted, created_at)
       VALUES (?, ?, 'user', ?, FALSE, UTC_TIMESTAMP(6))`,
      [id, userId, content],
    );
    await this.events.publish({
      eventType: 'user.chat.created',
      aggregateType: 'user',
      aggregateId: userId,
      audienceType: 'user',
      audienceId: userId,
      payload: { message_id: id },
    });
    return { id, user_id: userId, sender_role: 'user', content, created_at: new Date().toISOString(), delivered: true };
  }

  @Post('me/chat/needs')
  async submitNeeds(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const unsafe = body?.current_safety === 'unsafe' || body?.immediate_safety === true;
    const [user] = await this.database
      .query('SELECT * FROM users WHERE id = ?', [userId])
      .then(([rows]) => rows as any[]);
    const result = await this.cases.createCase({
      userId,
      districtId: user.district_id,
      requestType: unsafe ? 'immediate_safety' : String(body?.main_need ?? 'volunteer_text'),
      consentScope: ['chat_text'],
      immediateSafety: unsafe,
    });
    return {
      ...result,
      blocked_actions: unsafe ? ['questionnaire', 'activity_reminder', 'exercise_suggestion'] : [],
      real_world_resources: unsafe ? await this.emergencyResources() : [],
    };
  }

  @Post('me/safety/escalate')
  async escalate(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const [user] = await this.database
      .query('SELECT * FROM users WHERE id = ?', [userId])
      .then(([rows]) => rows as any[]);
    const result = await this.cases.createCase({
      userId,
      districtId: user.district_id,
      requestType: 'immediate_safety',
      consentScope: ['chat_text'],
      immediateSafety: true,
    });
    await this.events.publish({
      eventType: 'safety.escalated',
      aggregateType: 'case',
      aggregateId: result.id,
      audienceType: 'district',
      audienceId: user.district_id,
      payload: { physical_emergency: Boolean(body?.physical_emergency), public_safety_danger: Boolean(body?.public_safety_danger) },
    });
    return {
      case_id: result.id,
      response_path: 'R0',
      service_progress: result.service_progress,
      support_need_level: result.support_need_level,
      professional_request_id: `professional_${result.id}`,
      status: 'waiting_confirmation',
      resources: await this.emergencyResources(),
      warning: '演示系统没有真实值守，不能替代急救或专业危机服务。',
    };
  }

  @Post('me/exercises/:type/start')
  async startExercise(@Req() request: Request, @Param('type') type: string, @Body() body: any) {
    const userId = await this.userId(request);
    const id = uuid();
    await this.database.execute(
      `INSERT INTO exercises (id, user_id, type, status, safety_confirmed, started_at, updated_at)
       VALUES (?, ?, ?, 'in_progress', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [id, userId, type, Boolean(body?.safety_confirmed)],
    );
    return { exercise_id: id, type, status: 'in_progress', safety_notice: '若有明显急症，请先寻求医疗帮助。' };
  }

  @Patch('me/exercises/:exercise_id')
  async updateExercise(@Req() request: Request, @Param('exercise_id') exerciseId: string, @Body() body: any) {
    const userId = await this.userId(request);
    await this.database.execute(
      `UPDATE exercises SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND user_id = ?`,
      [String(body?.action ?? 'paused'), exerciseId, userId],
    );
    return { exercise_id: exerciseId, status: body?.action ?? 'paused' };
  }

  @Post('me/exercises/:exercise_id/complete')
  async completeExercise(@Req() request: Request, @Param('exercise_id') exerciseId: string, @Body() body: any) {
    const userId = await this.userId(request);
    await this.database.execute(
      `UPDATE exercises SET status = 'completed', ended_at = UTC_TIMESTAMP(6), feeling_after = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND user_id = ?`,
      [body?.feeling_after ?? null, exerciseId, userId],
    );
    return { exercise_id: exerciseId, status: 'completed', feeling_after: body?.feeling_after ?? null };
  }

  @Get('me/questionnaires/:type')
  async getQuestionnaire(@Param('type') type: string) {
    return {
      type,
      title: type === 'phq2' ? '过去两周的感受记录' : '可选状态记录',
      items:
        type === 'phq2'
          ? [
              { id: 'interest', text: '做事时提不起劲或没有兴趣' },
              { id: 'mood', text: '感到心情低落、沮丧或绝望' },
            ]
          : [{ id: 'today', text: '今天的状态' }],
      notice: '这份记录帮助表达感受，不生成诊断或风险等级。',
    };
  }

  @Post('me/questionnaires/:type/responses')
  async submitQuestionnaire(@Req() request: Request, @Param('type') type: string, @Body() body: any) {
    const userId = await this.userId(request);
    const id = uuid();
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const score = answers.reduce((sum: number, item: any) => sum + Number(item?.value === 'several_days' ? 1 : item?.value === 'more_than_half_days' ? 2 : item?.value === 'nearly_every_day' ? 3 : 0), 0);
    await this.database.execute(
      `INSERT INTO questionnaire_responses (id, user_id, questionnaire_type, answers, score, created_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
      [id, userId, type, JSON.stringify(answers), score],
    );
    return { id, type, score, notice: '分数不用于诊断，也不单独决定转诊。' };
  }

  @Get('me/support-cases/current')
  async currentCase(@Req() request: Request) {
    const userId = await this.userId(request);
    const [row] = await this.database
      .query('SELECT * FROM service_cases WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId])
      .then(([rows]) => rows as any[]);
    return row ?? { status: 'none', service_progress: 'no_request' };
  }

  @Post('me/support-cases')
  async createCase(@Req() request: Request, @Body() body: any) {
    const userId = await this.userId(request);
    const [user] = await this.database
      .query('SELECT * FROM users WHERE id = ?', [userId])
      .then(([rows]) => rows as any[]);
    const result = await this.cases.createCase({
      userId,
      districtId: user.district_id,
      requestType: String(body?.request_type ?? 'volunteer_text'),
      consentScope: Array.isArray(body?.consent_scope) ? body.consent_scope : ['chat_text'],
      preferredContact: body?.preferred_contact,
      immediateSafety: Boolean(body?.immediate_safety),
    });
    return {
      ...result,
      estimated_wait: null,
      notice: '当前为演示服务，不代表真实值守。',
    };
  }

  private async getConsents(userId: string): Promise<Record<string, boolean>> {
    const rows = await this.database
      .query('SELECT consent_type, granted FROM consents WHERE user_id = ?', [userId])
      .then(([rows]) => rows as any[]);
    return rows.reduce((acc, row) => ({ ...acc, [row.consent_type]: Boolean(row.granted) }), {});
  }

  private async emergencyResources(): Promise<any[]> {
    const rows = await this.database
      .query(
        `SELECT * FROM resources
         WHERE status = 'verified' AND region = 'china' AND category IN ('medical_emergency','mental_hotline','public_safety')
         ORDER BY FIELD(category, 'medical_emergency', 'public_safety', 'mental_hotline')`,
      )
      .then(([rows]) => rows as any[]);
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      contact: parseJsonField(row.contact, {}),
    }));
  }
}
