import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import mysql from 'mysql2/promise';
import type { INestApplication } from '@nestjs/common';
import { configureTestEnvironment, extractToken, resetTestDatabase, TEST_DB_NAME, TEST_PASSWORD } from '../helpers/e2e';

configureTestEnvironment();

let app: INestApplication;
let userToken: string;
let volunteerToken: string;
let volunteer2Token: string;
let managerToken: string;
let supervisorToken: string;
let aiAdminToken: string;
let diaryId: string;
let exerciseId: string;
let normalCaseId: string;
let transferCaseId: string;
let professionalCaseId: string;
let transferRequestId: string;
let professionalRequestId: string;
let scheduleId: string;
let aiConfigDraftId: string;
let promptId: string;
let skillId: string;
let toolId: string;
let refreshToken: string;

beforeAll(async () => {
  await resetTestDatabase();

  // Add one schedule row so the PATCH endpoint has a real object to update.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB_NAME,
  });
  scheduleId = '11111111-1111-4111-8111-111111111111';
  await connection.execute(
    `INSERT INTO schedules
     (id, staff_id, district_id, shift_type, start_at, end_at, role_in_shift, version, created_at)
     VALUES (UUID(), ?, 'district_shanghai_a', 'day', UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 4 HOUR), 'primary', 1, UTC_TIMESTAMP())`,
    [scheduleId],
  );
  await connection.end();

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('Tongpin B2 full API', () => {
  it('implements every route declared in the OpenAPI contract', async () => {
    const spec = yaml.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'public', 'openapi.yaml'), 'utf-8'),
    ) as { paths: Record<string, Record<string, unknown>> };
    const expected = new Set<string>();
    for (const [route, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          expected.add(`${method.toUpperCase()} /api/v1${route}`);
        }
      }
    }

    const express = app.getHttpAdapter().getInstance() as any;
    const actual = new Set<string>();
    for (const layer of express._router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        const route = String(layer.route.path).replace(/:([^/]+)/g, '{$1}');
        actual.add(`${method.toUpperCase()} ${route}`);
      }
    }

    expect(actual.size).toBe(expected.size);
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it('checks health and public resources', async () => {
    const health = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.database).toBe('ok');
    expect(health.body.ai.model).toBe('deepseek-v4-flash');

    const resources = await request(app.getHttpServer())
      .get('/api/v1/resources')
      .query({ region: 'shanghai' })
      .expect(200);
    expect(resources.body.items.length).toBeGreaterThan(0);
    expect(resources.body.items[0].contact.phone).toBe('12356');
  });

  it('creates an anonymous user session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/user-session')
      .send({ age_band: '14-17', district_id: 'district_shanghai_a' })
      .expect(201);
    userToken = extractToken(response);
    expect(response.body.user.age_band).toBe('14-17');
  });

  it('manages user profile and consents', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set(auth(userToken))
      .expect(200);
    expect(me.body.consents.device_metrics).toBe(false);

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set(auth(userToken))
      .send({ display_name: '小屿' })
      .expect(200);
    expect(updated.body.display_name).toBe('小屿');

    const consentList = await request(app.getHttpServer())
      .get('/api/v1/me/consents')
      .set(auth(userToken))
      .expect(200);
    expect(consentList.body.consents).toBeDefined();

    const consentUpdate = await request(app.getHttpServer())
      .patch('/api/v1/me/consents')
      .set(auth(userToken))
      .send({ device_metrics: true, activity_reminder: true })
      .expect(200);
    expect(consentUpdate.body.consents.device_metrics).toBe(true);
  });

  it('returns missing device data without blocking support', async () => {
    const metrics = await request(app.getHttpServer())
      .get('/api/v1/me/device/metrics')
      .set(auth(userToken))
      .expect(200);
    expect(metrics.body.items).toEqual([]);

    const trends = await request(app.getHttpServer())
      .get('/api/v1/me/device/trends')
      .set(auth(userToken))
      .expect(200);
    expect(trends.body.items).toEqual([]);

    const care = await request(app.getHttpServer())
      .post('/api/v1/me/device/care-responses')
      .set(auth(userToken))
      .send({ scenario: 'body_uncomfortable', want_exercise: false })
      .expect(201);
    expect(care.body.want_exercise).toBe(false);
  });

  it('supports diary draft, edit, confirm, share, and revoke', async () => {
    const draft = await request(app.getHttpServer())
      .post('/api/v1/me/diary/drafts')
      .set(auth(userToken))
      .send({ feeling: 'low', free_text: '今天有点累。' })
      .expect(201);
    diaryId = draft.body.id;
    expect(draft.body.status).toBe('draft');

    const list = await request(app.getHttpServer())
      .get('/api/v1/me/diary')
      .set(auth(userToken))
      .expect(200);
    expect(list.body.items.some((item: any) => item.id === diaryId)).toBe(true);

    const edited = await request(app.getHttpServer())
      .patch(`/api/v1/me/diary/${diaryId}`)
      .set(auth(userToken))
      .send({ content: '今天有点累，但我想记录下来。' })
      .expect(200);
    expect(edited.body.current_version).toBe(2);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/me/diary/${diaryId}/confirm`)
      .set(auth(userToken))
      .expect(201);
    expect(confirmed.body.status).toBe('confirmed');

    const shared = await request(app.getHttpServer())
      .post(`/api/v1/me/diary/${diaryId}/share`)
      .set(auth(userToken))
      .send({ scope: 'current_case_volunteer' })
      .expect(201);
    expect(shared.body.shared_scope).toBe('current_case_volunteer');

    const revoked = await request(app.getHttpServer())
      .delete(`/api/v1/me/diary/${diaryId}/share`)
      .set(auth(userToken))
      .expect(200);
    expect(revoked.body.shared_scope).toBeNull();
  });

  it('supports chat messages and current-need collection', async () => {
    const sent = await request(app.getHttpServer())
      .post('/api/v1/me/chat/messages')
      .set(auth(userToken))
      .send({ content: '我今天有点难受，想找人聊聊。' })
      .expect(201);
    expect(sent.body.sender_role).toBe('user');

    const messages = await request(app.getHttpServer())
      .get('/api/v1/me/chat/messages')
      .set(auth(userToken))
      .expect(200);
    expect(messages.body.items.length).toBeGreaterThan(0);

    const needs = await request(app.getHttpServer())
      .post('/api/v1/me/chat/needs')
      .set(auth(userToken))
      .send({ current_safety: 'safe', main_need: 'talk_to_human' })
      .expect(201);
    expect(needs.body.response_path).toBe('R3');
  });

  it('escalates immediate safety without normal queue or questionnaire', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/me/safety/escalate')
      .set(auth(userToken))
      .send({ safety_status: 'unsafe', physical_emergency: false })
      .expect(201);
    expect(response.body.response_path).toBe('R0');
    expect(response.body.support_need_level).toBe('immediate_safety');
    expect(response.body.status).toBe('waiting_confirmation');
    expect(response.body.resources.some((item: any) => item.contact.phone === '120')).toBe(true);
  });

  it('supports voluntary exercises', async () => {
    const started = await request(app.getHttpServer())
      .post('/api/v1/me/exercises/breathing/start')
      .set(auth(userToken))
      .send({ safety_confirmed: true, willing_to_try: true })
      .expect(201);
    exerciseId = started.body.exercise_id;

    const paused = await request(app.getHttpServer())
      .patch(`/api/v1/me/exercises/${exerciseId}`)
      .set(auth(userToken))
      .send({ action: 'paused' })
      .expect(200);
    expect(paused.body.status).toBe('paused');

    const completed = await request(app.getHttpServer())
      .post(`/api/v1/me/exercises/${exerciseId}/complete`)
      .set(auth(userToken))
      .send({ feeling_after: 'slightly_relieved' })
      .expect(201);
    expect(completed.body.status).toBe('completed');
  });

  it('supports optional questionnaire without diagnosis', async () => {
    const questionnaire = await request(app.getHttpServer())
      .get('/api/v1/me/questionnaires/phq2')
      .set(auth(userToken))
      .expect(200);
    expect(questionnaire.body.items).toHaveLength(2);

    const response = await request(app.getHttpServer())
      .post('/api/v1/me/questionnaires/phq2/responses')
      .set(auth(userToken))
      .send({
        answers: [
          { item: 'interest', value: 'several_days' },
          { item: 'mood', value: 'more_than_half_days' },
        ],
      })
      .expect(201);
    expect(response.body.score).toBe(3);
    expect(response.body.notice).toContain('不用于诊断');
  });

  it('creates and reads the current support case', async () => {
    const currentBefore = await request(app.getHttpServer())
      .get('/api/v1/me/support-cases/current')
      .set(auth(userToken))
      .expect(200);
    expect(currentBefore.body).toBeDefined();

    const created = await request(app.getHttpServer())
      .post('/api/v1/me/support-cases')
      .set(auth(userToken))
      .send({
        request_type: 'volunteer_text',
        consent_scope: ['chat_text'],
        immediate_safety: false,
      })
      .expect(201);
    normalCaseId = created.body.id;
    expect(created.body.status).toBe('waiting_assignment');
    expect(created.body.estimated_wait).toBeNull();

    const current = await request(app.getHttpServer())
      .get('/api/v1/me/support-cases/current')
      .set(auth(userToken))
      .expect(200);
    expect(current.body.id).toBe(normalCaseId);
  });

  it('logs in seeded staff accounts', async () => {
    const volunteer = await request(app.getHttpServer())
      .post('/api/v1/auth/volunteer-login')
      .send({ account: 'volunteer.lin', password: TEST_PASSWORD })
      .expect(201);
    volunteerToken = extractToken(volunteer);
    refreshToken = volunteer.body.refresh_token;

    const volunteer2 = await request(app.getHttpServer())
      .post('/api/v1/auth/volunteer-login')
      .send({ account: 'volunteer.zhou', password: TEST_PASSWORD })
      .expect(201);
    volunteer2Token = extractToken(volunteer2);

    const manager = await request(app.getHttpServer())
      .post('/api/v1/auth/manager-login')
      .send({ account: 'manager.xu', password: TEST_PASSWORD })
      .expect(201);
    managerToken = extractToken(manager);
    expect(manager.body.role).toBe('duty_manager');

    const supervisor = await request(app.getHttpServer())
      .post('/api/v1/auth/manager-login')
      .send({ account: 'supervisor.chen', password: TEST_PASSWORD })
      .expect(201);
    supervisorToken = extractToken(supervisor);
    expect(supervisor.body.role).toBe('professional_supervisor');

    const aiAdmin = await request(app.getHttpServer())
      .post('/api/v1/auth/manager-login')
      .send({ account: 'ai.admin', password: TEST_PASSWORD })
      .expect(201);
    aiAdminToken = extractToken(aiAdmin);
    expect(aiAdmin.body.role).toBe('ai_config_admin');
  });

  it('supports volunteer rest, self-check, schedule, and capacity', async () => {
    const rest = await request(app.getHttpServer())
      .post('/api/v1/volunteer/rest')
      .set(auth(volunteerToken))
      .send({ stop_new_cases: true })
      .expect(201);
    expect(rest.body.status).toBe('resting');

    const selfCheck = await request(app.getHttpServer())
      .post('/api/v1/volunteer/self-check')
      .set(auth(volunteerToken))
      .send({ fit_to_continue: true, private_environment: true })
      .expect(201);
    expect(selfCheck.body.status).toBe('active');

    const me = await request(app.getHttpServer())
      .get('/api/v1/volunteer/me')
      .set(auth(volunteerToken))
      .expect(200);
    expect(me.body.display_name).toBe('林然');

    const schedule = await request(app.getHttpServer())
      .get('/api/v1/volunteer/schedule')
      .set(auth(volunteerToken))
      .expect(200);
    expect(schedule.body.items.length).toBeGreaterThan(0);

    const capacity = await request(app.getHttpServer())
      .get('/api/v1/volunteer/capacity')
      .set(auth(volunteerToken))
      .expect(200);
    expect(capacity.body.daily_limit).toBe(6);
  });

  it('lets an eligible volunteer atomically accept a case', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/volunteer/cases')
      .set(auth(volunteerToken))
      .expect(200);
    expect(list.body.items.some((item: any) => item.id === normalCaseId)).toBe(true);

    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/volunteer/cases/${normalCaseId}/accept`)
      .set(auth(volunteerToken))
      .send({ acknowledge_scope: ['chat_text'] })
      .expect(201);
    expect(accepted.body.status).toBe('in_progress');
    expect(accepted.body.assigned_volunteer_id).toBe('11111111-1111-4111-8111-111111111111');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/volunteer/cases/${normalCaseId}`)
      .set(auth(volunteerToken))
      .expect(200);
    expect(detail.body.id).toBe(normalCaseId);

    const message = await request(app.getHttpServer())
      .post(`/api/v1/volunteer/cases/${normalCaseId}/messages`)
      .set(auth(volunteerToken))
      .send({ content: '谢谢你愿意说出来。', ai_assisted: false })
      .expect(201);
    expect(message.body.delivered).toBe(true);
  });

  it('creates and confirms a normal shift transfer', async () => {
    const caseResponse = await request(app.getHttpServer())
      .post('/api/v1/me/support-cases')
      .set(auth(userToken))
      .send({ request_type: 'volunteer_text', consent_scope: ['chat_text'] })
      .expect(201);
    transferCaseId = caseResponse.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/volunteer/cases/${transferCaseId}/accept`)
      .set(auth(volunteerToken))
      .send({})
      .expect(201);

    const transfer = await request(app.getHttpServer())
      .post('/api/v1/volunteer/transfer-requests')
      .set(auth(volunteerToken))
      .send({
        case_id: transferCaseId,
        type: 'shift_transfer',
        to_volunteer_id: '55555555-5555-4555-8555-555555555555',
      })
      .expect(201);
    transferRequestId = transfer.body.transfer_request_id;
    expect(transfer.body.receiver_confirmation_required).toBe(true);

    const queue = await request(app.getHttpServer())
      .get('/api/v1/manager/transfer-requests')
      .set(auth(managerToken))
      .expect(200);
    expect(queue.body.items.some((item: any) => item.id === transferRequestId)).toBe(true);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/manager/transfer-requests/${transferRequestId}/confirm`)
      .set(auth(managerToken))
      .send({ receiver_volunteer_id: '55555555-5555-4555-8555-555555555555' })
      .expect(201);
    expect(confirmed.body.status).toBe('receiver_confirmed');
    expect(confirmed.body.old_owner_released).toBe(true);

    const closed = await request(app.getHttpServer())
      .post(`/api/v1/volunteer/cases/${transferCaseId}/close`)
      .set(auth(volunteer2Token))
      .send({ user_agreed: true })
      .expect(201);
    expect(closed.body.status).toBe('completed');
  });

  it('creates and confirms professional takeover and support review', async () => {
    const caseResponse = await request(app.getHttpServer())
      .post('/api/v1/me/support-cases')
      .set(auth(userToken))
      .send({ request_type: 'volunteer_text', consent_scope: ['chat_text'] })
      .expect(201);
    professionalCaseId = caseResponse.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/volunteer/cases/${professionalCaseId}/accept`)
      .set(auth(volunteerToken))
      .send({})
      .expect(201);

    const reviewRequest = await request(app.getHttpServer())
      .post('/api/v1/volunteer/review-requests')
      .set(auth(volunteerToken))
      .send({ case_id: professionalCaseId, reason: '需要专业复核' })
      .expect(201);
    expect(reviewRequest.body.status).toBe('pending');

    const professional = await request(app.getHttpServer())
      .post('/api/v1/volunteer/professional-requests')
      .set(auth(volunteerToken))
      .send({ case_id: professionalCaseId, reason: '用户明确表示当前不安全。' })
      .expect(201);
    professionalRequestId = professional.body.professional_request_id;

    const queue = await request(app.getHttpServer())
      .get('/api/v1/manager/professional-requests')
      .set(auth(supervisorToken))
      .expect(200);
    expect(queue.body.items.some((item: any) => item.id === professionalRequestId)).toBe(true);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/manager/professional-requests/${professionalRequestId}/confirm`)
      .set(auth(supervisorToken))
      .send({ reviewed_user_situation: true })
      .expect(201);
    expect(confirmed.body.status).toBe('professional_taken_over');
    expect(confirmed.body.old_transfer_request_status).toBe('superseded');

    const review = await request(app.getHttpServer())
      .post('/api/v1/manager/support-reviews')
      .set(auth(supervisorToken))
      .send({
        case_id: professionalCaseId,
        support_need_level: 'sustained_support',
        evidence_summary: '本人反馈持续低落并影响睡眠。',
      })
      .expect(201);
    expect(review.body.support_need_level).toBe('sustained_support');
  });

  it('supports manager overview, lists, schedule update, audit, and resources', async () => {
    const overview = await request(app.getHttpServer())
      .get('/api/v1/manager/overview')
      .set(auth(managerToken))
      .expect(200);
    expect(overview.body.district_ids).toContain('district_shanghai_a');
    expect(overview.body.support_need_distribution).toBeDefined();

    const users = await request(app.getHttpServer())
      .get('/api/v1/manager/users')
      .set(auth(managerToken))
      .expect(200);
    expect(users.body.items.length).toBeGreaterThan(0);

    const volunteers = await request(app.getHttpServer())
      .get('/api/v1/manager/volunteers')
      .set(auth(managerToken))
      .expect(200);
    expect(volunteers.body.items.length).toBeGreaterThan(1);

    const schedules = await request(app.getHttpServer())
      .get('/api/v1/manager/schedules')
      .set(auth(managerToken))
      .expect(200);
    expect(schedules.body.items.length).toBeGreaterThan(0);

    const updatedSchedule = await request(app.getHttpServer())
      .patch(`/api/v1/manager/schedules/${schedules.body.items[0].id}`)
      .set(auth(managerToken))
      .send({ role_in_shift: 'backup' })
      .expect(200);
    expect(updatedSchedule.body.role_in_shift).toBe('backup');

    const audit = await request(app.getHttpServer())
      .get('/api/v1/manager/audit-logs')
      .set(auth(managerToken))
      .expect(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(audit.body.items[0].action).toMatch(/^(post|patch|put|delete)_request$/);

    const resource = await request(app.getHttpServer())
      .post('/api/v1/manager/resources')
      .set(auth(managerToken))
      .send({
        name: '测试社区支持资源',
        category: 'community_service',
        region: 'shanghai',
        contact: { phone: '021-00000000' },
        service_time: { available_time: '工作日' },
        official_source: 'https://example.com',
      })
      .expect(201);
    expect(resource.body.status).toBe('verified');
  });

  it('configures, tests, and publishes AI settings', async () => {
    const current = await request(app.getHttpServer())
      .get('/api/v1/manager/ai/config')
      .set(auth(aiAdminToken))
      .expect(200);
    expect(current.body.active_config.model).toBe('deepseek-v4-flash');
    const promptMappings = current.body.active_config.prompt_ids;

    const draft = await request(app.getHttpServer())
      .post('/api/v1/manager/ai/config')
      .set(auth(aiAdminToken))
      .send({
        provider: 'deepseek',
        base_url: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        default_parameters: {
          thinking: { type: 'disabled' },
          reasoning_effort: 'low',
          max_tokens: 800,
          temperature: 0.2,
          top_p: 0.9,
          response_format: { type: 'json_object' },
          stream: false,
        },
        prompt_ids: promptMappings,
      })
      .expect(201);
    aiConfigDraftId = draft.body.id;
    expect(draft.body.status).toBe('draft');
    expect(draft.body.skill_ids.length).toBeGreaterThan(0);
    expect(draft.body.tool_ids.length).toBeGreaterThan(0);

    const rejectedPublish = await request(app.getHttpServer())
      .post(`/api/v1/manager/ai/config/${aiConfigDraftId}/publish`)
      .set(auth(aiAdminToken))
      .send({})
      .expect(422);
    expect(rejectedPublish.body.error.code).toBe('AI_CONFIG_INVALID');

    const tested = await request(app.getHttpServer())
      .post(`/api/v1/manager/ai/config/${aiConfigDraftId}/test`)
      .set(auth(aiAdminToken))
      .send({ task_type: 'chat_suggestion', synthetic_input: { main_request: '希望有人听我说说' } })
      .expect(201);
    expect(tested.body.request_valid).toBe(true);

    const published = await request(app.getHttpServer())
      .post(`/api/v1/manager/ai/config/${aiConfigDraftId}/publish`)
      .set(auth(aiAdminToken))
      .send({})
      .expect(201);
    expect(published.body.status).toBe('published');
  });

  it('manages AI prompts, skills, and tools', async () => {
    const prompts = await request(app.getHttpServer())
      .get('/api/v1/manager/ai/prompts')
      .set(auth(aiAdminToken))
      .expect(200);
    expect(prompts.body.items.length).toBeGreaterThan(0);

    const prompt = await request(app.getHttpServer())
      .post('/api/v1/manager/ai/prompts')
      .set(auth(aiAdminToken))
      .send({
        code: 'e2e_prompt',
        task_type: 'chat_suggestion',
        name: 'E2E提示词',
        system_prompt: '你是安全的倾听辅助助手。',
        user_template: '诉求：{{main_request}}',
        variables: ['main_request'],
      })
      .expect(201);
    promptId = prompt.body.id;

    const promptUpdated = await request(app.getHttpServer())
      .patch(`/api/v1/manager/ai/prompts/${promptId}`)
      .set(auth(aiAdminToken))
      .send({ name: 'E2E提示词V2' })
      .expect(200);
    expect(promptUpdated.body.name).toBe('E2E提示词V2');

    const skills = await request(app.getHttpServer())
      .get('/api/v1/manager/ai/skills')
      .set(auth(aiAdminToken))
      .expect(200);
    expect(skills.body.items).toBeDefined();

    const skill = await request(app.getHttpServer())
      .post('/api/v1/manager/ai/skills')
      .set(auth(aiAdminToken))
      .send({
        code: 'e2e_skill',
        name: 'E2E技能',
        description: '测试技能',
        instructions: '保持非评判倾听。',
        allowed_task_types: ['chat_suggestion'],
      })
      .expect(201);
    skillId = skill.body.id;

    const skillUpdated = await request(app.getHttpServer())
      .patch(`/api/v1/manager/ai/skills/${skillId}`)
      .set(auth(aiAdminToken))
      .send({ instructions: '保持非评判倾听，并提醒人工确认。' })
      .expect(200);
    expect(skillUpdated.body.instructions).toContain('人工确认');

    const tools = await request(app.getHttpServer())
      .get('/api/v1/manager/ai/tools')
      .set(auth(aiAdminToken))
      .expect(200);
    expect(tools.body.items).toBeDefined();

    const tool = await request(app.getHttpServer())
      .post('/api/v1/manager/ai/tools')
      .set(auth(aiAdminToken))
      .send({
        name: 'e2e_get_case_summary',
        description: '读取当前授权工单摘要',
        parameters_json_schema: {
          type: 'object',
          properties: { case_id: { type: 'string' } },
          required: ['case_id'],
        },
        execution_type: 'internal_read_only',
        risk_level: 'medium',
        handler: 'internal.case_summary',
      })
      .expect(201);
    toolId = tool.body.id;

    const toolUpdated = await request(app.getHttpServer())
      .patch(`/api/v1/manager/ai/tools/${toolId}`)
      .set(auth(aiAdminToken))
      .send({ timeout_ms: 600 })
      .expect(200);
    expect(toolUpdated.body.timeout_ms).toBe(600);

    const aiAudit = await request(app.getHttpServer())
      .get('/api/v1/manager/ai/audit-logs')
      .set(auth(aiAdminToken))
      .expect(200);
    expect(aiAudit.body.items).toBeDefined();
  });

  it('runs AI tasks with human confirmation and safety checks', async () => {
    const health = await request(app.getHttpServer())
      .get('/api/v1/ai/health')
      .set(auth(userToken))
      .expect(200);
    expect(health.body.mode).toBe('mock');

    const diary = await request(app.getHttpServer())
      .post('/api/v1/ai/diary/draft')
      .set(auth(userToken))
      .send({ feeling: 'low', free_text: '今天有点累。' })
      .expect(201);
    expect(diary.body.requires_human_confirmation).toBe(true);

    const chat = await request(app.getHttpServer())
      .post('/api/v1/ai/chat/suggestion')
      .set(auth(userToken))
      .send({ main_request: '希望有人听我说说', current_safety: 'safe' })
      .expect(201);
    expect(chat.body.candidate_text).toContain('谢谢你愿意说出来');

    const transferSummary = await request(app.getHttpServer())
      .post('/api/v1/ai/transfer-summary')
      .set(auth(volunteerToken))
      .send({ case_id: normalCaseId, summary_scope: ['main_request'] })
      .expect(201);
    expect(transferSummary.body.requires_human_confirmation).toBe(true);

    const safety = await request(app.getHttpServer())
      .post('/api/v1/ai/safety-check')
      .set(auth(userToken))
      .send({ content: '你可能患有抑郁症' })
      .expect(201);
    expect(safety.body.passed).toBe(false);

    const resources = await request(app.getHttpServer())
      .post('/api/v1/ai/resource-recommendation')
      .set(auth(userToken))
      .send({ region: 'shanghai', category: 'mental_hotline' })
      .expect(201);
    expect(resources.body.items[0].contact.phone).toBe('12356');
  });

  it('polls events for users and staff', async () => {
    const userEvents = await request(app.getHttpServer())
      .get('/api/v1/events/poll')
      .set(auth(userToken))
      .expect(200);
    expect(userEvents.body.events.length).toBeGreaterThan(0);

    const staffEvents = await request(app.getHttpServer())
      .get('/api/v1/events/poll')
      .set(auth(managerToken))
      .expect(200);
    expect(staffEvents.body.events.length).toBeGreaterThan(0);
  });

  it('refreshes and revokes sessions', async () => {
    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(201);
    expect(refreshed.body.token).toBeTruthy();

    const loggedOut = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set(auth(refreshed.body.token))
      .send({})
      .expect(200);
    expect(loggedOut.body.revoked).toBe(true);
  });
});
