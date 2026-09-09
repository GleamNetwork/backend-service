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
exports.AIController = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const ai_service_1 = require("../services/ai.service");
const errors_1 = require("../errors");
const utils_1 = require("../utils");
let AIController = class AIController {
    database;
    ai;
    constructor(database, ai) {
        this.database = database;
        this.ai = ai;
    }
    async diaryDraft(request, body) {
        return this.ai.run({
            taskType: 'diary_draft',
            requestedBy: request.auth?.userId ?? request.auth?.staffId ?? 'system',
            userId: request.auth?.userId,
            context: { feeling: body?.feeling ?? null, free_text: body?.free_text ?? '' },
        });
    }
    async chatSuggestion(request, body) {
        return this.ai.run({
            taskType: 'chat_suggestion',
            requestedBy: request.auth?.userId ?? request.auth?.staffId ?? 'system',
            userId: request.auth?.userId,
            caseId: body?.case_id ?? null,
            context: {
                main_request: body?.main_request ?? null,
                current_safety: body?.current_safety ?? 'unknown',
                goal: body?.goal ?? 'empathetic_listening',
            },
        });
    }
    async transferSummary(request, body) {
        const requestedBy = request.auth?.staffId;
        if (!requestedBy)
            throw errors_1.errors.permissionDenied('需要志愿者或专业督导身份');
        return this.ai.run({
            taskType: 'transfer_summary',
            requestedBy,
            caseId: body?.case_id ?? null,
            context: { summary_scope: body?.summary_scope ?? [] },
        });
    }
    async safetyCheck(body) {
        const result = this.ai.checkSafety(String(body?.content ?? ''));
        return {
            passed: result.passed,
            reason: result.reason ?? null,
            requires_human_confirmation: true,
        };
    }
    async resourceRecommendation(body) {
        const rows = await this.database
            .query(`SELECT * FROM resources
         WHERE status = 'verified' AND region = ? AND (? IS NULL OR category = ?)
         ORDER BY verified_at DESC LIMIT 20`, [body?.region ?? 'shanghai', body?.category ?? null, body?.category ?? null])
            .then(([rows]) => rows);
        return {
            items: rows.map((row) => ({
                id: row.id,
                name: row.name,
                category: row.category,
                region: row.region,
                contact: (0, utils_1.parseJsonField)(row.contact, {}),
                verified_at: row.verified_at,
                status: row.status,
            })),
            requires_human_confirmation: true,
        };
    }
    async health() {
        const config = await this.ai.getActiveConfig();
        return {
            enabled: Boolean(config?.enabled),
            provider: config?.provider ?? null,
            model: config?.model ?? null,
            api_key_configured: Boolean(process.env.DEEPSEEK_API_KEY),
            mode: process.env.DEEPSEEK_API_KEY ? 'deepseek' : process.env.AI_ALLOW_MOCK === 'false' ? 'disabled' : 'mock',
        };
    }
};
exports.AIController = AIController;
__decorate([
    (0, common_1.Post)('diary/draft'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIController.prototype, "diaryDraft", null);
__decorate([
    (0, common_1.Post)('chat/suggestion'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIController.prototype, "chatSuggestion", null);
__decorate([
    (0, common_1.Post)('transfer-summary'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIController.prototype, "transferSummary", null);
__decorate([
    (0, common_1.Post)('safety-check'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AIController.prototype, "safetyCheck", null);
__decorate([
    (0, common_1.Post)('resource-recommendation'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AIController.prototype, "resourceRecommendation", null);
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AIController.prototype, "health", null);
exports.AIController = AIController = __decorate([
    (0, common_1.Controller)('ai'),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(ai_service_1.AIService)),
    __metadata("design:paramtypes", [Object, ai_service_1.AIService])
], AIController);
//# sourceMappingURL=ai.controller.js.map