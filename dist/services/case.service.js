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
exports.CaseService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const errors_1 = require("../errors");
const utils_1 = require("../utils");
const event_service_1 = require("./event.service");
let CaseService = class CaseService {
    database;
    events;
    constructor(database, events) {
        this.database = database;
        this.events = events;
    }
    async createCase(input) {
        const caseId = (0, utils_1.uuid)();
        const responsePath = input.immediateSafety ? 'R0' : (input.responsePath ?? 'R3');
        const supportNeed = input.immediateSafety
            ? 'immediate_safety'
            : (input.supportNeedLevel ?? 'unverified');
        await this.database.execute(`INSERT INTO service_cases
       (id, user_id, district_id, support_need_level, service_progress, response_path, status,
        consent_scope, request_type, preferred_contact, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'waiting_support', ?, 'waiting_assignment', ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [
            caseId,
            input.userId,
            input.districtId,
            supportNeed,
            responsePath,
            JSON.stringify(input.consentScope),
            input.requestType,
            input.preferredContact ?? 'text',
        ]);
        await this.events.publish({
            eventType: 'case.created',
            aggregateType: 'case',
            aggregateId: caseId,
            audienceType: 'district',
            audienceId: input.districtId,
            payload: { response_path: responsePath, immediate_safety: input.immediateSafety },
        });
        return this.getCase(caseId);
    }
    async getCase(caseId) {
        const [row] = await this.database
            .query('SELECT * FROM service_cases WHERE id = ?', [caseId])
            .then(([rows]) => rows);
        if (!row)
            throw errors_1.errors.notFound('支援请求不存在');
        return this.mapCase(row);
    }
    async acceptCase(caseId, staffId, districtIds) {
        const connection = await this.database.getConnection();
        try {
            await connection.beginTransaction();
            const [cases] = await connection.query(`SELECT * FROM service_cases
         WHERE id = ? AND status = 'waiting_assignment'
         FOR UPDATE`, [caseId]);
            const row = cases[0];
            if (!row)
                throw errors_1.errors.stateConflict('工单不存在、已被承接或状态已变化');
            if (!districtIds.includes(row.district_id))
                throw errors_1.errors.scopeDenied('工单不在当前授权辖区');
            if (row.support_need_level === 'immediate_safety') {
                throw errors_1.errors.immediateSafetyRequired();
            }
            const [staffRows] = await connection.query('SELECT * FROM staff_accounts WHERE id = ? FOR UPDATE', [staffId]);
            const staff = staffRows[0];
            if (!staff || staff.status !== 'active')
                throw errors_1.errors.accountLocked('志愿者不可用');
            if (!staff.self_check_passed_at)
                throw errors_1.errors.stateConflict('志愿者尚未完成自检');
            const serviceDate = new Date().toISOString().slice(0, 10);
            const [capacityRows] = await connection.query(`SELECT * FROM staff_capacity
         WHERE staff_id = ? AND service_date = ? FOR UPDATE`, [staffId, serviceDate]);
            let capacity = capacityRows[0];
            if (!capacity) {
                await connection.execute(`INSERT INTO staff_capacity (id, staff_id, service_date, daily_count, concurrent_count, updated_at)
           VALUES (?, ?, ?, 0, 0, UTC_TIMESTAMP(6))`, [(0, utils_1.uuid)(), staffId, serviceDate]);
                capacity = { daily_count: 0, concurrent_count: 0 };
            }
            if (capacity.daily_count >= staff.daily_limit) {
                throw errors_1.errors.capacityExceeded('今日接待已达上限，请申请调配人手');
            }
            if (capacity.concurrent_count >= staff.concurrent_limit) {
                throw errors_1.errors.capacityExceeded('同时陪伴已满，请先完成或交接当前服务');
            }
            await connection.execute(`UPDATE service_cases
         SET assigned_volunteer_id = ?, owner_type = 'staff', owner_id = ?,
             status = 'in_progress', service_progress = 'in_progress',
             version = version + 1, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'waiting_assignment'`, [staffId, staffId, caseId]);
            await connection.execute(`UPDATE staff_capacity
         SET daily_count = daily_count + 1, concurrent_count = concurrent_count + 1, updated_at = UTC_TIMESTAMP(6)
         WHERE staff_id = ? AND service_date = ?`, [staffId, serviceDate]);
            await connection.execute(`INSERT INTO capacity_events
         (id, staff_id, case_id, event_type, daily_count_after, concurrent_count_after, occurred_at)
         VALUES (?, ?, ?, 'accept', ?, ?, UTC_TIMESTAMP(6))`, [(0, utils_1.uuid)(), staffId, caseId, capacity.daily_count + 1, capacity.concurrent_count + 1]);
            const eventId = await this.events.publish({
                eventType: 'case.assigned',
                aggregateType: 'case',
                aggregateId: caseId,
                audienceType: 'district',
                audienceId: row.district_id,
                payload: { staff_id: staffId },
                connection,
            });
            await this.events.publish({
                eventType: 'case.assigned',
                aggregateType: 'case',
                aggregateId: caseId,
                audienceType: 'user',
                audienceId: row.user_id,
                payload: { staff_id: staffId },
                connection,
            });
            await connection.commit();
            return { event_id: eventId, ...(await this.getCase(caseId)) };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async closeCase(caseId, staffId) {
        const [result] = await this.database.execute(`UPDATE service_cases
       SET status = 'completed', service_progress = 'completed', closed_at = UTC_TIMESTAMP(6),
           version = version + 1, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND assigned_volunteer_id = ? AND status = 'in_progress'`, [caseId, staffId]);
        if (result.affectedRows === 0)
            throw errors_1.errors.stateConflict('仅当前承接者可以结束进行中的服务');
        await this.database.execute(`UPDATE staff_capacity
       SET concurrent_count = GREATEST(concurrent_count - 1, 0), updated_at = UTC_TIMESTAMP(6)
       WHERE staff_id = ? AND service_date = UTC_DATE()`, [staffId]);
        const row = await this.getCase(caseId);
        await this.events.publish({
            eventType: 'case.closed',
            aggregateType: 'case',
            aggregateId: caseId,
            audienceType: 'district',
            audienceId: row.district_id,
        });
        await this.events.publish({
            eventType: 'case.closed',
            aggregateType: 'case',
            aggregateId: caseId,
            audienceType: 'user',
            audienceId: row.user_id,
        });
        return row;
    }
    async assertCaseAccess(caseId, auth) {
        const row = await this.getCase(caseId);
        if (auth.role === 'professional_supervisor')
            return row;
        if (auth.role !== 'volunteer')
            throw errors_1.errors.permissionDenied();
        if (row.assigned_volunteer_id !== auth.staffId)
            throw errors_1.errors.scopeDenied('仅当前承接者可访问');
        return row;
    }
    mapCase(row) {
        return {
            id: row.id,
            user_id: row.user_id,
            district_id: row.district_id,
            support_need_level: row.support_need_level,
            service_progress: row.service_progress,
            response_path: row.response_path,
            status: row.status,
            assigned_volunteer_id: row.assigned_volunteer_id,
            owner_type: row.owner_type,
            owner_id: row.owner_id,
            consent_scope: (0, utils_1.parseJsonField)(row.consent_scope, []),
            request_type: row.request_type,
            preferred_contact: row.preferred_contact,
            created_at: row.created_at,
            updated_at: row.updated_at,
            closed_at: row.closed_at,
            version: Number(row.version),
        };
    }
};
exports.CaseService = CaseService;
exports.CaseService = CaseService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(event_service_1.EventService)),
    __metadata("design:paramtypes", [Object, event_service_1.EventService])
], CaseService);
//# sourceMappingURL=case.service.js.map