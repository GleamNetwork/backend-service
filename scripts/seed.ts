import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

function uuid(): string {
  return crypto.randomUUID();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? 'TongpinDemo2026!';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'tongpin_b2',
  });

  const staff = [
    { id: '11111111-1111-4111-8111-111111111111', username: 'volunteer.lin', name: '林然', role: 'volunteer' },
    { id: '55555555-5555-4555-8555-555555555555', username: 'volunteer.zhou', name: '周宁', role: 'volunteer' },
    { id: '22222222-2222-4222-8222-222222222222', username: 'manager.xu', name: '许安', role: 'duty_manager' },
    { id: '33333333-3333-4333-8333-333333333333', username: 'supervisor.chen', name: '陈澄', role: 'professional_supervisor' },
    { id: '44444444-4444-4444-8444-444444444444', username: 'ai.admin', name: 'AI配置管理员', role: 'ai_config_admin' },
  ];
  for (const person of staff) {
    await connection.execute(
      `INSERT INTO staff_accounts
       (id, username, display_name, role, status, daily_limit, concurrent_limit, self_check_passed_at, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 6, 2, UTC_TIMESTAMP(6), ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), role = VALUES(role), password_hash = VALUES(password_hash), updated_at = UTC_TIMESTAMP(6)`,
      [person.id, person.username, person.name, person.role, hashPassword(password)],
    );
    await connection.execute(
      'INSERT IGNORE INTO staff_districts (id, staff_id, district_id) VALUES (?, ?, ?)',
      [uuid(), person.id, 'district_shanghai_a'],
    );
  }

  const resources = [
    { id: 'aaaaaaa1-0000-4000-8000-000000000001', name: '医疗急救 120', category: 'medical_emergency', region: 'china', phone: '120', source: '国家急救电话' },
    { id: 'aaaaaaa1-0000-4000-8000-000000000002', name: '公共安全求助 110', category: 'public_safety', region: 'china', phone: '110', source: '公共安全报警电话' },
    { id: 'aaaaaaa1-0000-4000-8000-000000000003', name: '上海心理援助热线 12356 / 962525', category: 'mental_hotline', region: 'shanghai', phone: '12356', source: '上海市政府公开信息' },
  ];
  for (const resource of resources) {
    await connection.execute(
      `INSERT INTO resources
       (id, name, category, region, contact, service_time, service_target, fee_info, official_source,
        verified_at, verified_by, status, limitations, fallback_resource_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, UTC_TIMESTAMP(6), '44444444-4444-4444-8444-444444444444', 'verified', NULL, NULL)
       ON DUPLICATE KEY UPDATE name = VALUES(name), contact = VALUES(contact), verified_at = UTC_TIMESTAMP(6), status = 'verified'`,
      [resource.id, resource.name, resource.category, resource.region, JSON.stringify({ phone: resource.phone }), JSON.stringify({ available_time: '24h' }), resource.source],
    );
  }

  const promptId = 'bbbbbbb1-0000-4000-8000-000000000001';
  await connection.execute(
    `INSERT INTO ai_prompts
     (id, code, task_type, name, system_prompt, user_template, variables, safety_constraints, version, status, created_by, created_at)
     VALUES (?, 'chat_suggestion_base', 'chat_suggestion', '倾听建议提示词',
             '你是同频的倾听辅助助手。你不能诊断，不能建议用药，不能承诺识别所有危机。输出合法 JSON。',
             '当前诉求：{{main_request}}；当前安全：{{current_safety}}。请生成一条低压力、非评判的候选回复。',
             ?, ?, 1, 'enabled', '44444444-4444-4444-8444-444444444444', UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE status = 'enabled'`,
    [promptId, JSON.stringify(['main_request', 'current_safety']), JSON.stringify(['no_diagnosis', 'no_medication_advice', 'requires_human_confirmation'])],
  );

  const skillRows = [
    {
      id: 'ddddddd1-0000-4000-8000-000000000001',
      code: 'empathetic_listening',
      name: '共情倾听',
      description: '生成低压力、非评判的倾听候选回应。',
      instructions: '优先确认用户当前需要，不强迫解释原因，不使用诊断标签。',
      forbidden: ['diagnosis', 'medication_advice', 'promise_no_risk'],
    },
    {
      id: 'ddddddd1-0000-4000-8000-000000000002',
      code: 'safety_gate',
      name: '安全闸门',
      description: '识别需要立即转人工或现实求助的情境。',
      instructions: '只要出现当前不安全、身体急症或迫近危险，输出需要人工专业支持的提示，不给自助建议。',
      forbidden: ['diagnosis', 'external_call', 'notify_contact'],
    },
    {
      id: 'ddddddd1-0000-4000-8000-000000000003',
      code: 'resource_grounding',
      name: '资源接地',
      description: '只引用已核验资源，不编造机构或号码。',
      instructions: '资源信息必须来自工具返回或已核验资源库，并保留人工确认要求。',
      forbidden: ['invent_resource', 'auto_external_referral'],
    },
  ];
  for (const skill of skillRows) {
    await connection.execute(
      `INSERT INTO ai_skills
       (id, code, name, description, instructions, allowed_task_types, forbidden_actions, version, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'enabled', '44444444-4444-4444-8444-444444444444', UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE status = 'enabled', instructions = VALUES(instructions)`,
      [
        skill.id,
        skill.code,
        skill.name,
        skill.description,
        skill.instructions,
        JSON.stringify(['chat_suggestion', 'diary_draft', 'transfer_summary', 'resource_recommendation', 'safety_check']),
        JSON.stringify(skill.forbidden),
      ],
    );
  }

  const toolRows = [
    {
      id: 'eeeeeee1-0000-4000-8000-000000000001',
      name: 'search_verified_resources',
      description: '从已核验资源库检索热线、医院或社区支持资源。',
      handler: 'internal.search_verified_resources',
      risk: 'low',
    },
    {
      id: 'eeeeeee1-0000-4000-8000-000000000002',
      name: 'get_case_summary',
      description: '读取当前授权工单的最小必要摘要。',
      handler: 'internal.get_case_summary',
      risk: 'medium',
    },
  ];
  for (const tool of toolRows) {
    await connection.execute(
      `INSERT INTO ai_tools
       (id, name, description, parameters_json_schema, execution_type, risk_level, handler, timeout_ms, enabled, version, created_by, created_at)
       VALUES (?, ?, ?, ?, 'internal_read_only', ?, ?, 500, TRUE, 1, '44444444-4444-4444-8444-444444444444', UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE enabled = TRUE, description = VALUES(description)`,
      [
        tool.id,
        tool.name,
        tool.description,
        JSON.stringify({
          type: 'object',
          properties: {
            region: { type: 'string' },
            category: { type: 'string' },
          },
          required: [],
          additionalProperties: false,
        }),
        tool.risk,
        tool.handler,
      ],
    );
  }

  const configId = 'ccccccc1-0000-4000-8000-000000000001';
  await connection.execute(
    `INSERT INTO ai_provider_configs
     (id, version, provider, base_url, model, api_key_secret_ref, enabled, default_parameters,
      task_overrides, prompt_mappings, timeout_ms, max_retries, daily_token_budget, status,
      created_by, created_at, published_at)
     VALUES (?, 1, 'deepseek', 'https://api.deepseek.com', 'deepseek-v4-flash', 'deepseek_default', TRUE,
             ?, ?, ?, 2000, 1, 200000, 'published',
             '44444444-4444-4444-8444-444444444444', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE status = 'published', enabled = TRUE, published_at = UTC_TIMESTAMP(6)`,
    [
      configId,
      JSON.stringify({ thinking: { type: 'disabled' }, reasoning_effort: 'low', max_tokens: 800, temperature: 0.2, top_p: 0.9, response_format: { type: 'json_object' }, stream: false }),
      JSON.stringify({}),
      JSON.stringify({ chat_suggestion: promptId, diary_draft: promptId, transfer_summary: promptId }),
    ],
  );

  for (const skill of skillRows) {
    await connection.execute(
      'INSERT IGNORE INTO ai_config_skills (id, ai_config_id, skill_id) VALUES (UUID(), ?, ?)',
      [configId, skill.id],
    );
  }
  for (const tool of toolRows) {
    await connection.execute(
      'INSERT IGNORE INTO ai_config_tools (id, ai_config_id, tool_id) VALUES (UUID(), ?, ?)',
      [configId, tool.id],
    );
  }

  await connection.end();
  console.log('Seed data created successfully.');
  console.log(`Staff password: ${password}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
