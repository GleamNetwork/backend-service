"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const errors_1 = require("../errors");
const case_service_1 = require("../services/case.service");
const auth_service_1 = require("../services/auth.service");
const event_service_1 = require("../services/event.service");
const utils_1 = require("../utils");
let UserController = class UserController {
    database;
    auth;
    cases;
    events;
    constructor(database, auth, cases, events) {
        this.database = database;
        this.auth = auth;
        this.cases = cases;
        this.events = events;
    }
    async userId(request) {
        return this.auth.assertUser(request.auth);
    }
    async me(request) {
        const userId = await this.userId(request);
        const [user] = await this.database
            .query('SELECT * FROM users WHERE id = ?', [userId])
            .then(([rows]) => rows);
        const consents = await this.getConsents(userId);
        return { ...user, consents };
    }
    async updateMe(request, body) {
        const userId = await this.userId(request);
        await this.database.execute(`UPDATE users SET display_name = COALESCE(?, display_name), age_band = COALESCE(?, age_band), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [body?.display_name ?? null, body?.age_band ?? null, userId]);
        return this.me(request);
    }
    async consents(request) {
        return { consents: await this.getConsents(await this.userId(request)) };
    }
    async updateConsents(request, body) {
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
                await this.database.execute(`INSERT INTO consents (id, user_id, consent_type, granted, granted_at, scope)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), JSON_OBJECT())
           ON DUPLICATE KEY UPDATE granted = VALUES(granted), granted_at = UTC_TIMESTAMP(6)`, [(0, utils_1.uuid)(), userId, key, Boolean(body[key])]);
            }
        }
        return { user_id: userId, consents: await this.getConsents(userId), updated_at: new Date().toISOString() };
    }
    async deviceMetrics(request) {
        const userId = await this.userId(request);
        const rows = await this.database
            .query(`SELECT * FROM device_metrics WHERE user_id = ? ORDER BY sampled_at DESC, created_at DESC LIMIT 50`, [userId])
            .then(([rows]) => rows);
        return {
            items: rows.map((row) => ({
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
    async deviceTrends(request) {
        const userId = await this.userId(request);
        const rows = await this.database
            .query(`SELECT * FROM metric_summaries WHERE user_id = ? ORDER BY time_window_start DESC LIMIT 30`, [userId])
            .then(([rows]) => rows);
        return {
            items: rows.map((row) => ({
                metric_type: row.metric_type,
                time_window_start: row.time_window_start,
                time_window_end: row.time_window_end,
                summary_value: (0, utils_1.parseJsonField)(row.summary_value, {}),
                completeness: Number(row.completeness),
                source: row.source,
            })),
        };
    }
    async createCareResponse(request, body) {
        const userId = await this.userId(request);
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO care_responses (id, user_id, scenario, want_exercise, note, created_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [
            id,
            userId,
            String(body?.scenario ?? 'unknown'),
            Boolean(body?.want_exercise),
            body?.note ?? null,
        ]);
        return { id, user_id: userId, scenario: body?.scenario, want_exercise: Boolean(body?.want_exercise) };
    }
    async listDiary(request) {
        const userId = await this.userId(request);
        const rows = await this.database
            .query('SELECT * FROM diary_entries WHERE user_id = ? ORDER BY created_at DESC', [userId])
            .then(([rows]) => rows);
        return { items: rows };
    }
    async createDiaryDraft(request, body) {
        const userId = await this.userId(request);
        const id = (0, utils_1.uuid)();
        const content = String(body?.free_text ?? body?.content ?? '');
        await this.database.execute(`INSERT INTO diary_entries (id, user_id, feeling, content, status, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [id, userId, body?.feeling ?? null, content]);
        await this.database.execute(`INSERT INTO diary_versions (id, diary_id, version, content, created_at, created_by)
       VALUES (?, ?, 1, ?, UTC_TIMESTAMP(6), ?)`, [(0, utils_1.uuid)(), id, content, userId]);
        const [row] = await this.database
            .query('SELECT * FROM diary_entries WHERE id = ?', [id])
            .then(([rows]) => rows);
        return { ...row, ai_generated: false };
    }
    async updateDiary(request, diaryId, body) {
        const userId = await this.userId(request);
        const [entry] = await this.database
            .query('SELECT * FROM diary_entries WHERE id = ? AND user_id = ?', [diaryId, userId])
            .then(([rows]) => rows);
        if (!entry)
            throw errors_1.errors.notFound('日记不存在');
        const nextVersion = Number(entry.current_version) + 1;
        const content = String(body?.content ?? entry.content);
        await this.database.execute(`UPDATE diary_entries
       SET content = ?, feeling = COALESCE(?, feeling), status = 'draft', confirmed_at = NULL,
           shared_scope = NULL, current_version = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`, [content, body?.feeling ?? null, nextVersion, diaryId]);
        await this.database.execute(`INSERT INTO diary_versions (id, diary_id, version, content, created_at, created_by)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`, [(0, utils_1.uuid)(), diaryId, nextVersion, content, userId]);
        await this.database.execute('UPDATE diary_shares SET revoked_at = UTC_TIMESTAMP(6) WHERE diary_id = ?', [diaryId]);
        const [row] = await this.database
            .query('SELECT * FROM diary_entries WHERE id = ?', [diaryId])
            .then(([rows]) => rows);
        return row;
    }
    async confirmDiary(request, diaryId) {
        const userId = await this.userId(request);
        const result = await this.database
            .execute(`UPDATE diary_entries SET status = 'confirmed', confirmed_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND user_id = ?`, [diaryId, userId])
            .then(([result]) => result);
        if (result.affectedRows === 0)
            throw errors_1.errors.notFound('日记不存在');
        const [row] = await this.database
            .query('SELECT * FROM diary_entries WHERE id = ?', [diaryId])
            .then(([rows]) => rows);
        return row;
    }
    async shareDiary(request, diaryId, body) {
        const userId = await this.userId(request);
        const [entry] = await this.database
            .query(`SELECT * FROM diary_entries WHERE id = ? AND user_id = ? AND status = 'confirmed'`, [diaryId, userId])
            .then(([rows]) => rows);
        if (!entry)
            throw errors_1.errors.stateConflict('日记必须先由本人确认后才能分享');
        const scope = String(body?.scope ?? 'current_case_volunteer');
        await this.database.execute(`INSERT INTO diary_shares (id, diary_id, diary_version, case_id, recipient_role, shared_at, expires_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`, [(0, utils_1.uuid)(), diaryId, entry.current_version, body?.case_id ?? null, scope]);
        await this.database.execute(`UPDATE diary_entries SET shared_scope = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [scope, diaryId]);
        const [row] = await this.database
            .query('SELECT * FROM diary_entries WHERE id = ?', [diaryId])
            .then(([rows]) => rows);
        return { ...row, shared_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
    }
    async revokeDiary(request, diaryId) {
        const userId = await this.userId(request);
        await this.database.execute(`UPDATE diary_shares SET revoked_at = UTC_TIMESTAMP(6) WHERE diary_id = ?`, [diaryId]);
        await this.database.execute(`UPDATE diary_entries SET shared_scope = NULL, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND user_id = ?`, [diaryId, userId]);
        return { diary_id: diaryId, shared_scope: null, revoked_at: new Date().toISOString() };
    }
    async listChat(request) {
        const userId = await this.userId(request);
        const chatRows = await this.database
            .query(`SELECT id, user_id, NULL AS case_id, sender_role, content, ai_assisted, created_at
         FROM chat_messages
         WHERE user_id = ?
         ORDER BY created_at ASC
         LIMIT 200`, [userId])
            .then(([rows]) => rows);
        const [caseRow] = await this.database
            .query(`SELECT id
         FROM service_cases
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`, [userId])
            .then(([rows]) => rows);
        const caseRows = caseRow
            ? await this.database
                .query(`SELECT id, case_id, sender_role, sender_id, content, ai_assisted, visibility_scope, created_at
             FROM case_messages
             WHERE case_id = ?
             ORDER BY created_at ASC
             LIMIT 200`, [caseRow.id])
                .then(([rows]) => rows)
            : [];
        const items = [
            ...chatRows,
            ...caseRows.map((row) => ({
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
        ].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
        return { items: items.slice(-200) };
    }
    async sendChat(request, body) {
        const userId = await this.userId(request);
        const content = String(body?.content ?? '');
        const [activeCase] = await this.database
            .query(`SELECT id, district_id, assigned_volunteer_id
         FROM service_cases
         WHERE user_id = ?
           AND status IN ('waiting_assignment', 'in_progress', 'awaiting_transfer', 'professional_takeover_requested', 'professional_taken_over')
         ORDER BY created_at DESC
         LIMIT 1`, [userId])
            .then(([rows]) => rows);
        if (activeCase) {
            const id = (0, utils_1.uuid)();
            await this.database.execute(`INSERT INTO case_messages
         (id, case_id, sender_role, sender_id, content, ai_assisted, visibility_scope, created_at)
         VALUES (?, ?, 'user', ?, ?, FALSE, 'case_participants', UTC_TIMESTAMP(6))`, [id, activeCase.id, userId, content]);
            if (activeCase.assigned_volunteer_id) {
                await this.events.publish({
                    eventType: 'case.message.created',
                    aggregateType: 'case',
                    aggregateId: activeCase.id,
                    audienceType: 'staff',
                    audienceId: activeCase.assigned_volunteer_id,
                    payload: { message_id: id, sender_role: 'user' },
                });
            }
            else {
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
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO chat_messages (id, user_id, sender_role, content, ai_assisted, created_at)
       VALUES (?, ?, 'user', ?, FALSE, UTC_TIMESTAMP(6))`, [id, userId, content]);
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
    async submitNeeds(request, body) {
        const userId = await this.userId(request);
        const unsafe = body?.current_safety === 'unsafe' || body?.immediate_safety === true;
        const [user] = await this.database
            .query('SELECT * FROM users WHERE id = ?', [userId])
            .then(([rows]) => rows);
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
    async escalate(request, body) {
        const userId = await this.userId(request);
        const [user] = await this.database
            .query('SELECT * FROM users WHERE id = ?', [userId])
            .then(([rows]) => rows);
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
    async startExercise(request, type, body) {
        const userId = await this.userId(request);
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO exercises (id, user_id, type, status, safety_confirmed, started_at, updated_at)
       VALUES (?, ?, ?, 'in_progress', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [id, userId, type, Boolean(body?.safety_confirmed)]);
        return { exercise_id: id, type, status: 'in_progress', safety_notice: '若有明显急症，请先寻求医疗帮助。' };
    }
    async updateExercise(request, exerciseId, body) {
        const userId = await this.userId(request);
        await this.database.execute(`UPDATE exercises SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND user_id = ?`, [String(body?.action ?? 'paused'), exerciseId, userId]);
        return { exercise_id: exerciseId, status: body?.action ?? 'paused' };
    }
    async completeExercise(request, exerciseId, body) {
        const userId = await this.userId(request);
        await this.database.execute(`UPDATE exercises SET status = 'completed', ended_at = UTC_TIMESTAMP(6), feeling_after = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND user_id = ?`, [body?.feeling_after ?? null, exerciseId, userId]);
        return { exercise_id: exerciseId, status: 'completed', feeling_after: body?.feeling_after ?? null };
    }
    async getQuestionnaire(type) {
        return {
            type,
            title: type === 'phq2' ? '过去两周的感受记录' : '可选状态记录',
            items: type === 'phq2'
                ? [
                    { id: 'interest', text: '做事时提不起劲或没有兴趣' },
                    { id: 'mood', text: '感到心情低落、沮丧或绝望' },
                ]
                : [{ id: 'today', text: '今天的状态' }],
            notice: '这份记录帮助表达感受，不生成诊断或风险等级。',
        };
    }
    async submitQuestionnaire(request, type, body) {
        const userId = await this.userId(request);
        const id = (0, utils_1.uuid)();
        const answers = Array.isArray(body?.answers) ? body.answers : [];
        const score = answers.reduce((sum, item) => sum + Number(item?.value === 'several_days' ? 1 : item?.value === 'more_than_half_days' ? 2 : item?.value === 'nearly_every_day' ? 3 : 0), 0);
        await this.database.execute(`INSERT INTO questionnaire_responses (id, user_id, questionnaire_type, answers, score, created_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [id, userId, type, JSON.stringify(answers), score]);
        return { id, type, score, notice: '分数不用于诊断，也不单独决定转诊。' };
    }
    async currentCase(request) {
        const userId = await this.userId(request);
        const [row] = await this.database
            .query('SELECT * FROM service_cases WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId])
            .then(([rows]) => rows);
        return row ?? { status: 'none', service_progress: 'no_request' };
    }
    async createCase(request, body) {
        const userId = await this.userId(request);
        const [user] = await this.database
            .query('SELECT * FROM users WHERE id = ?', [userId])
            .then(([rows]) => rows);
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
    async getConsents(userId) {
        const rows = await this.database
            .query('SELECT consent_type, granted FROM consents WHERE user_id = ?', [userId])
            .then(([rows]) => rows);
        return rows.reduce((acc, row) => ({ ...acc, [row.consent_type]: Boolean(row.granted) }), {});
    }
    async emergencyResources() {
        const rows = await this.database
            .query(`SELECT * FROM resources
         WHERE status = 'verified' AND region = 'china' AND category IN ('medical_emergency','mental_hotline','public_safety')
         ORDER BY FIELD(category, 'medical_emergency', 'public_safety', 'mental_hotline')`)
            .then(([rows]) => rows);
        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            contact: (0, utils_1.parseJsonField)(row.contact, {}),
        }));
    }
};
exports.UserController = UserController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)('me'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateMe", null);
__decorate([
    (0, common_1.Get)('me/consents'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "consents", null);
__decorate([
    (0, common_1.Patch)('me/consents'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateConsents", null);
__decorate([
    (0, common_1.Get)('me/device/metrics'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "deviceMetrics", null);
__decorate([
    (0, common_1.Get)('me/device/trends'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "deviceTrends", null);
__decorate([
    (0, common_1.Post)('me/device/care-responses'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createCareResponse", null);
__decorate([
    (0, common_1.Get)('me/diary'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "listDiary", null);
__decorate([
    (0, common_1.Post)('me/diary/drafts'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createDiaryDraft", null);
__decorate([
    (0, common_1.Patch)('me/diary/:diary_id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('diary_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateDiary", null);
__decorate([
    (0, common_1.Post)('me/diary/:diary_id/confirm'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('diary_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "confirmDiary", null);
__decorate([
    (0, common_1.Post)('me/diary/:diary_id/share'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('diary_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "shareDiary", null);
__decorate([
    (0, common_1.Delete)('me/diary/:diary_id/share'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('diary_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "revokeDiary", null);
__decorate([
    (0, common_1.Get)('me/chat/messages'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "listChat", null);
__decorate([
    (0, common_1.Post)('me/chat/messages'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "sendChat", null);
__decorate([
    (0, common_1.Post)('me/chat/needs'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "submitNeeds", null);
__decorate([
    (0, common_1.Post)('me/safety/escalate'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "escalate", null);
__decorate([
    (0, common_1.Post)('me/exercises/:type/start'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('type')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "startExercise", null);
__decorate([
    (0, common_1.Patch)('me/exercises/:exercise_id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('exercise_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateExercise", null);
__decorate([
    (0, common_1.Post)('me/exercises/:exercise_id/complete'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('exercise_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "completeExercise", null);
__decorate([
    (0, common_1.Get)('me/questionnaires/:type'),
    __param(0, (0, common_1.Param)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getQuestionnaire", null);
__decorate([
    (0, common_1.Post)('me/questionnaires/:type/responses'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('type')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "submitQuestionnaire", null);
__decorate([
    (0, common_1.Get)('me/support-cases/current'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "currentCase", null);
__decorate([
    (0, common_1.Post)('me/support-cases'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createCase", null);
exports.UserController = UserController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, common_2.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_2.Inject)(auth_service_1.AuthService)),
    __param(2, (0, common_2.Inject)(case_service_1.CaseService)),
    __param(3, (0, common_2.Inject)(event_service_1.EventService)),
    __metadata("design:paramtypes", [Object, auth_service_1.AuthService,
        case_service_1.CaseService,
        event_service_1.EventService])
], UserController);
//# sourceMappingURL=user.controller.js.map