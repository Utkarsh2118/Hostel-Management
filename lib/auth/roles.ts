export type Role = 'STUDENT' | 'WARDEN' | 'MAINTENANCE_STAFF' | 'ADMIN';

export type AccountStatus = 'active' | 'inactive' | 'pending_verification';

export interface AuthUserProfile {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  student_id: string | null; // Links to Student.id when role === 'STUDENT'
  student_code: string | null; // Allows student login via university student ID
  role: Role;
  status: AccountStatus;
  email_verified: boolean;
  assigned_hostel_ids: string[]; // Explicit hostel scope for WARDEN / MAINTENANCE_STAFF
  assigned_block_ids: string[]; // Non-empty for WARDEN and MAINTENANCE_STAFF accounts
  mfa_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WardenAssignment {
  id: string;
  warden_id: string;
  block_id: string;
  assigned_at: string;
}

export interface MaintenanceStaffAssignment {
  id: string;
  staff_id: string;
  block_id: string;
  assigned_at: string;
}

export interface AdminAuditLog {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  entity_type?: string;
  entity_id?: string | null;
  target_user_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason?: string | null;
  correlation_id?: string | null;
  timestamp: string;
}

export interface SystemSecuritySettings {
  allowed_email_domain: string;
  session_ttl_minutes: number;
  max_failed_login_attempts: number;
  lockout_duration_minutes: number;
  require_admin_mfa: boolean;
}

export const ROLE_DASHBOARD_PATH: Record<Role, string> = {
  STUDENT: '/student',
  WARDEN: '/warden',
  MAINTENANCE_STAFF: '/maintenance',
  ADMIN: '/admin',
};

export function isValidRole(value: unknown): value is Role {
  return (
    value === 'STUDENT' ||
    value === 'WARDEN' ||
    value === 'MAINTENANCE_STAFF' ||
    value === 'ADMIN'
  );
}
