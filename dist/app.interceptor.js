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
exports.AuditInterceptor = exports.IdempotencyInterceptor = exports.RequestContextInterceptor = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const utils_1 = require("./utils");
const audit_service_1 = require("./services/audit.service");
const database_module_1 = require("./database.module");
let RequestContextInterceptor = class RequestContextInterceptor {
    intercept(context, next) {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        request.requestId = request.headers['x-request-id']?.toString() ?? (0, node_crypto_1.randomUUID)();
        response.setHeader('X-Request-Id', request.requestId);
        return next.handle();
    }
};
exports.RequestContextInterceptor = RequestContextInterceptor;
exports.RequestContextInterceptor = RequestContextInterceptor = __decorate([
    (0, common_1.Injectable)()
], RequestContextInterceptor);
let IdempotencyInterceptor = class IdempotencyInterceptor {
    database;
    constructor(database) {
        this.database = database;
    }
    intercept(context, next) {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method))
            return next.handle();
        const key = request.headers['idempotency-key'];
        if (!key || Array.isArray(key))
            return next.handle();
        return new rxjs_1.Observable((subscriber) => {
            void (async () => {
                const requestHash = (0, utils_1.hashRequest)({ body: request.body, query: request.query });
                const [existing] = await this.database
                    .query(`SELECT response_status, response_body FROM idempotency_keys
             WHERE idempotency_key = ? LIMIT 1`, [key])
                    .then(([rows]) => rows);
                if (existing) {
                    if (existing.response_body?.request_hash !== requestHash) {
                        subscriber.error(Object.assign(new Error('同一幂等键的请求内容不一致'), { status: 400 }));
                        return;
                    }
                    response.status(existing.response_status);
                    subscriber.next(existing.response_body?.body);
                    subscriber.complete();
                    return;
                }
                next.handle().subscribe({
                    next: (value) => {
                        void this.database
                            .query(`INSERT INTO idempotency_keys
                 (id, idempotency_key, actor_id, endpoint, request_hash, response_status, response_body, created_at, expires_at)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`, [
                            key,
                            request.auth?.userId ?? request.auth?.staffId ?? null,
                            request.originalUrl,
                            requestHash,
                            response.statusCode,
                            JSON.stringify({ request_hash: requestHash, body: value ?? null }),
                        ])
                            .catch((error) => console.error('[idempotency:save]', error));
                        subscriber.next(value);
                    },
                    error: (error) => subscriber.error(error),
                    complete: () => subscriber.complete(),
                });
            })();
        });
    }
};
exports.IdempotencyInterceptor = IdempotencyInterceptor;
exports.IdempotencyInterceptor = IdempotencyInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], IdempotencyInterceptor);
let AuditInterceptor = class AuditInterceptor {
    audit;
    constructor(audit) {
        this.audit = audit;
    }
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method))
            return next.handle();
        return next.handle().pipe((0, operators_1.tap)({
            next: () => {
                void this.audit
                    .record(request, {
                    action: `${request.method.toLowerCase()}_request`,
                    objectType: 'http_endpoint',
                    objectId: null,
                    result: 'success',
                    reason: request.originalUrl,
                })
                    .catch((error) => console.error('[audit:save]', error));
            },
            error: (error) => {
                void this.audit
                    .record(request, {
                    action: `${request.method.toLowerCase()}_request`,
                    objectType: 'http_endpoint',
                    objectId: null,
                    result: 'failed',
                    reason: error instanceof Error ? error.message : 'unknown',
                })
                    .catch((auditError) => console.error('[audit:save:failed]', auditError));
            },
        }));
    }
};
exports.AuditInterceptor = AuditInterceptor;
exports.AuditInterceptor = AuditInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(audit_service_1.AuditService)),
    __metadata("design:paramtypes", [audit_service_1.AuditService])
], AuditInterceptor);
//# sourceMappingURL=app.interceptor.js.map