"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("./errors");
let AppExceptionFilter = class AppExceptionFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        if (exception instanceof errors_1.AppError) {
            response.status(exception.status).json({
                error: {
                    code: exception.code,
                    message: exception.message,
                    request_id: request.requestId,
                    details: exception.details,
                },
            });
            return;
        }
        if (exception instanceof common_1.HttpException) {
            const status = exception.getStatus();
            const body = exception.getResponse();
            response.status(status).json({
                error: {
                    code: status === common_1.HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
                    message: typeof body === 'string'
                        ? body
                        : (body.message ?? exception.message),
                    request_id: request.requestId,
                    details: typeof body === 'object' ? body : undefined,
                },
            });
            return;
        }
        const message = exception instanceof Error ? exception.message : '服务器内部错误';
        console.error('[unhandled]', exception);
        response.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message,
                request_id: request.requestId,
            },
        });
    }
};
exports.AppExceptionFilter = AppExceptionFilter;
exports.AppExceptionFilter = AppExceptionFilter = __decorate([
    (0, common_1.Catch)()
], AppExceptionFilter);
//# sourceMappingURL=app.filter.js.map