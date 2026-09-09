import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import mysql from 'mysql2/promise';

export const TEST_DB_NAME = 'tongpin_b2_test';
export const TEST_PASSWORD = 'TongpinDemo2026!';

const rootEnvPath = path.resolve(__dirname, '../../../.env.local');
if (fs.existsSync(rootEnvPath)) {
  const content = fs.readFileSync(rootEnvPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]] = match[2];
  }
}

export function configureTestEnvironment(): void {
  process.env.DB_NAME = TEST_DB_NAME;
  process.env.DEEPSEEK_API_KEY = '';
  process.env.AI_ALLOW_MOCK = 'true';
  process.env.AI_ENABLED = 'true';
  process.env.PORT = '18080';
  process.env.CORS_ORIGINS = '*';
  process.env.EVENT_POLL_INTERVAL_MS = '100';
}

const tables = [
  'ai_config_tests',
  'ai_tool_executions',
  'ai_calls',
  'ai_config_tools',
  'ai_config_skills',
  'ai_provider_configs',
  'ai_tools',
  'ai_skills',
  'ai_prompts',
  'events',
  'idempotency_keys',
  'questionnaire_responses',
  'care_responses',
  'exercises',
  'resources',
  'support_reviews',
  'professional_requests',
  'transfer_requests',
  'capacity_events',
  'schedules',
  'staff_capacity',
  'staff_districts',
  'staff_accounts',
  'case_messages',
  'service_cases',
  'chat_messages',
  'metric_summaries',
  'device_metrics',
  'diary_shares',
  'diary_versions',
  'diary_entries',
  'consents',
  'sessions',
  'users',
  'audit_logs',
];

export async function resetTestDatabase(): Promise<void> {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB_NAME,
    multipleStatements: true,
  });

  const dropSql = `
    SET FOREIGN_KEY_CHECKS=0;
    ${tables.map((table) => `DROP TABLE IF EXISTS \`${table}\`;`).join('\n')}
    SET FOREIGN_KEY_CHECKS=1;
  `;
  await connection.query(dropSql);

  const schema = fs.readFileSync(path.resolve(process.cwd(), 'sql', 'schema.sql'), 'utf-8');
  await connection.query(schema);
  await connection.end();

  const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
  execFileSync(tsxBin, ['scripts/seed.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DB_NAME: TEST_DB_NAME, SEED_PASSWORD: TEST_PASSWORD },
    stdio: 'pipe',
  });
}

export function extractToken(response: { body: any }): string {
  if (!response.body?.token) {
    throw new Error(`No token in response: ${JSON.stringify(response.body)}`);
  }
  return response.body.token;
}
