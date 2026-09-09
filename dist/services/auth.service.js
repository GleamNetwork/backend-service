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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const errors_1 = require("../errors");
const security_1 = require("../security");
const utils_1 = require("../utils");
const event_service_1 = require("./event.service");
let AuthService = class AuthService {
    database;
    events;
    constructor(database, events) {
        this.database = database;
        this.events = events;
    }
    async createUserSession(input) {
        const allowedAgeBands = ['12-13', '14-17', '18+'];
        if (!allowedAgeBands.includes(input.ageBand)) {
            throw errors_1.errors.validation('age_band 必须为 12-13、14-17 或 18+');
        }
        const userId = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO users (id, display_name, age_band, district_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [userId, input.displayName ?? '匿名用户', input.ageBand, input.districtId]);
        await this.seedDefaultConsents(userId);
        const token = (0, security_1.randomToken)('u_');
        const refresh = (0, security_1.randomToken)('r_');
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await this.database.execute(`INSERT INTO sessions
       (id, user_id, role, access_token_hash, refresh_token_hash, created_at, expires_at)
       VALUES (?, ?, 'user', ?, ?, UTC_TIMESTAMP(6), ?)`, [(0, utils_1.uuid)(), userId, (0, security_1.sha256)(token), (0, security_1.sha256)(refresh), expiresAt]);
        await this.events.publish({
            eventType: 'user.session.created',
            aggregateType: 'user',
            aggregateId: userId,
            audienceType: 'user',
            audienceId: userId,
            payload: { age_band: input.ageBand, district_id: input.districtId },
        });
        const [user] = await this.database
            .query('SELECT * FROM users WHERE id = ?', [userId])
            .then(([rows]) => rows);
        return { token, user, expiresAt };
    }
    async loginStaff(account, password) {
        const [staff] = await this.database
            .query('SELECT * FROM staff_accounts WHERE username = ?', [account])
            .then(([rows]) => rows);
        if (!staff || !(0, security_1.verifyPassword)(password, staff.password_hash)) {
            throw errors_1.errors.authRequired('账号或密码不正确');
        }
        if (staff.status !== 'active')
            throw errors_1.errors.accountLocked('账号已暂停或资格失效');
        return this.createStaffSession(staff);
    }
    async createStaffSession(staff) {
        const token = (0, security_1.randomToken)('s_');
        const refresh = (0, security_1.randomToken)('r_');
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await this.database.execute(`INSERT INTO sessions
       (id, staff_id, role, access_token_hash, refresh_token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`, [(0, utils_1.uuid)(), staff.id, staff.role, (0, security_1.sha256)(token), (0, security_1.sha256)(refresh), expiresAt]);
        return { token, refresh_token: refresh, role: staff.role, expires_at: expiresAt.toISOString() };
    }
    async refresh(refreshToken) {
        const [session] = await this.database
            .query(`SELECT s.* FROM sessions s
         WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL
         LIMIT 1`, [(0, security_1.sha256)(refreshToken)])
            .then(([rows]) => rows);
        if (!session)
            throw errors_1.errors.authRequired('Refresh Token 无效或已撤销');
        const token = (0, security_1.randomToken)(session.user_id ? 'u_' : 's_');
        const refresh = (0, security_1.randomToken)('r_');
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await this.database.execute(`UPDATE sessions
       SET access_token_hash = ?, refresh_token_hash = ?, expires_at = ?, refreshed_at = UTC_TIMESTAMP(6)
       WHERE id = ?`, [(0, security_1.sha256)(token), (0, security_1.sha256)(refresh), expiresAt, session.id]);
        return { token, refresh_token: refresh, role: session.role, expires_at: expiresAt.toISOString() };
    }
    async logout(sessionId) {
        await this.database.execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE id = ?', [
            sessionId,
        ]);
    }
    async assertUser(auth) {
        if (!auth?.userId || auth.role !== 'user')
            throw errors_1.errors.scopeDenied('需要用户身份');
        return auth.userId;
    }
    async seedDefaultConsents(userId) {
        const rows = [
            'device_metrics',
            'activity_reminder',
            'trend_summary_share',
            'diary_share',
            'chat_share',
        ].map((type) => [(0, utils_1.uuid)(), userId, type, false, JSON.stringify({})]);
        await this.database.query(`INSERT INTO consents (id, user_id, consent_type, granted, scope) VALUES ?`, [rows]);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(event_service_1.EventService)),
    __metadata("design:paramtypes", [Object, event_service_1.EventService])
], AuthService);
//# sourceMappingURL=auth.service.js.map