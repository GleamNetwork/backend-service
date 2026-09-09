CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  display_name VARCHAR(64) NULL,
  age_band VARCHAR(16) NOT NULL,
  district_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  staff_id CHAR(36) NULL,
  role VARCHAR(32) NOT NULL,
  access_token_hash CHAR(64) NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  refreshed_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  UNIQUE KEY uk_sessions_access_token (access_token_hash),
  UNIQUE KEY uk_sessions_refresh_token (refresh_token_hash),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS consents (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  consent_type VARCHAR(64) NOT NULL,
  granted BOOLEAN NOT NULL,
  granted_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  expires_at DATETIME(6) NULL,
  scope JSON NOT NULL,
  UNIQUE KEY uk_consents_user_type (user_id, consent_type),
  CONSTRAINT fk_consents_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS diary_entries (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  feeling VARCHAR(32) NULL,
  content TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  current_version INT NOT NULL DEFAULT 1,
  confirmed_at DATETIME(6) NULL,
  shared_scope VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_diary_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS diary_versions (
  id CHAR(36) PRIMARY KEY,
  diary_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  created_by CHAR(36) NOT NULL,
  UNIQUE KEY uk_diary_versions (diary_id, version),
  CONSTRAINT fk_diary_version_entry FOREIGN KEY (diary_id) REFERENCES diary_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS diary_shares (
  id CHAR(36) PRIMARY KEY,
  diary_id CHAR(36) NOT NULL,
  diary_version INT NOT NULL,
  case_id CHAR(36) NULL,
  recipient_role VARCHAR(32) NOT NULL,
  shared_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  CONSTRAINT fk_diary_share_entry FOREIGN KEY (diary_id) REFERENCES diary_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS device_metrics (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  metric_type VARCHAR(32) NOT NULL,
  value DOUBLE NULL,
  unit VARCHAR(16) NOT NULL,
  source VARCHAR(32) NOT NULL,
  sampled_at DATETIME(6) NULL,
  quality VARCHAR(32) NOT NULL,
  context VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_device_metrics (user_id, metric_type, source, sampled_at),
  CONSTRAINT fk_device_metrics_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS metric_summaries (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  metric_type VARCHAR(32) NOT NULL,
  time_window_start DATETIME(6) NOT NULL,
  time_window_end DATETIME(6) NOT NULL,
  summary_value JSON NOT NULL,
  completeness DOUBLE NOT NULL,
  source VARCHAR(32) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_metric_summaries (user_id, metric_type, time_window_start, source),
  CONSTRAINT fk_metric_summary_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  sender_role VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS service_cases (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  district_id CHAR(36) NOT NULL,
  support_need_level VARCHAR(32) NOT NULL,
  service_progress VARCHAR(32) NOT NULL,
  response_path VARCHAR(8) NULL,
  status VARCHAR(32) NOT NULL,
  assigned_volunteer_id CHAR(36) NULL,
  owner_type VARCHAR(32) NULL,
  owner_id CHAR(36) NULL,
  consent_scope JSON NOT NULL,
  request_type VARCHAR(64) NOT NULL,
  preferred_contact VARCHAR(64) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  closed_at DATETIME(6) NULL,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT fk_case_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS case_messages (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  sender_role VARCHAR(32) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  content TEXT NOT NULL,
  ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  visibility_scope VARCHAR(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_case_message_case FOREIGN KEY (case_id) REFERENCES service_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS staff_accounts (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  daily_limit INT NOT NULL DEFAULT 6,
  concurrent_limit INT NOT NULL DEFAULT 2,
  self_check_passed_at DATETIME(6) NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS staff_districts (
  id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NOT NULL,
  district_id CHAR(36) NOT NULL,
  UNIQUE KEY uk_staff_districts (staff_id, district_id),
  CONSTRAINT fk_staff_district_staff FOREIGN KEY (staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS staff_capacity (
  id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NOT NULL,
  service_date DATE NOT NULL,
  daily_count INT NOT NULL DEFAULT 0,
  concurrent_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_staff_capacity (staff_id, service_date),
  CONSTRAINT fk_staff_capacity_staff FOREIGN KEY (staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS schedules (
  id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NOT NULL,
  district_id CHAR(36) NOT NULL,
  shift_type VARCHAR(16) NOT NULL,
  start_at DATETIME(6) NOT NULL,
  end_at DATETIME(6) NOT NULL,
  role_in_shift VARCHAR(32) NOT NULL,
  confirmed_at DATETIME(6) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_schedule_staff FOREIGN KEY (staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS capacity_events (
  id CHAR(36) PRIMARY KEY,
  staff_id CHAR(36) NOT NULL,
  case_id CHAR(36) NULL,
  event_type VARCHAR(32) NOT NULL,
  daily_count_after INT NOT NULL,
  concurrent_count_after INT NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  idempotency_key VARCHAR(128) NULL,
  UNIQUE KEY uk_capacity_events_idem (idempotency_key),
  CONSTRAINT fk_capacity_event_staff FOREIGN KEY (staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS transfer_requests (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  type VARCHAR(32) NOT NULL,
  from_staff_id CHAR(36) NOT NULL,
  to_staff_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL,
  summary_scope JSON NOT NULL,
  requested_at DATETIME(6) NOT NULL,
  confirmed_at DATETIME(6) NULL,
  cancelled_at DATETIME(6) NULL,
  superseded_at DATETIME(6) NULL,
  idempotency_key VARCHAR(128) NULL,
  UNIQUE KEY uk_transfer_idem (idempotency_key),
  CONSTRAINT fk_transfer_case FOREIGN KEY (case_id) REFERENCES service_cases(id),
  CONSTRAINT fk_transfer_from_staff FOREIGN KEY (from_staff_id) REFERENCES staff_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS professional_requests (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  supervisor_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  external_referral_status VARCHAR(32) NULL,
  requested_at DATETIME(6) NOT NULL,
  taken_over_at DATETIME(6) NULL,
  idempotency_key VARCHAR(128) NULL,
  UNIQUE KEY uk_professional_idem (idempotency_key),
  CONSTRAINT fk_professional_case FOREIGN KEY (case_id) REFERENCES service_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS support_reviews (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  reviewer_id CHAR(36) NOT NULL,
  support_need_level VARCHAR(32) NOT NULL,
  evidence_summary TEXT NOT NULL,
  reviewed_at DATETIME(6) NOT NULL,
  valid_until DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  CONSTRAINT fk_review_case FOREIGN KEY (case_id) REFERENCES service_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resources (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(32) NOT NULL,
  region VARCHAR(64) NOT NULL,
  contact JSON NOT NULL,
  service_time JSON NOT NULL,
  service_target VARCHAR(128) NULL,
  fee_info TEXT NULL,
  official_source TEXT NOT NULL,
  verified_at DATETIME(6) NOT NULL,
  verified_by CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  limitations TEXT NULL,
  fallback_resource_id CHAR(36) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS exercises (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  safety_confirmed BOOLEAN NOT NULL,
  started_at DATETIME(6) NOT NULL,
  ended_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL,
  feeling_after VARCHAR(32) NULL,
  CONSTRAINT fk_exercise_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS care_responses (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  scenario VARCHAR(64) NOT NULL,
  want_exercise BOOLEAN NOT NULL,
  note TEXT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_care_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  questionnaire_type VARCHAR(64) NOT NULL,
  answers JSON NOT NULL,
  score INT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_questionnaire_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id CHAR(36) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL,
  actor_id CHAR(36) NULL,
  endpoint VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status INT NOT NULL,
  response_body JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_idempotency_keys (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  aggregate_type VARCHAR(32) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  audience_type VARCHAR(32) NOT NULL,
  audience_id CHAR(36) NULL,
  payload JSON NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  published_at DATETIME(6) NULL,
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  retry_count INT NOT NULL DEFAULT 0,
  INDEX idx_events_audience_cursor (audience_type, audience_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_prompts (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL,
  variables JSON NOT NULL,
  safety_constraints JSON NOT NULL,
  version INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_ai_prompts_version (code, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_skills (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  allowed_task_types JSON NOT NULL,
  forbidden_actions JSON NOT NULL,
  version INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_ai_skills_version (code, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_tools (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  parameters_json_schema JSON NOT NULL,
  execution_type VARCHAR(32) NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  handler VARCHAR(128) NOT NULL,
  timeout_ms INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uk_ai_tools_version (name, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id CHAR(36) PRIMARY KEY,
  version INT NOT NULL,
  provider VARCHAR(32) NOT NULL,
  base_url TEXT NOT NULL,
  model VARCHAR(64) NOT NULL,
  api_key_secret_ref VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_parameters JSON NOT NULL,
  task_overrides JSON NOT NULL,
  prompt_mappings JSON NOT NULL,
  timeout_ms INT NOT NULL,
  max_retries INT NOT NULL,
  daily_token_budget BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  previous_version_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  published_at DATETIME(6) NULL,
  UNIQUE KEY uk_ai_provider_version (provider, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_config_skills (
  id CHAR(36) PRIMARY KEY,
  ai_config_id CHAR(36) NOT NULL,
  skill_id CHAR(36) NOT NULL,
  UNIQUE KEY uk_ai_config_skills (ai_config_id, skill_id),
  CONSTRAINT fk_ai_config_skill_config FOREIGN KEY (ai_config_id) REFERENCES ai_provider_configs(id),
  CONSTRAINT fk_ai_config_skill_skill FOREIGN KEY (skill_id) REFERENCES ai_skills(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_config_tools (
  id CHAR(36) PRIMARY KEY,
  ai_config_id CHAR(36) NOT NULL,
  tool_id CHAR(36) NOT NULL,
  UNIQUE KEY uk_ai_config_tools (ai_config_id, tool_id),
  CONSTRAINT fk_ai_config_tool_config FOREIGN KEY (ai_config_id) REFERENCES ai_provider_configs(id),
  CONSTRAINT fk_ai_config_tool_tool FOREIGN KEY (tool_id) REFERENCES ai_tools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_calls (
  id CHAR(36) PRIMARY KEY,
  task_type VARCHAR(64) NOT NULL,
  case_id CHAR(36) NULL,
  user_id CHAR(36) NULL,
  requested_by CHAR(36) NOT NULL,
  ai_config_id CHAR(36) NOT NULL,
  prompt_id CHAR(36) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(64) NOT NULL,
  input_scope JSON NOT NULL,
  output JSON NOT NULL,
  uncertainty TEXT NULL,
  safety_check_result VARCHAR(32) NOT NULL,
  safety_rejection_reason TEXT NULL,
  requires_human_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  human_confirmed_by CHAR(36) NULL,
  human_confirmed_at DATETIME(6) NULL,
  skill_versions JSON NOT NULL,
  tool_versions JSON NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  finish_reason VARCHAR(32) NULL,
  latency_ms INT NOT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_ai_call_config FOREIGN KEY (ai_config_id) REFERENCES ai_provider_configs(id),
  CONSTRAINT fk_ai_call_prompt FOREIGN KEY (prompt_id) REFERENCES ai_prompts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_tool_executions (
  id CHAR(36) PRIMARY KEY,
  ai_call_id CHAR(36) NOT NULL,
  tool_id CHAR(36) NOT NULL,
  tool_name VARCHAR(64) NOT NULL,
  arguments JSON NOT NULL,
  result JSON NULL,
  execution_status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64) NULL,
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  actor_id CHAR(36) NULL,
  CONSTRAINT fk_ai_tool_call FOREIGN KEY (ai_call_id) REFERENCES ai_calls(id),
  CONSTRAINT fk_ai_tool_tool FOREIGN KEY (tool_id) REFERENCES ai_tools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  actor_id CHAR(36) NULL,
  actor_role VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  object_type VARCHAR(32) NOT NULL,
  object_id CHAR(36) NULL,
  result VARCHAR(32) NOT NULL,
  reason TEXT NULL,
  occurred_at DATETIME(6) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  ip_hash VARCHAR(64) NULL,
  INDEX idx_audit_actor_time (actor_id, occurred_at),
  INDEX idx_audit_object (object_type, object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_config_tests (
  id CHAR(36) PRIMARY KEY,
  ai_config_id CHAR(36) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  synthetic_input JSON NOT NULL,
  output JSON NOT NULL,
  safety_check_result VARCHAR(32) NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_ai_config_test_config FOREIGN KEY (ai_config_id) REFERENCES ai_provider_configs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
