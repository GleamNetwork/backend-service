"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errors = exports.AppError = void 0;
class AppError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
exports.errors = {
    validation: (message = '请求参数不合法', details) => new AppError(400, 'VALIDATION_ERROR', message, details),
    authRequired: (message = '请先登录或提供有效 Token') => new AppError(401, 'AUTH_REQUIRED', message),
    permissionDenied: (message = '当前角色没有权限执行此操作') => new AppError(403, 'PERMISSION_DENIED', message),
    scopeDenied: (message = '请求的数据超出授权范围') => new AppError(403, 'SCOPE_DENIED', message),
    notFound: (message = '对象不存在或不可见') => new AppError(404, 'NOT_FOUND', message),
    stateConflict: (message = '状态已变化，请刷新后重试') => new AppError(409, 'CASE_STATE_CONFLICT', message),
    transferSuperseded: (message = '专业接管后普通交接已失效') => new AppError(409, 'TRANSFER_SUPERSEDED', message),
    capacityExceeded: (message = '今日接待已达上限') => new AppError(422, 'CAPACITY_EXCEEDED', message),
    immediateSafetyRequired: (message = '即时安全请求需要专业支持，不能由普通志愿者单独承接') => new AppError(422, 'IMMEDIATE_SAFETY_REQUIRED', message),
    receiverCapacityExceeded: (message = '接班者已满额，不能确认交接') => new AppError(422, 'RECEIVER_CAPACITY_EXCEEDED', message),
    aiConfigInvalid: (message = 'AI 配置不合法或缺失') => new AppError(422, 'AI_CONFIG_INVALID', message),
    aiToolForbidden: (message = 'AI 请求调用未启用或未授权的工具') => new AppError(422, 'AI_TOOL_FORBIDDEN', message),
    accountLocked: (message = '账号已暂停或资格失效') => new AppError(423, 'ACCOUNT_LOCKED', message),
    rateLimited: (message = '请求频率过高') => new AppError(429, 'RATE_LIMITED', message),
    aiUnavailable: (message = 'AI 服务不可用，已保留人工流程') => new AppError(503, 'AI_UNAVAILABLE', message),
    aiProviderError: (message = 'AI 服务商返回错误') => new AppError(502, 'AI_PROVIDER_ERROR', message),
    resourceUnavailable: (message = '资源服务不可用，请使用人工渠道') => new AppError(503, 'RESOURCE_UNAVAILABLE', message),
};
//# sourceMappingURL=errors.js.map