import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { errors } from '../errors';
import { randomToken, sha256, verifyPassword } from '../security';
import { uuid } from '../utils';
import type { AuthContext, Role } from '../types';
import { EventService } from './event.service';

export interface SessionTokens {
  token: string;
  refresh_token: string;
  role: Role;
  expires_at: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly database: Pool,
    @Inject(EventService) private readonly events: EventService,
  ) {}

  async createUserSession(input: {
    ageBand: string;
    districtId: string;
    displayName?: string;
  }): Promise<{ token: string; refreshToken: string; user: Record<string, unknown>; expiresAt: Date }> {
    const allowedAgeBands = ['12-13', '14-17', '18+'];
    if (!allowedAgeBands.includes(input.ageBand)) {
      throw errors.validation('age_band 必须为 12-13、14-17 或 18+');
    }
    const userId = uuid();
    await this.database.execute(
      `INSERT INTO users (id, display_name, age_band, district_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [userId, input.displayName ?? '匿名用户', input.ageBand, input.districtId],
    );
    await this.seedDefaultConsents(userId);
    const token = randomToken('u_');
    const refresh = randomToken('r_');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await this.database.execute(
      `INSERT INTO sessions
       (id, user_id, role, access_token_hash, refresh_token_hash, created_at, expires_at)
       VALUES (?, ?, 'user', ?, ?, UTC_TIMESTAMP(6), ?)`,
      [uuid(), userId, sha256(token), sha256(refresh), expiresAt],
    );
    await this.events.publish({
      eventType: 'user.session.created',
      aggregateType: 'user',
      aggregateId: userId,
      audienceType: 'user',
      audienceId: userId,
      payload: { age_band: input.ageBand, district_id: input.districtId },
    });
    const [user] = await this.database
      .query('SELECT * FROM users WHERE id = ?', [userId])
      .then(([rows]) => rows as any[]);
    return { token, refreshToken: refresh, user, expiresAt };
  }

  async loginStaff(account: string, password: string): Promise<SessionTokens> {
    const [staff] = await this.database
      .query('SELECT * FROM staff_accounts WHERE username = ?', [account])
      .then(([rows]) => rows as any[]);
    if (!staff || !verifyPassword(password, staff.password_hash)) {
      throw errors.authRequired('账号或密码不正确');
    }
    if (staff.status !== 'active') throw errors.accountLocked('账号已暂停或资格失效');
    return this.createStaffSession(staff);
  }

  private async createStaffSession(staff: any): Promise<SessionTokens> {
    const token = randomToken('s_');
    const refresh = randomToken('r_');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await this.database.execute(
      `INSERT INTO sessions
       (id, staff_id, role, access_token_hash, refresh_token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
      [uuid(), staff.id, staff.role, sha256(token), sha256(refresh), expiresAt],
    );
    return { token, refresh_token: refresh, role: staff.role, expires_at: expiresAt.toISOString() };
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const [session] = await this.database
      .query(
        `SELECT s.* FROM sessions s
         WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL
         LIMIT 1`,
        [sha256(refreshToken)],
      )
      .then(([rows]) => rows as any[]);
    if (!session) throw errors.authRequired('Refresh Token 无效或已撤销');
    const token = randomToken(session.user_id ? 'u_' : 's_');
    const refresh = randomToken('r_');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await this.database.execute(
      `UPDATE sessions
       SET access_token_hash = ?, refresh_token_hash = ?, expires_at = ?, refreshed_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [sha256(token), sha256(refresh), expiresAt, session.id],
    );
    return { token, refresh_token: refresh, role: session.role, expires_at: expiresAt.toISOString() };
  }

  async logout(sessionId: string): Promise<void> {
    await this.database.execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE id = ?', [
      sessionId,
    ]);
  }

  async assertUser(auth: AuthContext | undefined): Promise<string> {
    if (!auth?.userId || auth.role !== 'user') throw errors.scopeDenied('需要用户身份');
    return auth.userId;
  }

  private async seedDefaultConsents(userId: string): Promise<void> {
    const rows = [
      'device_metrics',
      'activity_reminder',
      'trend_summary_share',
      'diary_share',
      'chat_share',
    ].map((type) => [uuid(), userId, type, false, JSON.stringify({})]);
    await this.database.query(
      `INSERT INTO consents (id, user_id, consent_type, granted, scope) VALUES ?`,
      [rows],
    );
  }
}
