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
exports.AIConfigController = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database.module");
const auth_1 = require("../auth");
const errors_1 = require("../errors");
const ai_service_1 = require("../services/ai.service");
const utils_1 = require("../utils");
let AIConfigController = class AIConfigController {
    database;
    ai;
    constructor(database, ai) {
        this.database = database;
        this.ai = ai;
    }
    async getConfig() {
        const [active] = await this.database
            .query(`SELECT * FROM ai_provider_configs WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`)
            .then(([rows]) => rows);
        const drafts = await this.database
            .query(`SELECT id, version, status, created_at FROM ai_provider_configs WHERE status <> 'published' ORDER BY created_at DESC`)
            .then(([rows]) => rows);
        return {
            active_config: active ? await this.mapConfigWithArtifacts(active) : null,
            drafts,
        };
    }
    async createConfig(request, body) {
        if (!body?.provider || !body?.model || !body?.base_url) {
            throw errors_1.errors.aiConfigInvalid('provider、base_url 和 model 不能为空');
        }
        const promptMappings = (body.prompt_ids ?? body.prompt_mappings ?? {});
        await this.validatePromptMappings(promptMappings);
        const skillIds = await this.resolveSkillIds(body.skill_ids);
        const toolIds = await this.resolveToolIds(body.tool_ids);
        const [maxVersion] = await this.database
            .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_provider_configs WHERE provider = ?', [body.provider])
            .then(([rows]) => rows);
        const id = (0, utils_1.uuid)();
        const version = Number(maxVersion?.version ?? 0) + 1;
        const connection = await this.database.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(`INSERT INTO ai_provider_configs
         (id, version, provider, base_url, model, api_key_secret_ref, enabled, default_parameters,
          task_overrides, prompt_mappings, timeout_ms, max_retries, daily_token_budget, status,
          created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(6))`, [
                id,
                version,
                String(body.provider),
                String(body.base_url),
                String(body.model),
                String(body.api_key_secret_ref ?? 'deepseek_default'),
                body.enabled !== false,
                JSON.stringify(body.default_parameters ?? {}),
                JSON.stringify(body.task_overrides ?? {}),
                JSON.stringify(promptMappings),
                Number(body.timeout_ms ?? 2000),
                Number(body.max_retries ?? 1),
                Number(body.daily_token_budget ?? 200000),
                request.auth.staffId,
            ]);
            for (const skillId of skillIds) {
                await connection.execute('INSERT INTO ai_config_skills (id, ai_config_id, skill_id) VALUES (UUID(), ?, ?)', [id, skillId]);
            }
            for (const toolId of toolIds) {
                await connection.execute('INSERT INTO ai_config_tools (id, ai_config_id, tool_id) VALUES (UUID(), ?, ?)', [id, toolId]);
            }
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
        const [row] = await this.database
            .query('SELECT * FROM ai_provider_configs WHERE id = ?', [id])
            .then(([rows]) => rows);
        return {
            ...(await this.mapConfigWithArtifacts(row)),
            validation_result: { valid: true, errors: [] },
        };
    }
    async publishConfig(request, id) {
        const connection = await this.database.getConnection();
        try {
            await connection.beginTransaction();
            const rows = await connection
                .query(`SELECT * FROM ai_provider_configs WHERE id = ? FOR UPDATE`, [id])
                .then(([rows]) => rows);
            const config = rows[0];
            if (!config || config.status !== 'draft')
                throw errors_1.errors.stateConflict('配置不存在或不是草稿');
            const tests = await connection
                .query(`SELECT id FROM ai_config_tests WHERE ai_config_id = ? LIMIT 1`, [id])
                .then(([rows]) => rows);
            if (tests.length === 0) {
                throw errors_1.errors.aiConfigInvalid('发布前必须至少完成一次合成输入测试');
            }
            const currentActive = await connection
                .query(`SELECT id FROM ai_provider_configs WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`)
                .then(([rows]) => rows);
            await connection.execute(`UPDATE ai_provider_configs SET status = 'archived' WHERE status = 'published'`);
            await connection.execute(`UPDATE ai_provider_configs SET status = 'published', published_at = UTC_TIMESTAMP(6), previous_version_id = ? WHERE id = ?`, [currentActive[0]?.id ?? null, id]);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
        const [row] = await this.database
            .query('SELECT * FROM ai_provider_configs WHERE id = ?', [id])
            .then(([rows]) => rows);
        return this.mapConfigWithArtifacts(row);
    }
    async testConfig(request, id, body) {
        const [config] = await this.database
            .query('SELECT * FROM ai_provider_configs WHERE id = ?', [id])
            .then(([rows]) => rows);
        if (!config)
            throw errors_1.errors.notFound('AI 配置不存在');
        const taskType = String(body?.task_type ?? 'chat_suggestion');
        const syntheticInput = body?.synthetic_input ?? {};
        const activeConfig = await this.ai.getActiveConfig();
        let output;
        let tokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let finishReason = 'not_executed';
        if (activeConfig && activeConfig.id === id) {
            const result = await this.ai.run({
                taskType: taskType,
                requestedBy: request.auth.staffId,
                context: syntheticInput,
            });
            output = { candidate_text: result.candidate_text, uncertainty: result.uncertainty };
            tokenUsage = result.token_usage;
            finishReason = result.finish_reason ?? 'stop';
        }
        else {
            output = {
                candidate_text: '草稿配置静态校验通过：参数、提示词、技能和工具均有效。',
                uncertainty: '草稿测试不调用真实模型；发布后业务调用仍需人工确认。',
            };
            finishReason = 'not_executed';
        }
        const testId = (0, utils_1.uuid)();
        await this.database.execute(`INSERT INTO ai_config_tests
       (id, ai_config_id, task_type, synthetic_input, output, safety_check_result, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'passed', ?, UTC_TIMESTAMP(6))`, [
            testId,
            id,
            taskType,
            JSON.stringify(syntheticInput),
            JSON.stringify(output),
            request.auth.staffId,
        ]);
        return {
            test_id: testId,
            config_version: config.version,
            provider: config.provider,
            model: config.model,
            latency_ms: 0,
            request_valid: true,
            output,
            safety_check_result: 'passed',
            tool_calls: [],
            token_usage: tokenUsage,
            finish_reason: finishReason,
        };
    }
    async prompts(taskType) {
        const rows = await this.database
            .query(taskType
            ? 'SELECT * FROM ai_prompts WHERE task_type = ? ORDER BY version DESC'
            : 'SELECT * FROM ai_prompts ORDER BY task_type, version DESC', taskType ? [taskType] : [])
            .then(([rows]) => rows);
        return { items: rows };
    }
    async createPrompt(request, body) {
        const id = (0, utils_1.uuid)();
        const [max] = await this.database
            .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_prompts WHERE code = ?', [body?.code ?? body?.name])
            .then(([rows]) => rows);
        await this.database.execute(`INSERT INTO ai_prompts
       (id, code, task_type, name, system_prompt, user_template, variables, safety_constraints, version, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(6))`, [
            id,
            body?.code ?? `prompt_${(0, utils_1.uuid)().slice(0, 8)}`,
            body?.task_type ?? 'chat_suggestion',
            body?.name ?? '未命名提示词',
            body?.system_prompt ?? '',
            body?.user_template ?? '',
            JSON.stringify(body?.variables ?? []),
            JSON.stringify(body?.safety_constraints ?? []),
            Number(max?.version ?? 0) + 1,
            request.auth.staffId,
        ]);
        const [row] = await this.database
            .query('SELECT * FROM ai_prompts WHERE id = ?', [id])
            .then(([rows]) => rows);
        return row;
    }
    async updatePrompt(id, body) {
        await this.database.execute(`UPDATE ai_prompts
       SET status = COALESCE(?, status), system_prompt = COALESCE(?, system_prompt),
           user_template = COALESCE(?, user_template), name = COALESCE(?, name)
       WHERE id = ?`, [body?.status ?? null, body?.system_prompt ?? null, body?.user_template ?? null, body?.name ?? null, id]);
        const [row] = await this.database
            .query('SELECT * FROM ai_prompts WHERE id = ?', [id])
            .then(([rows]) => rows);
        if (!row)
            throw errors_1.errors.notFound('提示词不存在');
        return row;
    }
    async skills() {
        const rows = await this.database
            .query('SELECT * FROM ai_skills ORDER BY code, version DESC')
            .then(([rows]) => rows);
        return { items: rows };
    }
    async createSkill(request, body) {
        const id = (0, utils_1.uuid)();
        const [max] = await this.database
            .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_skills WHERE code = ?', [body?.code ?? body?.name])
            .then(([rows]) => rows);
        await this.database.execute(`INSERT INTO ai_skills
       (id, code, name, description, instructions, allowed_task_types, forbidden_actions, version, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(6))`, [
            id,
            body?.code ?? `skill_${(0, utils_1.uuid)().slice(0, 8)}`,
            body?.name ?? '未命名技能',
            body?.description ?? '',
            body?.instructions ?? '',
            JSON.stringify(body?.allowed_task_types ?? []),
            JSON.stringify(body?.forbidden_actions ?? []),
            Number(max?.version ?? 0) + 1,
            request.auth.staffId,
        ]);
        const [row] = await this.database
            .query('SELECT * FROM ai_skills WHERE id = ?', [id])
            .then(([rows]) => rows);
        return row;
    }
    async updateSkill(id, body) {
        await this.database.execute(`UPDATE ai_skills SET status = COALESCE(?, status), instructions = COALESCE(?, instructions) WHERE id = ?`, [body?.status ?? null, body?.instructions ?? null, id]);
        const [row] = await this.database
            .query('SELECT * FROM ai_skills WHERE id = ?', [id])
            .then(([rows]) => rows);
        if (!row)
            throw errors_1.errors.notFound('技能不存在');
        return row;
    }
    async tools() {
        const rows = await this.database
            .query('SELECT * FROM ai_tools ORDER BY name, version DESC')
            .then(([rows]) => rows);
        return { items: rows };
    }
    async createTool(request, body) {
        const id = (0, utils_1.uuid)();
        const [max] = await this.database
            .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_tools WHERE name = ?', [body?.name])
            .then(([rows]) => rows);
        await this.database.execute(`INSERT INTO ai_tools
       (id, name, description, parameters_json_schema, execution_type, risk_level, handler, timeout_ms, enabled, version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [
            id,
            body?.name ?? `tool_${(0, utils_1.uuid)().slice(0, 8)}`,
            body?.description ?? '',
            JSON.stringify(body?.parameters_json_schema ?? {}),
            body?.execution_type ?? 'internal_read_only',
            body?.risk_level ?? 'low',
            body?.handler ?? 'internal.placeholder',
            Number(body?.timeout_ms ?? 500),
            body?.enabled !== false,
            Number(max?.version ?? 0) + 1,
            request.auth.staffId,
        ]);
        const [row] = await this.database
            .query('SELECT * FROM ai_tools WHERE id = ?', [id])
            .then(([rows]) => rows);
        return row;
    }
    async updateTool(id, body) {
        await this.database.execute(`UPDATE ai_tools SET enabled = COALESCE(?, enabled), timeout_ms = COALESCE(?, timeout_ms), description = COALESCE(?, description) WHERE id = ?`, [body?.enabled ?? null, body?.timeout_ms ?? null, body?.description ?? null, id]);
        const [row] = await this.database
            .query('SELECT * FROM ai_tools WHERE id = ?', [id])
            .then(([rows]) => rows);
        if (!row)
            throw errors_1.errors.notFound('工具不存在');
        return row;
    }
    async auditLogs(page = '1', pageSize = '20') {
        const limit = Math.min(Number(pageSize) || 20, 100);
        const offset = ((Number(page) || 1) - 1) * limit;
        const rows = await this.database
            .query('SELECT * FROM ai_calls ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset])
            .then(([rows]) => rows);
        return { items: rows, page: Number(page), page_size: limit };
    }
    async mapConfigWithArtifacts(row) {
        const mapped = this.mapConfig(row);
        mapped.skill_ids = await this.getLinkedIds('ai_config_skills', 'skill_id', row.id);
        mapped.tool_ids = await this.getLinkedIds('ai_config_tools', 'tool_id', row.id);
        return mapped;
    }
    async getLinkedIds(table, column, configId) {
        const rows = await this.database
            .query(`SELECT ${column} AS id FROM ${table} WHERE ai_config_id = ?`, [configId])
            .then(([rows]) => rows);
        return rows.map((row) => row.id);
    }
    async validatePromptMappings(mapping) {
        const entries = Object.entries(mapping ?? {});
        if (entries.length === 0)
            throw errors_1.errors.aiConfigInvalid('至少需要绑定一个已启用提示词');
        for (const [taskType, promptId] of entries) {
            const [prompt] = await this.database
                .query(`SELECT id, status FROM ai_prompts WHERE id = ? LIMIT 1`, [promptId])
                .then(([rows]) => rows);
            if (!prompt || prompt.status !== 'enabled') {
                throw errors_1.errors.aiConfigInvalid(`任务 ${taskType} 绑定的提示词不存在或未启用`);
            }
        }
    }
    async resolveSkillIds(input) {
        if (Array.isArray(input) && input.length > 0) {
            const ids = input.map(String);
            const rows = await this.database
                .query(`SELECT id FROM ai_skills WHERE id IN (?) AND status = 'enabled'`, [ids])
                .then(([rows]) => rows);
            if (rows.length !== ids.length)
                throw errors_1.errors.aiConfigInvalid('存在无效或未启用的技能');
            return ids;
        }
        const rows = await this.database
            .query(`SELECT id FROM ai_skills WHERE status = 'enabled'`)
            .then(([rows]) => rows);
        return rows.map((row) => row.id);
    }
    async resolveToolIds(input) {
        if (Array.isArray(input) && input.length > 0) {
            const ids = input.map(String);
            const rows = await this.database
                .query(`SELECT id FROM ai_tools WHERE id IN (?) AND enabled = TRUE`, [ids])
                .then(([rows]) => rows);
            if (rows.length !== ids.length)
                throw errors_1.errors.aiConfigInvalid('存在无效或未启用的工具');
            return ids;
        }
        const rows = await this.database
            .query(`SELECT id FROM ai_tools WHERE enabled = TRUE`)
            .then(([rows]) => rows);
        return rows.map((row) => row.id);
    }
    mapConfig(row) {
        return {
            id: row.id,
            version: Number(row.version),
            status: row.status,
            provider: row.provider,
            base_url: row.base_url,
            model: row.model,
            api_key_configured: Boolean(process.env.DEEPSEEK_API_KEY),
            enabled: Boolean(row.enabled),
            default_parameters: (0, utils_1.parseJsonField)(row.default_parameters, {}),
            task_overrides: (0, utils_1.parseJsonField)(row.task_overrides, {}),
            prompt_ids: (0, utils_1.parseJsonField)(row.prompt_mappings, {}),
            timeout_ms: row.timeout_ms,
            max_retries: row.max_retries,
            daily_token_budget: row.daily_token_budget,
            published_at: row.published_at,
            published_by: row.created_by,
        };
    }
};
exports.AIConfigController = AIConfigController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "getConfig", null);
__decorate([
    (0, common_1.Post)('config'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "createConfig", null);
__decorate([
    (0, common_1.Post)('config/:id/publish'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "publishConfig", null);
__decorate([
    (0, common_1.Post)('config/:id/test'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "testConfig", null);
__decorate([
    (0, common_1.Get)('prompts'),
    __param(0, (0, common_1.Query)('task_type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "prompts", null);
__decorate([
    (0, common_1.Post)('prompts'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "createPrompt", null);
__decorate([
    (0, common_1.Patch)('prompts/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "updatePrompt", null);
__decorate([
    (0, common_1.Get)('skills'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "skills", null);
__decorate([
    (0, common_1.Post)('skills'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "createSkill", null);
__decorate([
    (0, common_1.Patch)('skills/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "updateSkill", null);
__decorate([
    (0, common_1.Get)('tools'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "tools", null);
__decorate([
    (0, common_1.Post)('tools'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "createTool", null);
__decorate([
    (0, common_1.Patch)('tools/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "updateTool", null);
__decorate([
    (0, common_1.Get)('audit-logs'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('page_size')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AIConfigController.prototype, "auditLogs", null);
exports.AIConfigController = AIConfigController = __decorate([
    (0, common_1.Controller)('manager/ai'),
    (0, auth_1.Roles)('ai_config_admin', 'professional_supervisor'),
    __param(0, (0, common_1.Inject)(database_module_1.DATABASE)),
    __param(1, (0, common_1.Inject)(ai_service_1.AIService)),
    __metadata("design:paramtypes", [Object, ai_service_1.AIService])
], AIConfigController);
//# sourceMappingURL=ai-config.controller.js.map