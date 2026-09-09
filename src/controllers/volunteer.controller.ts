import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Pool } from 'mysql2/promise';
import { DATABASE } from '../database.module';
import { Roles } from '../auth';
import { errors } from '../errors';
import { CaseService } from '../services/case.service';
import { EventService } from '../services/event.service';
import { parseJsonField, uuid } from '../utils';

@Controller('volunteer')
@Roles('volunteer', 'professional_supervisor')
export class VolunteerController {
  constructor(
    @Inject(DATABASE) private readonly database: Pool,
    @Inject(CaseService) private readonly cases: CaseService,
    @Inject(EventService) private readonly events: EventService,
  ) {}

  @Get('me')
  async me(@Req() request: Request) {
    const staffId = this.requireStaff(request);
    const [staff] = await this.database
      .query('SELECT id, display_name, role, status, daily_limit, concurrent_limit, self_check_passed_at FROM staff_accounts WHERE id = ?', [staffId])
      .then(([rows]) => rows as any[]);
    const districts = await this.database
      .query('SELECT district_id FROM staff_districts WHERE staff_id = ?', [staffId])
      .then(([rows]) => rows as any[]);
    return { ...staff, district_ids: districts.map((row: any) => row.district_id) };
  }

  @Get('cases')
  async casesList(@Req() request: Request) {
    const staffId = this.requireStaff(request);
    const districts = await this.getDistricts(staffId);
    const rows = await this.database
      .query(
        `SELECT * FROM service_cases
         WHERE (assigned_volunteer_id = ? OR (status = 'waiting_assignment' AND district_id IN (?)))
         ORDER BY FIELD(status, 'waiting_assignment', 'in_progress', 'awaiting_transfer', 'professional_taken_over', 'completed'), created_at DESC
         LIMIT 100`,
        [staffId, districts.length ? districts : ['__none__']],
      )
      .then(([rows]) => rows as any[]);
    return { items: rows.map((row: any) => this.cases.mapCase(row)) };
  }

  @Post('cases/:case_id/accept')
  async accept(@Req() request: Request, @Param('case_id') caseId: string) {
    const staffId = this.requireStaff(request);
    if (request.auth?.role !== 'volunteer') {
      throw errors.permissionDenied('仅普通志愿者可以承接普通工单');
    }
    return this.cases.acceptCase(caseId, staffId, await this.getDistricts(staffId));
  }

  @Get('cases/:case_id')
  async caseDetail(@Req() request: Request, @Param('case_id') caseId: string) {
    return this.cases.assertCaseAccess(caseId, request.auth!);
  }

  @Post('cases/:case_id/messages')
  async sendMessage(@Req() request: Request, @Param('case_id') caseId: string, @Body() body: any) {
    const row = await this.cases.assertCaseAccess(caseId, request.auth!);
    const id = uuid();
    await this.database.execute(
      `INSERT INTO case_messages (id, case_id, sender_role, sender_id, content, ai_assisted, visibility_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'case_participants', UTC_TIMESTAMP(6))`,
      [id, caseId, request.auth!.role, request.auth!.staffId!, String(body?.content ?? ''), Boolean(body?.ai_assisted)],
    );
    await this.events.publish({
      eventType: 'case.message.created',
      aggregateType: 'case',
      aggregateId: caseId,
      audienceType: 'user',
      audienceId: row.user_id,
      payload: { message_id: id, sender_role: request.auth!.role },
    });
    return {
      message_id: id,
      case_id: caseId,
      sender_role: request.auth!.role,
      created_at: new Date().toISOString(),
      delivered: true,
    };
  }

  @Post('cases/:case_id/close')
  async close(@Req() request: Request, @Param('case_id') caseId: string) {
    return this.cases.closeCase(caseId, this.requireStaff(request));
  }

  @Post('rest')
  async rest(@Req() request: Request, @Body() body: any) {
    const staffId = this.requireStaff(request);
    await this.database.execute(
      `UPDATE staff_accounts SET status = 'resting', updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
      [staffId],
    );
    await this.events.publish({
      eventType: 'volunteer.status.updated',
      aggregateType: 'staff',
      aggregateId: staffId,
      audienceType: 'staff',
      audienceId: staffId,
      payload: { status: 'resting', reason: body?.reason ?? null },
    });
    return { staff_id: staffId, status: 'resting', stop_new_cases: true };
  }

  @Post('self-check')
  async selfCheck(@Req() request: Request, @Body() body: any) {
    const staffId = this.requireStaff(request);
    const passed = Boolean(body?.fit_to_continue && body?.private_environment);
    await this.database.execute(
      `UPDATE staff_accounts
       SET self_check_passed_at = ?, status = ?, updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [passed ? new Date() : null, passed ? 'active' : 'paused', staffId],
    );
    return { staff_id: staffId, self_check_passed: passed, status: passed ? 'active' : 'paused' };
  }

  @Get('schedule')
  async schedule(@Req() request: Request) {
    const staffId = this.requireStaff(request);
    const rows = await this.database
      .query('SELECT * FROM schedules WHERE staff_id = ? ORDER BY start_at ASC', [staffId])
      .then(([rows]) => rows as any[]);
    return { items: rows };
  }

  @Get('capacity')
  async capacity(@Req() request: Request) {
    const staffId = this.requireStaff(request);
    const [staff] = await this.database
      .query('SELECT daily_limit, concurrent_limit FROM staff_accounts WHERE id = ?', [staffId])
      .then(([rows]) => rows as any[]);
    const [capacity] = await this.database
      .query(
        'SELECT * FROM staff_capacity WHERE staff_id = ? AND service_date = UTC_DATE()',
        [staffId],
      )
      .then(([rows]) => rows as any[]);
    return {
      daily_limit: staff?.daily_limit ?? 6,
      concurrent_limit: staff?.concurrent_limit ?? 2,
      current_daily_count: capacity?.daily_count ?? 0,
      current_concurrent_count: capacity?.concurrent_count ?? 0,
    };
  }

  @Post('transfer-requests')
  async transferRequest(@Req() request: Request, @Body() body: any) {
    const staffId = this.requireStaff(request);
    const caseId = String(body?.case_id ?? '');
    const row = await this.cases.assertCaseAccess(caseId, request.auth!);
    if (row.assigned_volunteer_id !== staffId) throw errors.scopeDenied('仅当前承接者可以申请交接');
    const id = uuid();
    await this.database.execute(
      `INSERT INTO transfer_requests
       (id, case_id, type, from_staff_id, to_staff_id, status, summary_scope, requested_at)
       VALUES (?, ?, ?, ?, ?, 'requested', ?, UTC_TIMESTAMP(6))`,
      [
        id,
        caseId,
        String(body?.type ?? 'shift_transfer'),
        staffId,
        body?.to_volunteer_id ?? null,
        JSON.stringify(body?.summary_scope ?? ['main_request', 'safety_facts', 'actions_taken']),
      ],
    );
    await this.database.execute(
      `UPDATE service_cases SET service_progress = 'awaiting_transfer', status = 'awaiting_transfer', updated_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?`,
      [caseId],
    );
    await this.events.publish({
      eventType: 'case.transfer.requested',
      aggregateType: 'case',
      aggregateId: caseId,
      audienceType: 'staff',
      audienceId: body?.to_volunteer_id ?? null,
      payload: { transfer_request_id: id },
    });
    return { transfer_request_id: id, status: 'requested', receiver_confirmation_required: true };
  }

  @Post('professional-requests')
  async professionalRequest(@Req() request: Request, @Body() body: any) {
    const staffId = this.requireStaff(request);
    const caseId = String(body?.case_id ?? '');
    const row = await this.cases.getCase(caseId);
    if (request.auth?.role === 'volunteer' && row.assigned_volunteer_id !== staffId) {
      throw errors.scopeDenied('仅当前承接者可以发起专业求助');
    }
    const id = uuid();
    await this.database.execute(
      `INSERT INTO professional_requests
       (id, case_id, requested_by, status, reason, requested_at)
       VALUES (?, ?, ?, 'waiting_confirmation', ?, UTC_TIMESTAMP(6))`,
      [id, caseId, staffId, String(body?.reason ?? '需要专业支持')],
    );
    await this.database.execute(
      `UPDATE service_cases SET service_progress = 'awaiting_transfer', status = 'professional_takeover_requested', updated_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?`,
      [caseId],
    );
    await this.events.publish({
      eventType: 'case.professional.requested',
      aggregateType: 'case',
      aggregateId: caseId,
      audienceType: 'district',
      audienceId: row.district_id,
      payload: { professional_request_id: id },
    });
    return { professional_request_id: id, status: 'waiting_confirmation' };
  }

  @Post('review-requests')
  async reviewRequest(@Req() request: Request, @Body() body: any) {
    const staffId = this.requireStaff(request);
    const caseId = String(body?.case_id ?? '');
    const [caseRow] = await this.database
      .query('SELECT user_id FROM service_cases WHERE id = ?', [caseId])
      .then(([rows]) => rows as any[]);
    if (!caseRow) throw errors.notFound('工单不存在');
    const id = uuid();
    await this.database.execute(
      `INSERT INTO support_reviews (id, case_id, user_id, reviewer_id, support_need_level, evidence_summary, reviewed_at)
       VALUES (?, ?, ?, ?, 'unverified', ?, UTC_TIMESTAMP(6))`,
      [id, caseId, caseRow.user_id, staffId, String(body?.reason ?? '申请专业复核')],
    );
    return { review_request_id: id, status: 'pending' };
  }

  private requireStaff(request: Request): string {
    const staffId = request.auth?.staffId;
    if (!staffId) throw errors.permissionDenied('需要志愿者或管理端身份');
    return staffId;
  }

  private async getDistricts(staffId: string): Promise<string[]> {
    const rows = await this.database
      .query('SELECT district_id FROM staff_districts WHERE staff_id = ?', [staffId])
      .then(([rows]) => rows as any[]);
    return rows.map((row: any) => row.district_id);
  }
}
