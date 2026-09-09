"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uuid = uuid;
exports.now = now;
exports.iso = iso;
exports.hashRequest = hashRequest;
exports.parseJsonField = parseJsonField;
exports.requireString = requireString;
exports.asArray = asArray;
const node_crypto_1 = __importDefault(require("node:crypto"));
function uuid() {
    return node_crypto_1.default.randomUUID();
}
function now() {
    return new Date();
}
function iso(value) {
    if (!value)
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function hashRequest(value) {
    return node_crypto_1.default.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}
function parseJsonField(value, fallback) {
    if (value === null || value === undefined)
        return fallback;
    if (typeof value === 'object')
        return value;
    try {
        return JSON.parse(String(value));
    }
    catch {
        return fallback;
    }
}
function requireString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        const error = new Error(`${name} 不能为空`);
        error.details = { field: name };
        throw error;
    }
    return value.trim();
}
function asArray(value) {
    if (Array.isArray(value))
        return value.map((item) => String(item));
    if (typeof value === 'string' && value)
        return [value];
    return [];
}
//# sourceMappingURL=utils.js.map