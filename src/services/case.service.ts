import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { errors } from '../errors';
import { parseJsonField, uuid } from '../utils';
import type { AuthContext } from '../types';
import { EventService } from './event.service';

export interface CreateCaseInput {
  userId: string;
  districtId: string;
  requestType: string;
  consentScope: string[];
  preferredContact?: string;
  immediateSafety: boolean;
  responsePath?: string;
  supportNeedLevel?: string;
}

@Injectable()
export class CaseService {
  constructor(
    @Inject(DATABASE) private readonly database: Pool,
    @Inject(EventService) private readonly events: EventService,
  ) {}

  async createCase(input: CreateCaseInput): Promise<any> {
    const caseId = uuid();
    const responsePath = input.immediateSafety ? 'R0' : (input.responsePath ?? 'R3');
    const supportNeed = input.immediateSafety
      ? 'immediate_safety'
      : (input.supportNeedLevel ?? 'unverified');
    await this.database.execute(
      `INSERT INTO service_cases
       (id, user_id, district_id, support_need_level, service_progress, response_path, status,
        consent_scope, request_type, preferred_contact, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'waiting_support', ?, 'waiting_assignment', ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        caseId,
        input.userId,
        input.districtId,
        supportNeed,
        responsePath,
        JSON.stringify(input.consentScope),
        input.requestType,
        input.preferredContact ?? 'text',
      ],
    );
    await this.events.publish({
      eventType: 'case.created',
      aggregateType: 'case',
      aggregateId: caseId,
      audienceType: 'district',
      audienceId: input.districtId,
      payload: { response_path: responsePath, immediate_safety: input.immediateSafety },
    });
    return this.getCase(caseId);
  }

  async getCase(caseId: string): Promise<any> {
    const [row] = await this.database
      .query('SELECT * FROM service_cases WHERE id = ?', [caseId])
      .then(([rows]) => rows as any[]);
    if (!row) throw errors.notFound('支援请求不存在');
    return this.mapCase(row);
  }

  async acceptCase(caseId: string, staffId: string, districtIds: string[]): Promise<any> {
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const [cases] = await connection.query<any[]>(
        `SELECT * FROM service_cases
         WHERE id = ? AND status = 'waiting_assignment'
         FOR UPDATE`,
        [caseId],
      );
      const row = cases[0];
      if (!row) throw errors.stateConflict('工单不存在、已被承接或状态已变化');
      if (!districtIds.includes(row.district_id)) throw errors.scopeDenied('工单不在当前授权辖区');
      if (row.support_need_level === 'immediate_safety') {
        throw errors.immediateSafetyRequired();
      }

      const [staffRows] = await connection.query<any[]>(
        'SELECT * FROM staff_accounts WHERE id = ? FOR UPDATE',
        [staffId],
      );
      const staff = staffRows[0];
      if (!staff || staff.status !== 'active') throw errors.accountLocked('志愿者不可用');
      if (!staff.self_check_passed_at) throw errors.stateConflict('志愿者尚未完成自检');

      const serviceDate = new Date().toISOString().slice(0, 10);
      const [capacityRows] = await connection.query<any[]>(
        `SELECT * FROM staff_capacity
         WHERE staff_id = ? AND service_date = ? FOR UPDATE`,
        [staffId, serviceDate],
      );
      let capacity = capacityRows[0];
      if (!capacity) {
        await connection.execute(
          `INSERT INTO staff_capacity (id, staff_id, service_date, daily_count, concurrent_count, updated_at)
           VALUES (?, ?, ?, 0, 0, UTC_TIMESTAMP(6))`,
          [uuid(), staffId, serviceDate],
        );
        capacity = { daily_count: 0, concurrent_count: 0 };
      }
      if (capacity.daily_count >= staff.daily_limit) {
        throw errors.capacityExceeded('今日接待已达上限，请申请调配人手');
      }
      if (capacity.concurrent_count >= staff.concurrent_limit) {
        throw errors.capacityExceeded('同时陪伴已满，请先完成或交接当前服务');
      }

      await connection.execute(
        `UPDATE service_cases
         SET assigned_volunteer_id = ?, owner_type = 'staff', owner_id = ?,
             status = 'in_progress', service_progress = 'in_progress',
             version = version + 1, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'waiting_assignment'`,
        [staffId, staffId, caseId],
      );
      await connection.execute(
        `UPDATE staff_capacity
         SET daily_count = daily_count + 1, concurrent_count = concurrent_count + 1, updated_at = UTC_TIMESTAMP(6)
         WHERE staff_id = ? AND service_date = ?`,
        [staffId, serviceDate],
      );
      await connection.execute(
        `INSERT INTO capacity_events
         (id, staff_id, case_id, event_type, daily_count_after, concurrent_count_after, occurred_at)
         VALUES (?, ?, ?, 'accept', ?, ?, UTC_TIMESTAMP(6))`,
        [uuid(), staffId, caseId, capacity.daily_count + 1, capacity.concurrent_count + 1],
      );
      const eventId = await this.events.publish({
        eventType: 'case.assigned',
        aggregateType: 'case',
        aggregateId: caseId,
        audienceType: 'district',
        audienceId: row.district_id,
        payload: { staff_id: staffId },
        connection,
      });
      await connection.commit();
      return { event_id: eventId, ...(await this.getCase(caseId)) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async closeCase(caseId: string, staffId: string): Promise<any> {
    const [result] = await this.database.execute<ResultSetHeader>(
      `UPDATE service_cases
       SET status = 'completed', service_progress = 'completed', closed_at = UTC_TIMESTAMP(6),
           version = version + 1, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND assigned_volunteer_id = ? AND status = 'in_progress'`,
      [caseId, staffId],
    );
    if (result.affectedRows === 0) throw errors.stateConflict('仅当前承接者可以结束进行中的服务');
    await this.database.execute(
      `UPDATE staff_capacity
       SET concurrent_count = GREATEST(concurrent_count - 1, 0), updated_at = UTC_TIMESTAMP(6)
       WHERE staff_id = ? AND service_date = UTC_DATE()`,
      [staffId],
    );
    const row = await this.getCase(caseId);
    await this.events.publish({
      eventType: 'case.closed',
      aggregateType: 'case',
      aggregateId: caseId,
      audienceType: 'district',
      audienceId: row.district_id,
    });
    return row;
  }

  async assertCaseAccess(caseId: string, auth: AuthContext): Promise<any> {
    const row = await this.getCase(caseId);
    if (auth.role === 'professional_supervisor') return row;
    if (auth.role !== 'volunteer') throw errors.permissionDenied();
    if (row.assigned_volunteer_id !== auth.staffId) throw errors.scopeDenied('仅当前承接者可访问');
    return row;
  }

  mapCase(row: any): any {
    return {
      id: row.id,
      user_id: row.user_id,
      district_id: row.district_id,
      support_need_level: row.support_need_level,
      service_progress: row.service_progress,
      response_path: row.response_path,
      status: row.status,
      assigned_volunteer_id: row.assigned_volunteer_id,
      owner_type: row.owner_type,
      owner_id: row.owner_id,
      consent_scope: parseJsonField<string[]>(row.consent_scope, []),
      request_type: row.request_type,
      preferred_contact: row.preferred_contact,
      created_at: row.created_at,
      updated_at: row.updated_at,
      closed_at: row.closed_at,
      version: Number(row.version),
    };
  }
}
