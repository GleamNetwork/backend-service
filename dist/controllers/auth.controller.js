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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const auth_1 = require("../auth");
const auth_service_1 = require("../services/auth.service");
let AuthController = class AuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    async createUserSession(body) {
        if (!body?.age_band || !body?.district_id) {
            throw Object.assign(new Error('age_band 和 district_id 不能为空'), { status: 400 });
        }
        const result = await this.auth.createUserSession({
            ageBand: String(body.age_band),
            districtId: String(body.district_id),
            displayName: body.display_name,
        });
        return {
            token: result.token,
            refresh_token: result.refreshToken,
            user: result.user,
            expires_at: result.expiresAt.toISOString(),
        };
    }
    async volunteerLogin(body) {
        if (!body?.account || !body?.password) {
            throw Object.assign(new Error('account 和 password 不能为空'), { status: 400 });
        }
        return this.auth.loginStaff(String(body.account), String(body.password));
    }
    async managerLogin(body) {
        if (!body?.account || !body?.password) {
            throw Object.assign(new Error('account 和 password 不能为空'), { status: 400 });
        }
        return this.auth.loginStaff(String(body.account), String(body.password));
    }
    async refresh(body) {
        if (!body?.refresh_token) {
            throw Object.assign(new Error('refresh_token 不能为空'), { status: 400 });
        }
        return this.auth.refresh(String(body.refresh_token));
    }
    async logout(request, body) {
        const sessionId = body?.session_id ?? request.auth?.sessionId;
        if (!sessionId)
            throw Object.assign(new Error('session_id 不能为空'), { status: 400 });
        await this.auth.logout(String(sessionId));
        return { revoked: true };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('user-session'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "createUserSession", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('volunteer-login'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "volunteerLogin", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('manager-login'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "managerLogin", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('refresh'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.HttpCode)(200),
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __param(0, (0, common_1.Inject)(auth_service_1.AuthService)),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map