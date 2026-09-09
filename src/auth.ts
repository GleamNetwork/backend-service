import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from './database.module';
import { errors } from './errors';
import { sha256 } from './security';
import type { AuthContext, Role } from './types';

export const IS_PUBLIC = 'tongpin:is-public';
export const REQUIRED_ROLES = 'tongpin:required-roles';

export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(IS_PUBLIC, true);
}

export function Roles(...roles: Role[]): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_ROLES, roles);
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    requestId?: string;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (this.reflector.get<boolean>(IS_PUBLIC, context.getHandler())) return true;

    const token = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw errors.authRequired();

    const [session] = await this.database
      .query(
        `SELECT id, user_id, staff_id, role, expires_at, revoked_at
         FROM sessions
         WHERE access_token_hash = ?
         LIMIT 1`,
        [sha256(token)],
      )
      .then(([rows]) => rows as any[]);

    if (!session || session.revoked_at) throw errors.authRequired();
    if (new Date(session.expires_at).getTime() <= Date.now()) throw errors.authRequired();

    let districtIds: string[] | undefined;
    if (session.staff_id) {
      const districts = await this.database
        .query('SELECT district_id FROM staff_districts WHERE staff_id = ?', [session.staff_id])
        .then(([rows]) => rows as any[]);
      districtIds = districts.map((row) => row.district_id);
    }

    request.auth = {
      sessionId: session.id,
      role: session.role,
      userId: session.user_id ?? undefined,
      staffId: session.staff_id ?? undefined,
      districtIds,
      expiresAt: new Date(session.expires_at),
    };

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && !requiredRoles.includes(request.auth.role)) {
      throw errors.permissionDenied();
    }
    return true;
  }
}
