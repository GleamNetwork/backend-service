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
exports.VolunteerController = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const auth_1 = require("../auth");
const errors_1 = require("../errors");
const case_service_1 = require("../services/case.service");
const event_service_1 = require("../services/event.service");
const utils_1 = require("../utils");
let VolunteerController = class VolunteerController {
    database;
    cases;
    events;
    constructor(database, cases, events) {
        this.database = database;
        this.cases = cases;
        this.events = events;
    }
    async me(request) {
        const staffId = this.requireStaff(request);
        const [staff] = await this.database
            .query('SELECT id, display_name, role, status, daily_limit, concurrent_limit, self_check_passed_at FROM staff_accounts WHERE id = ?', [staffId])
            .then(([rows]) => rows);
        const districts = await this.database
            .query('SELECT district_id FROM staff_districts WHERE staff_id = ?', [staffId])
            .then(([rows]) => rows);
        return { ...staff, district_ids: districts.map((row) => row.district_id) };
    }
    async casesList(request) {
        const staffId = this.requireStaff(request);
        const districts = await this.getDistricts(staffId);
        const rows = await this.database
            .query(`SELECT * FROM service_cases
         WHERE (assigned_volunteer_id = ? OR (status = 'waiting_assignment' AND district_id IN (?)))
         ORDER BY FIELD(status, 'waiting_assignment', 'in_progress', 'awaiting_transfer', 'professional_taken_over', 'completed'), created_at DESC
         LIMIT 100`, [staffId, districts.length ? districts : ['__none__']])
            .then(([rows]) => rows);
        return { items: rows.map((row) => this.cases.mapCase(row)) };
    }
    async accept(request, caseId) {
        const staffId = this.requireStaff(request);
        if (request.auth?.role !== 'volunteer') {
            throw errors_1.errors.permissionDenied('仅普通志愿者可以承接普通工单');
        }
        return this.cases.acceptCase(caseId, staffId, await this.getDistricts(staffId));
    }
    async caseDetail(request, caseId) {
        return this.cases.assertCaseAccess(caseId, request.auth);
    }
    async sendMessage(request, caseId, body) {
        const row = await this.cases.assertCaseAccess(caseId, request.auth);
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO case_messages (id, case_id, sender_role, sender_id, content, ai_assisted, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'case_participants', UTC_TIMESTAMP(6))`, [id, caseId, request.auth.role, request.auth.staffId, String(body?.content ?? ''), Boolean(body?.ai_assisted)]);
        await this.events.publish({
            eventType: 'case.message.created',
            aggregateType: 'case',
            aggregateId: caseId,
            audienceType: 'user',
            audienceId: row.user_id,
            payload: { message_id: id, sender_role: request.auth.role },
        });
        return {
            message_id: id,
            case_id: caseId,
            sender_role: request.auth.role,
            created_at: new Date().toISOString(),
            delivered: true,
        };
    }
    async close(request, caseId) {
        return this.cases.closeCase(caseId, this.requireStaff(request));
    }
    async rest(request, body) {
        const staffId = this.requireStaff(request);
        await this.database.execute(`UPDATE staff_accounts SET status = 'resting', updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [staffId]);
        await this.events.publish({
            eventType: 'volunteer.status.updated',
            aggregateType: 'staff',
            aggregateId: staffId,
            audienceType: 'staff',
            audienceId: staffId,
            payload: { status: 'resting', reason: body?.reason ?? null },
        });
        return { staff_id: staffId, status: 'resting', stop_new_cases: true };
    }
    async selfCheck(request, body) {
        const staffId = this.requireStaff(request);
        const passed = Boolean(body?.fit_to_continue && body?.private_environment);
        await this.database.execute(`UPDATE staff_accounts
       SET self_check_passed_at = ?, status = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`, [passed ? new Date() : null, passed ? 'active' : 'paused', staffId]);
        return { staff_id: staffId, self_check_passed: passed, status: passed ? 'active' : 'paused' };
    }
    async schedule(request) {
        const staffId = this.requireStaff(request);
        const rows = await this.database
            .query('SELECT * FROM schedules WHERE staff_id = ? ORDER BY start_at ASC', [staffId])
            .then(([rows]) => rows);
        return { items: rows };
    }
    async capacity(request) {
        const staffId = this.requireStaff(request);
        const [staff] = await this.database
            .query('SELECT daily_limit, concurrent_limit FROM staff_accounts WHERE id = ?', [staffId])
            .then(([rows]) => rows);
        const [capacity] = await this.database
            .query('SELECT * FROM staff_capacity WHERE staff_id = ? AND service_date = UTC_DATE()', [staffId])
            .then(([rows]) => rows);
        return {
            daily_limit: staff?.daily_limit ?? 6,
            concurrent_limit: staff?.concurrent_limit ?? 2,
            current_daily_count: capacity?.daily_count ?? 0,
            current_concurrent_count: capacity?.concurrent_count ?? 0,
        };
    }
    async transferRequest(request, body) {
        const staffId = this.requireStaff(request);
        const caseId = String(body?.case_id ?? '');
        const row = await this.cases.assertCaseAccess(caseId, request.auth);
        if (row.assigned_volunteer_id !== staffId)
            throw errors_1.errors.scopeDenied('仅当前承接者可以申请交接');
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO transfer_requests
       (id, case_id, type, from_staff_id, to_staff_id, status, summary_scope, requested_at)
       VALUES (?, ?, ?, ?, ?, 'requested', ?, UTC_TIMESTAMP(6))`, [
            id,
            caseId,
            String(body?.type ?? 'shift_transfer'),
            staffId,
            body?.to_volunteer_id ?? null,
            JSON.stringify(body?.summary_scope ?? ['main_request', 'safety_facts', 'actions_taken']),
        ]);
        await this.database.execute(`UPDATE service_cases SET service_progress = 'awaiting_transfer', status = 'awaiting_transfer', updated_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?`, [caseId]);
        await this.events.publish({
            eventType: 'case.transfer.requested',
            aggregateType: 'case',
            aggregateId: caseId,
            audienceType: 'staff',
            audienceId: body?.to_volunteer_id ?? null,
            payload: { transfer_request_id: id },
        });
        return { transfer_request_id: id, status: 'requested', receiver_confirmation_required: true };
    }
    async professionalRequest(request, body) {
        const staffId = this.requireStaff(request);
        const caseId = String(body?.case_id ?? '');
        const row = await this.cases.getCase(caseId);
        if (request.auth?.role === 'volunteer' && row.assigned_volunteer_id !== staffId) {
            throw errors_1.errors.scopeDenied('仅当前承接者可以发起专业求助');
        }
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO professional_requests
       (id, case_id, requested_by, status, reason, requested_at)
       VALUES (?, ?, ?, 'waiting_confirmation', ?, UTC_TIMESTAMP(6))`, [id, caseId, staffId, String(body?.reason ?? '需要专业支持')]);
        await this.database.execute(`UPDATE service_cases SET service_progress = 'awaiting_transfer', status = 'professional_takeover_requested', updated_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?`, [caseId]);
        await this.events.publish({
            eventType: 'case.professional.requested',
            aggregateType: 'case',
            aggregateId: caseId,
            audienceType: 'district',
            audienceId: row.district_id,
            payload: { professional_request_id: id },
        });
        return { professional_request_id: id, status: 'waiting_confirmation' };
    }
    async reviewRequest(request, body) {
        const staffId = this.requireStaff(request);
        const caseId = String(body?.case_id ?? '');
        const [caseRow] = await this.database
            .query('SELECT user_id FROM service_cases WHERE id = ?', [caseId])
            .then(([rows]) => rows);
        if (!caseRow)
            throw errors_1.errors.notFound('工单不存在');
        const id = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO support_reviews (id, case_id, user_id, reviewer_id, support_need_level, evidence_summary, reviewed_at)
       VALUES (?, ?, ?, ?, 'unverified', ?, UTC_TIMESTAMP(6))`, [id, caseId, caseRow.user_id, staffId, String(body?.reason ?? '申请专业复核')]);
        return { review_request_id: id, status: 'pending' };
    }
    requireStaff(request) {
        const staffId = request.auth?.staffId;
        if (!staffId)
            throw errors_1.errors.permissionDenied('需要志愿者或管理端身份');
        return staffId;
    }
    async getDistricts(staffId) {
        const rows = await this.database
            .query('SELECT district_id FROM staff_districts WHERE staff_id = ?', [staffId])
            .then(([rows]) => rows);
        return rows.map((row) => row.district_id);
    }
};
exports.VolunteerController = VolunteerController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "me", null);
__decorate([
    (0, common_1.Get)('cases'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "casesList", null);
__decorate([
    (0, common_1.Post)('cases/:case_id/accept'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('case_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "accept", null);
__decorate([
    (0, common_1.Get)('cases/:case_id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('case_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "caseDetail", null);
__decorate([
    (0, common_1.Post)('cases/:case_id/messages'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('case_id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "sendMessage", null);
__decorate([
    (0, common_1.Post)('cases/:case_id/close'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('case_id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "close", null);
__decorate([
    (0, common_1.Post)('rest'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "rest", null);
__decorate([
    (0, common_1.Post)('self-check'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "selfCheck", null);
__decorate([
    (0, common_1.Get)('schedule'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "schedule", null);
__decorate([
    (0, common_1.Get)('capacity'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "capacity", null);
__decorate([
    (0, common_1.Post)('transfer-requests'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "transferRequest", null);
__decorate([
    (0, common_1.Post)('professional-requests'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "professionalRequest", null);
__decorate([
    (0, common_1.Post)('review-requests'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VolunteerController.prototype, "reviewRequest", null);
exports.VolunteerController = VolunteerController = __decorate([
    (0, common_1.Controller)('volunteer'),
    (0, auth_1.Roles)('volunteer', 'professional_supervisor'),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(case_service_1.CaseService)),
    __param(2, (0, common_1.Inject)(event_service_1.EventService)),
    __metadata("design:paramtypes", [Object, case_service_1.CaseService,
        event_service_1.EventService])
], VolunteerController);
//# sourceMappingURL=volunteer.controller.js.map