"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
const node_path_1 = __importDefault(require("node:path"));
function readInt(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}
function readBool(name, fallback) {
    if (process.env[name] === undefined)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(process.env[name].toLowerCase());
}
const envPath = process.env.TONGPIN_ENV_FILE ?? node_path_1.default.resolve(process.cwd(), '.env');
if (!process.env.TONGPIN_ENV_LOADED) {
    // dotenv/config is loaded above; this marker supports test overrides.
    process.env.TONGPIN_ENV_LOADED = envPath;
}
exports.config = {
    port: readInt('PORT', 8080),
    basePath: process.env.BASE_PATH ?? '/api/v1',
    db: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: readInt('DB_PORT', 3306),
        user: process.env.DB_USER ?? 'tongpin_app',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? 'tongpin_b2',
        connectionLimit: readInt('DB_CONNECTION_LIMIT', 20),
        connectTimeout: readInt('DB_CONNECT_TIMEOUT_MS', 5000),
    },
    corsOrigins: (process.env.CORS_ORIGINS ?? '*')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ai: {
        enabled: readBool('AI_ENABLED', true),
        allowMock: readBool('AI_ALLOW_MOCK', true),
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        timeoutMs: readInt('AI_TIMEOUT_MS', 2000),
        maxRetries: readInt('AI_MAX_RETRIES', 1),
        dailyTokenBudget: readInt('AI_DAILY_TOKEN_BUDGET', 200000),
    },
    eventPollIntervalMs: readInt('EVENT_POLL_INTERVAL_MS', 500),
};
//# sourceMappingURL=config.js.map