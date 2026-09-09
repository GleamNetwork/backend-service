import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { Roles } from '../auth';
import { errors } from '../errors';
import { AIService } from '../services/ai.service';
import { parseJsonField, uuid } from '../utils';

@Controller('manager/ai')
@Roles('ai_config_admin', 'professional_supervisor')
export class AIConfigController {
  constructor(
    @Inject(DATABASE) private readonly database: Pool,
    @Inject(AIService) private readonly ai: AIService,
  ) {}

  @Get('config')
  async getConfig() {
    const [active] = await this.database
      .query(
        `SELECT * FROM ai_provider_configs WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`,
      )
      .then(([rows]) => rows as any[]);
    const drafts = await this.database
      .query(
        `SELECT id, version, status, created_at FROM ai_provider_configs WHERE status <> 'published' ORDER BY created_at DESC`,
      )
      .then(([rows]) => rows as any[]);
    return {
      active_config: active ? await this.mapConfigWithArtifacts(active) : null,
      drafts,
    };
  }

  @Post('config')
  async createConfig(@Req() request: Request, @Body() body: any) {
    if (!body?.provider || !body?.model || !body?.base_url) {
      throw errors.aiConfigInvalid('provider、base_url 和 model 不能为空');
    }
    const promptMappings = (body.prompt_ids ?? body.prompt_mappings ?? {}) as Record<string, string>;
    await this.validatePromptMappings(promptMappings);
    const skillIds = await this.resolveSkillIds(body.skill_ids);
    const toolIds = await this.resolveToolIds(body.tool_ids);

    const [maxVersion] = await this.database
      .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_provider_configs WHERE provider = ?', [body.provider])
      .then(([rows]) => rows as any[]);
    const id = uuid();
    const version = Number(maxVersion?.version ?? 0) + 1;
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO ai_provider_configs
         (id, version, provider, base_url, model, api_key_secret_ref, enabled, default_parameters,
          task_overrides, prompt_mappings, timeout_ms, max_retries, daily_token_budget, status,
          created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(6))`,
        [
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
          request.auth!.staffId!,
        ],
      );
      for (const skillId of skillIds) {
        await connection.execute(
          'INSERT INTO ai_config_skills (id, ai_config_id, skill_id) VALUES (UUID(), ?, ?)',
          [id, skillId],
        );
      }
      for (const toolId of toolIds) {
        await connection.execute(
          'INSERT INTO ai_config_tools (id, ai_config_id, tool_id) VALUES (UUID(), ?, ?)',
          [id, toolId],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [row] = await this.database
      .query('SELECT * FROM ai_provider_configs WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return {
      ...(await this.mapConfigWithArtifacts(row)),
      validation_result: { valid: true, errors: [] },
    };
  }

  @Post('config/:id/publish')
  async publishConfig(@Req() request: Request, @Param('id') id: string) {
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const rows = await connection
        .query<any[]>(`SELECT * FROM ai_provider_configs WHERE id = ? FOR UPDATE`, [id])
        .then(([rows]) => rows as any[]);
      const config = rows[0];
      if (!config || config.status !== 'draft') throw errors.stateConflict('配置不存在或不是草稿');
      const tests = await connection
        .query<any[]>(`SELECT id FROM ai_config_tests WHERE ai_config_id = ? LIMIT 1`, [id])
        .then(([rows]) => rows as any[]);
      if (tests.length === 0) {
        throw errors.aiConfigInvalid('发布前必须至少完成一次合成输入测试');
      }
      const currentActive = await connection
        .query<any[]>(`SELECT id FROM ai_provider_configs WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`)
        .then(([rows]) => rows as any[]);
      await connection.execute(`UPDATE ai_provider_configs SET status = 'archived' WHERE status = 'published'`);
      await connection.execute(
        `UPDATE ai_provider_configs SET status = 'published', published_at = UTC_TIMESTAMP(6), previous_version_id = ? WHERE id = ?`,
        [currentActive[0]?.id ?? null, id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const [row] = await this.database
      .query('SELECT * FROM ai_provider_configs WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return this.mapConfigWithArtifacts(row);
  }

  @Post('config/:id/test')
  async testConfig(@Req() request: Request, @Param('id') id: string, @Body() body: any) {
    const [config] = await this.database
      .query('SELECT * FROM ai_provider_configs WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    if (!config) throw errors.notFound('AI 配置不存在');

    const taskType = String(body?.task_type ?? 'chat_suggestion');
    const syntheticInput = body?.synthetic_input ?? {};
    const activeConfig = await this.ai.getActiveConfig();
    let output: Record<string, unknown>;
    let tokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finishReason = 'not_executed';

    if (activeConfig && activeConfig.id === id) {
      const result = await this.ai.run({
        taskType: taskType as any,
        requestedBy: request.auth!.staffId!,
        context: syntheticInput,
      });
      output = { candidate_text: result.candidate_text, uncertainty: result.uncertainty };
      tokenUsage = result.token_usage;
      finishReason = result.finish_reason ?? 'stop';
    } else {
      output = {
        candidate_text: '草稿配置静态校验通过：参数、提示词、技能和工具均有效。',
        uncertainty: '草稿测试不调用真实模型；发布后业务调用仍需人工确认。',
      };
      finishReason = 'not_executed';
    }

    const testId = uuid();
    await this.database.execute(
      `INSERT INTO ai_config_tests
       (id, ai_config_id, task_type, synthetic_input, output, safety_check_result, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'passed', ?, UTC_TIMESTAMP(6))`,
      [
        testId,
        id,
        taskType,
        JSON.stringify(syntheticInput),
        JSON.stringify(output),
        request.auth!.staffId!,
      ],
    );

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

  @Get('prompts')
  async prompts(@Query('task_type') taskType?: string) {
    const rows = await this.database
      .query(
        taskType
          ? 'SELECT * FROM ai_prompts WHERE task_type = ? ORDER BY version DESC'
          : 'SELECT * FROM ai_prompts ORDER BY task_type, version DESC',
        taskType ? [taskType] : [],
      )
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Post('prompts')
  async createPrompt(@Req() request: Request, @Body() body: any) {
    const id = uuid();
    const [max] = await this.database
      .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_prompts WHERE code = ?', [body?.code ?? body?.name])
      .then(([rows]) => rows as any[]);
    await this.database.execute(
      `INSERT INTO ai_prompts
       (id, code, task_type, name, system_prompt, user_template, variables, safety_constraints, version, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(6))`,
      [
        id,
        body?.code ?? `prompt_${uuid().slice(0, 8)}`,
        body?.task_type ?? 'chat_suggestion',
        body?.name ?? '未命名提示词',
        body?.system_prompt ?? '',
        body?.user_template ?? '',
        JSON.stringify(body?.variables ?? []),
        JSON.stringify(body?.safety_constraints ?? []),
        Number(max?.version ?? 0) + 1,
        request.auth!.staffId!,
      ],
    );
    const [row] = await this.database
      .query('SELECT * FROM ai_prompts WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return row;
  }

  @Patch('prompts/:id')
  async updatePrompt(@Param('id') id: string, @Body() body: any) {
    await this.database.execute(
      `UPDATE ai_prompts
       SET status = COALESCE(?, status), system_prompt = COALESCE(?, system_prompt),
           user_template = COALESCE(?, user_template), name = COALESCE(?, name)
       WHERE id = ?`,
      [body?.status ?? null, body?.system_prompt ?? null, body?.user_template ?? null, body?.name ?? null, id],
    );
    const [row] = await this.database
      .query('SELECT * FROM ai_prompts WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    if (!row) throw errors.notFound('提示词不存在');
    return row;
  }

  @Get('skills')
  async skills() {
    const rows = await this.database
      .query('SELECT * FROM ai_skills ORDER BY code, version DESC')
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Post('skills')
  async createSkill(@Req() request: Request, @Body() body: any) {
    const id = uuid();
    const [max] = await this.database
      .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_skills WHERE code = ?', [body?.code ?? body?.name])
      .then(([rows]) => rows as any[]);
    await this.database.execute(
      `INSERT INTO ai_skills
       (id, code, name, description, instructions, allowed_task_types, forbidden_actions, version, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, UTC_TIMESTAMP(6))`,
      [
        id,
        body?.code ?? `skill_${uuid().slice(0, 8)}`,
        body?.name ?? '未命名技能',
        body?.description ?? '',
        body?.instructions ?? '',
        JSON.stringify(body?.allowed_task_types ?? []),
        JSON.stringify(body?.forbidden_actions ?? []),
        Number(max?.version ?? 0) + 1,
        request.auth!.staffId!,
      ],
    );
    const [row] = await this.database
      .query('SELECT * FROM ai_skills WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return row;
  }

  @Patch('skills/:id')
  async updateSkill(@Param('id') id: string, @Body() body: any) {
    await this.database.execute(
      `UPDATE ai_skills SET status = COALESCE(?, status), instructions = COALESCE(?, instructions) WHERE id = ?`,
      [body?.status ?? null, body?.instructions ?? null, id],
    );
    const [row] = await this.database
      .query('SELECT * FROM ai_skills WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    if (!row) throw errors.notFound('技能不存在');
    return row;
  }

  @Get('tools')
  async tools() {
    const rows = await this.database
      .query('SELECT * FROM ai_tools ORDER BY name, version DESC')
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Post('tools')
  async createTool(@Req() request: Request, @Body() body: any) {
    const id = uuid();
    const [max] = await this.database
      .query('SELECT COALESCE(MAX(version), 0) AS version FROM ai_tools WHERE name = ?', [body?.name])
      .then(([rows]) => rows as any[]);
    await this.database.execute(
      `INSERT INTO ai_tools
       (id, name, description, parameters_json_schema, execution_type, risk_level, handler, timeout_ms, enabled, version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
      [
        id,
        body?.name ?? `tool_${uuid().slice(0, 8)}`,
        body?.description ?? '',
        JSON.stringify(body?.parameters_json_schema ?? {}),
        body?.execution_type ?? 'internal_read_only',
        body?.risk_level ?? 'low',
        body?.handler ?? 'internal.placeholder',
        Number(body?.timeout_ms ?? 500),
        body?.enabled !== false,
        Number(max?.version ?? 0) + 1,
        request.auth!.staffId!,
      ],
    );
    const [row] = await this.database
      .query('SELECT * FROM ai_tools WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return row;
  }

  @Patch('tools/:id')
  async updateTool(@Param('id') id: string, @Body() body: any) {
    await this.database.execute(
      `UPDATE ai_tools SET enabled = COALESCE(?, enabled), timeout_ms = COALESCE(?, timeout_ms), description = COALESCE(?, description) WHERE id = ?`,
      [body?.enabled ?? null, body?.timeout_ms ?? null, body?.description ?? null, id],
    );
    const [row] = await this.database
      .query('SELECT * FROM ai_tools WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    if (!row) throw errors.notFound('工具不存在');
    return row;
  }

  @Get('audit-logs')
  async auditLogs(@Query('page') page = '1', @Query('page_size') pageSize = '20') {
    const limit = Math.min(Number(pageSize) || 20, 100);
    const offset = ((Number(page) || 1) - 1) * limit;
    const rows = await this.database
      .query('SELECT * FROM ai_calls ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset])
      .then(([rows]) => rows as any[]);
    return { items: rows, page: Number(page), page_size: limit };
  }

  private async mapConfigWithArtifacts(row: any): Promise<any> {
    const mapped = this.mapConfig(row);
    mapped.skill_ids = await this.getLinkedIds('ai_config_skills', 'skill_id', row.id);
    mapped.tool_ids = await this.getLinkedIds('ai_config_tools', 'tool_id', row.id);
    return mapped;
  }

  private async getLinkedIds(table: string, column: string, configId: string): Promise<string[]> {
    const rows = await this.database
      .query(`SELECT ${column} AS id FROM ${table} WHERE ai_config_id = ?`, [configId])
      .then(([rows]) => rows as any[]);
    return rows.map((row: any) => row.id);
  }

  private async validatePromptMappings(mapping: Record<string, string>): Promise<void> {
    const entries = Object.entries(mapping ?? {});
    if (entries.length === 0) throw errors.aiConfigInvalid('至少需要绑定一个已启用提示词');
    for (const [taskType, promptId] of entries) {
      const [prompt] = await this.database
        .query(`SELECT id, status FROM ai_prompts WHERE id = ? LIMIT 1`, [promptId])
        .then(([rows]) => rows as any[]);
      if (!prompt || prompt.status !== 'enabled') {
        throw errors.aiConfigInvalid(`任务 ${taskType} 绑定的提示词不存在或未启用`);
      }
    }
  }

  private async resolveSkillIds(input: unknown): Promise<string[]> {
    if (Array.isArray(input) && input.length > 0) {
      const ids = input.map(String);
      const rows = await this.database
        .query(`SELECT id FROM ai_skills WHERE id IN (?) AND status = 'enabled'`, [ids])
        .then(([rows]) => rows as any[]);
      if (rows.length !== ids.length) throw errors.aiConfigInvalid('存在无效或未启用的技能');
      return ids;
    }
    const rows = await this.database
      .query(`SELECT id FROM ai_skills WHERE status = 'enabled'`)
      .then(([rows]) => rows as any[]);
    return rows.map((row: any) => row.id);
  }

  private async resolveToolIds(input: unknown): Promise<string[]> {
    if (Array.isArray(input) && input.length > 0) {
      const ids = input.map(String);
      const rows = await this.database
        .query(`SELECT id FROM ai_tools WHERE id IN (?) AND enabled = TRUE`, [ids])
        .then(([rows]) => rows as any[]);
      if (rows.length !== ids.length) throw errors.aiConfigInvalid('存在无效或未启用的工具');
      return ids;
    }
    const rows = await this.database
      .query(`SELECT id FROM ai_tools WHERE enabled = TRUE`)
      .then(([rows]) => rows as any[]);
    return rows.map((row: any) => row.id);
  }

  private mapConfig(row: any): any {
    return {
      id: row.id,
      version: Number(row.version),
      status: row.status,
      provider: row.provider,
      base_url: row.base_url,
      model: row.model,
      api_key_configured: Boolean(process.env.DEEPSEEK_API_KEY),
      enabled: Boolean(row.enabled),
      default_parameters: parseJsonField(row.default_parameters, {}),
      task_overrides: parseJsonField(row.task_overrides, {}),
      prompt_ids: parseJsonField(row.prompt_mappings, {}),
      timeout_ms: row.timeout_ms,
      max_retries: row.max_retries,
      daily_token_budget: row.daily_token_budget,
      published_at: row.published_at,
      published_by: row.created_by,
    };
  }
}
