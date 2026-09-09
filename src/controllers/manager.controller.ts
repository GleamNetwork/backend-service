import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { Inject as InjectDecorator } from '@nestjs/common';
import { DATABASE } from '../database.module';
import { Roles } from '../auth';
import { errors } from '../errors';
import { parseJsonField, uuid } from '../utils';
import { EventService } from '../services/event.service';

@Controller('manager')
@Roles('duty_manager', 'professional_supervisor')
export class ManagerController {
  constructor(
    @InjectDecorator(DATABASE) private readonly database: Pool,
    @Inject(EventService) private readonly events: EventService,
  ) {}

  @Get('overview')
  async overview(@Req() request: Request) {
    const districtIds = await this.districts(request);
    const placeholders = districtIds.length ? districtIds : ['__none__'];
    const cases = await this.database
      .query(
        `SELECT status, support_need_level, COUNT(DISTINCT id) AS count
         FROM service_cases WHERE district_id IN (?) GROUP BY status, support_need_level`,
        [placeholders],
      )
      .then(([rows]) => rows as any[]);
    const [staff] = await this.database
      .query(
        `SELECT COUNT(DISTINCT s.id) AS count
         FROM staff_accounts s
         JOIN staff_districts d ON d.staff_id = s.id
         WHERE d.district_id IN (?) AND s.status = 'active'`,
        [placeholders],
      )
      .then(([rows]) => rows as any[]);
    const distribution: Record<string, number> = {};
    let activeCases = 0;
    let waitingSupport = 0;
    let immediateSafetyPending = 0;
    let awaitingTransfer = 0;
    for (const row of cases) {
      distribution[row.support_need_level] = Number(row.count);
      if (['in_progress', 'awaiting_transfer', 'professional_takeover_requested'].includes(row.status)) activeCases += Number(row.count);
      if (row.status === 'waiting_assignment') waitingSupport += Number(row.count);
      if (row.status === 'waiting_assignment' && row.support_need_level === 'immediate_safety') immediateSafetyPending += Number(row.count);
      if (row.status === 'awaiting_transfer') awaitingTransfer += Number(row.count);
    }
    return {
      district_ids: districtIds,
      generated_at: new Date().toISOString(),
      active_cases: activeCases,
      waiting_support: waitingSupport,
      immediate_safety_pending: immediateSafetyPending,
      awaiting_transfer: awaitingTransfer,
      available_volunteers: Number(staff[0]?.count ?? 0),
      support_need_distribution: distribution,
    };
  }

  @Get('users')
  async users(@Req() request: Request) {
    const districtIds = await this.districts(request);
    const rows = await this.database
      .query(
        `SELECT u.id, u.display_name, u.age_band, u.district_id, c.support_need_level, c.service_progress
         FROM users u
         LEFT JOIN service_cases c ON c.user_id = u.id
         WHERE u.district_id IN (?)
         ORDER BY u.created_at DESC LIMIT 200`,
        [districtIds.length ? districtIds : ['__none__']],
      )
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Get('volunteers')
  async volunteers(@Req() request: Request) {
    const districtIds = await this.districts(request);
    const rows = await this.database
      .query(
        `SELECT s.id, s.display_name, s.role, s.status, s.daily_limit, s.concurrent_limit,
                cap.daily_count, cap.concurrent_count
         FROM staff_accounts s
         JOIN staff_districts d ON d.staff_id = s.id
         LEFT JOIN staff_capacity cap ON cap.staff_id = s.id AND cap.service_date = UTC_DATE()
         WHERE d.district_id IN (?)
         ORDER BY s.display_name`,
        [districtIds.length ? districtIds : ['__none__']],
      )
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Get('schedules')
  async schedules(@Req() request: Request) {
    const districtIds = await this.districts(request);
    const rows = await this.database
      .query(
        'SELECT * FROM schedules WHERE district_id IN (?) ORDER BY start_at',
        [districtIds.length ? districtIds : ['__none__']],
      )
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Patch('schedules/:schedule_id')
  async updateSchedule(@Req() request: Request, @Param('schedule_id') scheduleId: string, @Body() body: any) {
    this.assertRole(request, 'duty_manager');
    const [result] = await this.database.execute<ResultSetHeader>(
      `UPDATE schedules
       SET start_at = COALESCE(?, start_at), end_at = COALESCE(?, end_at),
           role_in_shift = COALESCE(?, role_in_shift), confirmed_at = ?, version = version + 1
       WHERE id = ?`,
      [
        body?.start_at ?? null,
        body?.end_at ?? null,
        body?.role_in_shift ?? null,
        body?.confirmed ? new Date() : null,
        scheduleId,
      ],
    );
    if (result.affectedRows === 0) throw errors.notFound('排班不存在');
    const [row] = await this.database
      .query('SELECT * FROM schedules WHERE id = ?', [scheduleId])
      .then(([rows]) => rows as any[]);
    return row;
  }

  @Get('transfer-requests')
  async transferRequests(@Req() request: Request) {
    const rows = await this.database
      .query('SELECT * FROM transfer_requests ORDER BY requested_at DESC LIMIT 200')
      .then(([rows]) => rows as any[]);
    return { items: rows.map(this.mapTransfer.bind(this)) };
  }

  @Post('transfer-requests/:id/confirm')
  async confirmTransfer(@Req() request: Request, @Param('id') id: string, @Body() body: any) {
    this.assertRole(request, 'duty_manager');
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const [requests] = await connection.query<any[]>(
        "SELECT * FROM transfer_requests WHERE id = ? AND status = 'requested' FOR UPDATE",
        [id],
      );
      const transfer = requests[0];
      if (!transfer) throw errors.stateConflict('交接申请不存在、已处理或已失效');
      const receiverId = String(body?.receiver_volunteer_id ?? transfer.to_staff_id ?? '');
      if (!receiverId) throw errors.validation('receiver_volunteer_id 不能为空');
      const [receiverRows] = await connection.query<any[]>(
        'SELECT * FROM staff_accounts WHERE id = ? FOR UPDATE',
        [receiverId],
      );
      const receiver = receiverRows[0];
      if (!receiver || receiver.status !== 'active') throw errors.accountLocked('接班者不可用');
      const [receiverCapacityRows] = await connection.query<any[]>(
        `SELECT * FROM staff_capacity WHERE staff_id = ? AND service_date = UTC_DATE() FOR UPDATE`,
        [receiverId],
      );
      const receiverCapacity = receiverCapacityRows[0] ?? { daily_count: 0, concurrent_count: 0 };
      if (receiverCapacity.daily_count >= receiver.daily_limit) throw errors.receiverCapacityExceeded('接班者今日接待已满');
      if (receiverCapacity.concurrent_count >= receiver.concurrent_limit) throw errors.receiverCapacityExceeded('接班者同时陪伴已满');
      const [caseRows] = await connection.query<any[]>(
        "SELECT * FROM service_cases WHERE id = ? AND status = 'awaiting_transfer' FOR UPDATE",
        [transfer.case_id],
      );
      const caseRow = caseRows[0];
      if (!caseRow) throw errors.stateConflict('工单状态已变化');
      if (caseRow.status === 'professional_taken_over') throw errors.transferSuperseded();
      await connection.execute(
        `UPDATE transfer_requests SET status = 'receiver_confirmed', confirmed_at = UTC_TIMESTAMP(6) WHERE id = ?`,
        [id],
      );
      await connection.execute(
        `UPDATE service_cases
         SET assigned_volunteer_id = ?, owner_id = ?, status = 'in_progress', service_progress = 'in_progress',
             version = version + 1, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [receiverId, receiverId, transfer.case_id],
      );
      await connection.execute(
        `INSERT INTO staff_capacity (id, staff_id, service_date, daily_count, concurrent_count, updated_at)
         VALUES (?, ?, UTC_DATE(), ?, ?, UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE daily_count = daily_count + 1, concurrent_count = concurrent_count + 1, updated_at = UTC_TIMESTAMP(6)`,
        [uuid(), receiverId, receiverCapacity.daily_count + 1, receiverCapacity.concurrent_count + 1],
      );
      await connection.execute(
        `UPDATE staff_capacity
         SET concurrent_count = GREATEST(concurrent_count - 1, 0), updated_at = UTC_TIMESTAMP(6)
         WHERE staff_id = ? AND service_date = UTC_DATE()`,
        [transfer.from_staff_id],
      );
      const eventId = await this.events.publish({
        eventType: 'case.transfer.confirmed',
        aggregateType: 'case',
        aggregateId: transfer.case_id,
        audienceType: 'district',
        audienceId: caseRow.district_id,
        payload: { transfer_request_id: id, receiver_id: receiverId },
        connection,
      });
      await connection.commit();
      return {
        transfer_request_id: id,
        status: 'receiver_confirmed',
        case_id: transfer.case_id,
        new_owner_id: receiverId,
        old_owner_released: true,
        event_id: eventId,
        confirmed_at: new Date().toISOString(),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  @Get('professional-requests')
  async professionalRequests() {
    const rows = await this.database
      .query('SELECT * FROM professional_requests ORDER BY requested_at DESC LIMIT 200')
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Post('professional-requests/:id/confirm')
  async confirmProfessional(@Req() request: Request, @Param('id') id: string, @Body() body: any) {
    this.assertRole(request, 'professional_supervisor');
    const connection = await this.database.getConnection();
    try {
      await connection.beginTransaction();
      const [requests] = await connection.query<any[]>(
        "SELECT * FROM professional_requests WHERE id = ? AND status = 'waiting_confirmation' FOR UPDATE",
        [id],
      );
      const requestRow = requests[0];
      if (!requestRow) throw errors.stateConflict('专业接管请求不存在或已处理');
      const [caseRows] = await connection.query<any[]>(
        'SELECT * FROM service_cases WHERE id = ? FOR UPDATE',
        [requestRow.case_id],
      );
      const caseRow = caseRows[0];
      if (!caseRow) throw errors.notFound('工单不存在');
      await connection.execute(
        `UPDATE professional_requests
         SET status = 'professional_taken_over', supervisor_id = ?, taken_over_at = UTC_TIMESTAMP(6),
             external_referral_status = ?
         WHERE id = ?`,
        [request.auth!.staffId!, body?.external_referral_status ?? 'pending', id],
      );
      await connection.execute(
        `UPDATE service_cases
         SET status = 'professional_taken_over', service_progress = 'professional_taken_over',
             owner_type = 'professional_supervisor', owner_id = ?, version = version + 1, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [request.auth!.staffId!, caseRow.id],
      );
      await connection.execute(
        `UPDATE transfer_requests SET status = 'superseded', superseded_at = UTC_TIMESTAMP(6)
         WHERE case_id = ? AND status IN ('requested', 'receiver_confirmed')`,
        [caseRow.id],
      );
      if (caseRow.assigned_volunteer_id) {
        await connection.execute(
          `UPDATE staff_capacity
           SET concurrent_count = GREATEST(concurrent_count - 1, 0), updated_at = UTC_TIMESTAMP(6)
           WHERE staff_id = ? AND service_date = UTC_DATE()`,
          [caseRow.assigned_volunteer_id],
        );
      }
      const eventId = await this.events.publish({
        eventType: 'case.professional.taken_over',
        aggregateType: 'case',
        aggregateId: caseRow.id,
        audienceType: 'district',
        audienceId: caseRow.district_id,
        payload: { professional_request_id: id },
        connection,
      });
      await connection.commit();
      return {
        professional_request_id: id,
        status: 'professional_taken_over',
        case_id: caseRow.id,
        supervisor_id: request.auth!.staffId,
        taken_over_at: new Date().toISOString(),
        old_transfer_request_status: 'superseded',
        event_id: eventId,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  @Post('support-reviews')
  async supportReview(@Req() request: Request, @Body() body: any) {
    this.assertRole(request, 'professional_supervisor');
    const caseId = String(body?.case_id ?? '');
    const [caseRow] = await this.database
      .query('SELECT user_id FROM service_cases WHERE id = ?', [caseId])
      .then(([rows]) => rows as any[]);
    if (!caseRow) throw errors.notFound('工单不存在');
    const id = uuid();
    await this.database.execute(
      `INSERT INTO support_reviews
       (id, case_id, user_id, reviewer_id, support_need_level, evidence_summary, reviewed_at, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
      [
        id,
        caseId,
        caseRow.user_id,
        request.auth!.staffId!,
        String(body?.support_need_level ?? 'unverified'),
        String(body?.evidence_summary ?? ''),
        body?.valid_until ?? null,
      ],
    );
    if (caseId) {
      await this.database.execute(
        `UPDATE service_cases SET support_need_level = ?, updated_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?`,
        [String(body?.support_need_level ?? 'unverified'), body.case_id],
      );
    }
    return { review_id: id, support_need_level: body?.support_need_level, reviewed_at: new Date().toISOString() };
  }

  @Get('audit-logs')
  async auditLogs(@Query('page') page = '1', @Query('page_size') pageSize = '20') {
    const limit = Math.min(Number(pageSize) || 20, 100);
    const offset = ((Number(page) || 1) - 1) * limit;
    const rows = await this.database
      .query('SELECT * FROM audit_logs ORDER BY occurred_at DESC LIMIT ? OFFSET ?', [limit, offset])
      .then(([rows]) => rows as any[]);
    return { items: rows, page: Number(page), page_size: limit };
  }

  @Post('resources')
  async upsertResource(@Req() request: Request, @Body() body: any) {
    this.assertRole(request, 'duty_manager');
    const id = body?.id ?? uuid();
    await this.database.execute(
      `INSERT INTO resources
       (id, name, category, region, contact, service_time, service_target, fee_info, official_source,
        verified_at, verified_by, status, limitations, fallback_resource_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), category = VALUES(category), region = VALUES(region), contact = VALUES(contact),
         service_time = VALUES(service_time), service_target = VALUES(service_target), fee_info = VALUES(fee_info),
         official_source = VALUES(official_source), verified_at = VALUES(verified_at), verified_by = VALUES(verified_by),
         status = VALUES(status), limitations = VALUES(limitations), fallback_resource_id = VALUES(fallback_resource_id)`,
      [
        id,
        body?.name ?? '',
        body?.category ?? 'mental_hotline',
        body?.region ?? 'shanghai',
        JSON.stringify(body?.contact ?? { phone: body?.phone ?? '' }),
        JSON.stringify(body?.service_time ?? { available_time: body?.available_time ?? '' }),
        body?.service_target ?? null,
        body?.fee_info ?? null,
        body?.official_source ?? '',
        request.auth!.staffId!,
        body?.status ?? 'verified',
        body?.limitations ?? null,
        body?.fallback_resource_id ?? null,
      ],
    );
    const [row] = await this.database
      .query('SELECT * FROM resources WHERE id = ?', [id])
      .then(([rows]) => rows as any[]);
    return row;
  }

  private assertRole(request: Request, role: string): void {
    if (request.auth?.role !== role) throw errors.permissionDenied();
  }

  private async districts(request: Request): Promise<string[]> {
    return request.auth?.districtIds ?? [];
  }

  private mapTransfer(row: any): any {
    return {
      id: row.id,
      case_id: row.case_id,
      type: row.type,
      from_volunteer_id: row.from_staff_id,
      to_volunteer_id: row.to_staff_id,
      status: row.status,
      summary_scope: parseJsonField<string[]>(row.summary_scope, []),
      requested_at: row.requested_at,
      confirmed_at: row.confirmed_at,
    };
  }
}
