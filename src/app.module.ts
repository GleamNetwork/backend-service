import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './auth';
import { AuditInterceptor, IdempotencyInterceptor, RequestContextInterceptor } from './app.interceptor';
import { AppExceptionFilter } from './app.filter';
import { DatabaseModule } from './database.module';
import { AuthController } from './controllers/auth.controller';
import { UserController } from './controllers/user.controller';
import { VolunteerController } from './controllers/volunteer.controller';
import { ManagerController } from './controllers/manager.controller';
import { AIController } from './controllers/ai.controller';
import { AIConfigController } from './controllers/ai-config.controller';
import { ResourceController } from './controllers/resource.controller';
import { EventController } from './controllers/event.controller';
import { HealthController } from './controllers/health.controller';
import { AuthService } from './services/auth.service';
import { AuditService } from './services/audit.service';
import { AIService } from './services/ai.service';
import { CaseService } from './services/case.service';
import { EventService } from './services/event.service';

@Module({
  imports: [DatabaseModule],
  controllers: [
    AuthController,
    UserController,
    VolunteerController,
    ManagerController,
    AIController,
    AIConfigController,
    ResourceController,
    EventController,
    HealthController,
  ],
  providers: [
    AuthService,
    AuditService,
    AIService,
    CaseService,
    EventService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
