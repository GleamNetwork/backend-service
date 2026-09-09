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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const security_1 = require("../security");
const utils_1 = require("../utils");
let AuditService = class AuditService {
    database;
    constructor(database) {
        this.database = database;
    }
    async record(request, input) {
        const auth = request?.auth;
        await this.database.execute(`INSERT INTO audit_logs
       (id, actor_id, actor_role, action, object_type, object_id, result, reason, occurred_at, request_id, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?)`, [
            (0, utils_1.uuid)(),
            auth?.userId ?? auth?.staffId ?? null,
            auth?.role ?? 'system',
            input.action,
            input.objectType,
            input.objectId ?? null,
            input.result ?? 'success',
            input.reason ?? null,
            request?.requestId ?? (0, utils_1.uuid)(),
            request?.ip ? (0, security_1.sha256)(request.ip) : null,
        ]);
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], AuditService);
//# sourceMappingURL=audit.service.js.map