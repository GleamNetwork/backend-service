"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.randomToken = randomToken;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const node_crypto_1 = __importDefault(require("node:crypto"));
function sha256(value) {
    return node_crypto_1.default.createHash('sha256').update(value).digest('hex');
}
function randomToken(prefix = '') {
    return prefix + node_crypto_1.default.randomBytes(32).toString('base64url');
}
function hashPassword(password) {
    const salt = node_crypto_1.default.randomBytes(16).toString('hex');
    const derived = node_crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${derived}`;
}
function verifyPassword(password, stored) {
    const parts = stored.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt')
        return false;
    const [, salt, expected] = parts;
    const actual = node_crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return node_crypto_1.default.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
//# sourceMappingURL=security.js.map