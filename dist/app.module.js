"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const auth_1 = require("./auth");
const app_interceptor_1 = require("./app.interceptor");
const app_filter_1 = require("./app.filter");
const database_module_1 = require("./database.module");
const auth_controller_1 = require("./controllers/auth.controller");
const user_controller_1 = require("./controllers/user.controller");
const volunteer_controller_1 = require("./controllers/volunteer.controller");
const manager_controller_1 = require("./controllers/manager.controller");
const ai_controller_1 = require("./controllers/ai.controller");
const ai_config_controller_1 = require("./controllers/ai-config.controller");
const resource_controller_1 = require("./controllers/resource.controller");
const event_controller_1 = require("./controllers/event.controller");
const health_controller_1 = require("./controllers/health.controller");
const auth_service_1 = require("./services/auth.service");
const audit_service_1 = require("./services/audit.service");
const ai_service_1 = require("./services/ai.service");
const case_service_1 = require("./services/case.service");
const event_service_1 = require("./services/event.service");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [database_module_1.DatabaseModule],
        controllers: [
            auth_controller_1.AuthController,
            user_controller_1.UserController,
            volunteer_controller_1.VolunteerController,
            manager_controller_1.ManagerController,
            ai_controller_1.AIController,
            ai_config_controller_1.AIConfigController,
            resource_controller_1.ResourceController,
            event_controller_1.EventController,
            health_controller_1.HealthController,
        ],
        providers: [
            auth_service_1.AuthService,
            audit_service_1.AuditService,
            ai_service_1.AIService,
            case_service_1.CaseService,
            event_service_1.EventService,
            { provide: core_1.APP_GUARD, useClass: auth_1.AuthGuard },
            { provide: core_1.APP_FILTER, useClass: app_filter_1.AppExceptionFilter },
            { provide: core_1.APP_INTERCEPTOR, useClass: app_interceptor_1.RequestContextInterceptor },
            { provide: core_1.APP_INTERCEPTOR, useClass: app_interceptor_1.IdempotencyInterceptor },
            { provide: core_1.APP_INTERCEPTOR, useClass: app_interceptor_1.AuditInterceptor },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map