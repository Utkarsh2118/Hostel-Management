import type { AuthUserProfile, Role } from './roles.ts';

export type Permission =
  // Student permissions
  | 'student:read_own'
  | 'student:update_own'
  | 'allotment:read_own'
  | 'preferences:manage_own'
  | 'swaps:create_own'
  | 'swaps:manage_own'
  | 'rooms:read'
  | 'roommates:read'
  | 'assistant:use'
  // Warden permissions (scoped to assigned hostels/blocks)
  | 'rooms:read_assigned'
  | 'rooms:manage_assigned'
  | 'students:read_assigned'
  | 'swaps:review_assigned'
  | 'complaints:manage_assigned'
  | 'maintenance:assign'
  | 'notices:manage_assigned'
  | 'occupancy:read_assigned'
  | 'reports:read_assigned'
  // Maintenance Staff permissions (strictly scoped to assigned tickets/blocks; zero student PII/finance/allotment access)
  | 'maintenance:read_assigned'
  | 'maintenance:update_assigned'
  | 'maintenance:upload_evidence'
  | 'maintenance:report_parts'
  // Admin permissions (institution-wide)
  | 'students:manage'
  | 'wardens:manage'
  | 'staff:manage'
  | 'roles:manage'
  | 'rooms:manage_all'
  | 'blocks:manage'
  | 'allotment:manage'
  | 'swaps:manage_all'
  | 'maintenance:manage_all'
  | 'analytics:read'
  | 'audit:read'
  | 'settings:manage'
  | 'environment:read';

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  STUDENT: new Set<Permission>([
    'student:read_own',
    'student:update_own',
    'allotment:read_own',
    'preferences:manage_own',
    'swaps:create_own',
    'swaps:manage_own',
    'rooms:read',
    'roommates:read',
    'assistant:use',
  ]),
  WARDEN: new Set<Permission>([
    'rooms:read',
    'rooms:read_assigned',
    'rooms:manage_assigned',
    'students:read_assigned',
    'swaps:review_assigned',
    'complaints:manage_assigned',
    'maintenance:read_assigned',
    'maintenance:assign',
    'maintenance:update_assigned',
    'notices:manage_assigned',
    'occupancy:read_assigned',
    'reports:read_assigned',
    'assistant:use',
  ]),
  MAINTENANCE_STAFF: new Set<Permission>([
    'maintenance:read_assigned',
    'maintenance:update_assigned',
    'maintenance:upload_evidence',
    'maintenance:report_parts',
    'assistant:use',
  ]),
  ADMIN: new Set<Permission>([
    'rooms:read',
    'rooms:read_assigned',
    'rooms:manage_assigned',
    'rooms:manage_all',
    'blocks:manage',
    'students:read_assigned',
    'students:manage',
    'wardens:manage',
    'staff:manage',
    'roles:manage',
    'allotment:manage',
    'swaps:review_assigned',
    'swaps:manage_all',
    'complaints:manage_assigned',
    'maintenance:read_assigned',
    'maintenance:assign',
    'maintenance:update_assigned',
    'maintenance:manage_all',
    'notices:manage_assigned',
    'occupancy:read_assigned',
    'reports:read_assigned',
    'analytics:read',
    'audit:read',
    'settings:manage',
    'environment:read',
    'assistant:use',
  ]),
};

export function hasPermission(
  user: Pick<AuthUserProfile, 'role' | 'status'> | null | undefined,
  permission: Permission
): boolean {
  if (!user || user.status !== 'active') return false;
  return ROLE_PERMISSIONS[user.role].has(permission);
}

export function hasAnyRole(
  user: Pick<AuthUserProfile, 'role' | 'status'> | null | undefined,
  allowedRoles: ReadonlyArray<Role>
): boolean {
  if (!user || user.status !== 'active') return false;
  return allowedRoles.includes(user.role);
}

export function canAccessBlock(
  user: Pick<AuthUserProfile, 'role' | 'status' | 'assigned_block_ids'> | null | undefined,
  blockId: string
): boolean {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'WARDEN' || user.role === 'MAINTENANCE_STAFF') {
    return user.assigned_block_ids.includes(blockId);
  }
  return false;
}

export function canAccessHostel(
  user: Pick<AuthUserProfile, 'role' | 'status' | 'assigned_hostel_ids'> | null | undefined,
  hostelId: string
): boolean {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'WARDEN' || user.role === 'MAINTENANCE_STAFF') {
    return user.assigned_hostel_ids.includes(hostelId);
  }
  return false;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role]);
}
