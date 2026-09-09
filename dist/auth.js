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
exports.AuthGuard = exports.REQUIRED_ROLES = exports.IS_PUBLIC = void 0;
exports.Public = Public;
exports.Roles = Roles;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const database_module_1 = require("./database.module");
const errors_1 = require("./errors");
const security_1 = require("./security");
exports.IS_PUBLIC = 'tongpin:is-public';
exports.REQUIRED_ROLES = 'tongpin:required-roles';
function Public() {
    return (0, common_1.SetMetadata)(exports.IS_PUBLIC, true);
}
function Roles(...roles) {
    return (0, common_1.SetMetadata)(exports.REQUIRED_ROLES, roles);
}
let AuthGuard = class AuthGuard {
    reflector;
    database;
    constructor(reflector, database) {
        this.reflector = reflector;
        this.database = database;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        if (this.reflector.get(exports.IS_PUBLIC, context.getHandler()))
            return true;
        const token = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!token)
            throw errors_1.errors.authRequired();
        const [session] = await this.database
            .query(`SELECT id, user_id, staff_id, role, expires_at, revoked_at
         FROM sessions
         WHERE access_token_hash = ?
         LIMIT 1`, [(0, security_1.sha256)(token)])
            .then(([rows]) => rows);
        if (!session || session.revoked_at)
            throw errors_1.errors.authRequired();
        if (new Date(session.expires_at).getTime() <= Date.now())
            throw errors_1.errors.authRequired();
        let districtIds;
        if (session.staff_id) {
            const districts = await this.database
                .query('SELECT district_id FROM staff_districts WHERE staff_id = ?', [session.staff_id])
                .then(([rows]) => rows);
            districtIds = districts.map((row) => row.district_id);
        }
        request.auth = {
            sessionId: session.id,
            role: session.role,
            userId: session.user_id ?? undefined,
            staffId: session.staff_id ?? undefined,
            districtIds,
            expiresAt: new Date(session.expires_at),
        };
        const requiredRoles = this.reflector.getAllAndOverride(exports.REQUIRED_ROLES, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (requiredRoles && !requiredRoles.includes(request.auth.role)) {
            throw errors_1.errors.permissionDenied();
        }
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(core_1.Reflector)),
    __param(1, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [core_1.Reflector, Object])
], AuthGuard);
//# sourceMappingURL=auth.js.map