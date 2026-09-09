import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth';
import { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('user-session')
  async createUserSession(@Body() body: any) {
    if (!body?.age_band || !body?.district_id) {
      throw Object.assign(new Error('age_band 和 district_id 不能为空'), { status: 400 });
    }
    const result = await this.auth.createUserSession({
      ageBand: String(body.age_band),
      districtId: String(body.district_id),
      displayName: body.display_name,
    });
    return {
      token: result.token,
      user: result.user,
      expires_at: result.expiresAt.toISOString(),
    };
  }

  @Public()
  @Post('volunteer-login')
  async volunteerLogin(@Body() body: any) {
    if (!body?.account || !body?.password) {
      throw Object.assign(new Error('account 和 password 不能为空'), { status: 400 });
    }
    return this.auth.loginStaff(String(body.account), String(body.password));
  }

  @Public()
  @Post('manager-login')
  async managerLogin(@Body() body: any) {
    if (!body?.account || !body?.password) {
      throw Object.assign(new Error('account 和 password 不能为空'), { status: 400 });
    }
    return this.auth.loginStaff(String(body.account), String(body.password));
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: any) {
    if (!body?.refresh_token) {
      throw Object.assign(new Error('refresh_token 不能为空'), { status: 400 });
    }
    return this.auth.refresh(String(body.refresh_token));
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@Req() request: Request, @Body() body: any) {
    const sessionId = body?.session_id ?? request.auth?.sessionId;
    if (!sessionId) throw Object.assign(new Error('session_id 不能为空'), { status: 400 });
    await this.auth.logout(String(sessionId));
    return { revoked: true };
  }
}
