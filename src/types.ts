export type Role =
  | 'user'
  | 'volunteer'
  | 'duty_manager'
  | 'professional_supervisor'
  | 'ai_config_admin'
  | 'system';

export interface AuthContext {
  sessionId: string;
  role: Role;
  userId?: string;
  staffId?: string;
  districtIds?: string[];
  expiresAt: Date;
}

export interface CaseRow {
  id: string;
  user_id: string;
  district_id: string;
  support_need_level: string;
  service_progress: string;
  response_path: string | null;
  status: string;
  assigned_volunteer_id: string | null;
  owner_type: string | null;
  owner_id: string | null;
  consent_scope: unknown;
  request_type: string;
  preferred_contact: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  version: number;
}

export interface StaffRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  status: string;
  daily_limit: number;
  concurrent_limit: number;
  self_check_passed_at: Date | null;
}
