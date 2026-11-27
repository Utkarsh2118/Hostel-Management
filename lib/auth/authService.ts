import crypto from 'node:crypto';
import type { IHostelRepository } from '../repo/interface.ts';
import {
  type AccountStatus,
  type AdminAuditLog,
  type AuthUserProfile,
  type MaintenanceStaffAssignment,
  type Role,
  type SystemSecuritySettings,
  type WardenAssignment,
} from './roles.ts';
import { getPermissionsForRole } from './permissions.ts';
import { SessionStore } from './session.ts';
import type { SessionUser } from '../types.ts';

/**
 * HostelHub Production-Oriented Authentication Service
 * ====================================================
 * - Supports Supabase Auth integration when SUPABASE_URL + SUPABASE_ANON_KEY are configured,
 *   while maintaining a local scrypt-hashed credential store and server-side session manager
 *   so every security invariant works end-to-end without hardcoded production passwords.
 * - Zero hardcoded passwords: reads optional DEMO_*_PASSWORD from process.env, or enters
 *   a one-time locked-after-claim Initial Setup flow so operators/reviewers choose their own
 *   passwords on first boot.
 * - Never trusts client-supplied roles. Roles live strictly in server-side `profiles`.
 */

const GENERIC_AUTH_ERROR = 'Invalid credentials or unauthorized portal access.';

interface InternalCredentialRecord {
  profile: AuthUserProfile;
  passwordHash: string | null; // format: scrypt$saltHex$hashHex
  mfaSecret: string | null; // base32-encoded TOTP secret
}

interface OneTimeTokenRecord {
  tokenHash: string;
  userId: string;
  purpose: 'email_verify' | 'password_reset' | 'account_activation';
  expiresAt: number;
  used: boolean;
}

interface LoginAttemptState {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// RFC 6238 TOTP (30-second window, 6-digit HMAC-SHA1) for Admin MFA
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function computeTotpCode(secret: string, timeMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(timeMs / 1000 / 30) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.max(0, counter)));
  const key = decodeBase32(secret);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return String(code).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string, timeMs = Date.now()): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = computeTotpCode(secret, timeMs, offset);
    if (crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export interface AuthServiceOptions {
  demoAdminPassword?: string;
  demoWardenPassword?: string;
  demoMaintenancePassword?: string;
  demoStudentPassword?: string;
  allowedEmailDomain?: string;
}

export class HostelAuthService {
  private readonly users = new Map<string, InternalCredentialRecord>();
  private readonly wardenAssignments: WardenAssignment[] = [];
  private readonly maintenanceAssignments: MaintenanceStaffAssignment[] = [];
  private readonly adminAuditLogs: AdminAuditLog[] = [];
  private readonly tokens = new Map<string, OneTimeTokenRecord>();
  private readonly loginAttempts = new Map<string, LoginAttemptState>();
  public readonly sessions = new SessionStore();

  private settings: SystemSecuritySettings;
  private initialSetupClaimed = false;

  constructor(options: AuthServiceOptions = {}) {
    const allowedDomain =
      (options.allowedEmailDomain ?? process.env.ALLOWED_EMAIL_DOMAIN ?? 'univ.edu.in')
        .trim()
        .toLowerCase();

    this.settings = {
      allowed_email_domain: allowedDomain,
      session_ttl_minutes: 120,
      max_failed_login_attempts: 5,
      lockout_duration_minutes: 5,
      require_admin_mfa: false,
    };

    const envAdminPwd = (
      options.demoAdminPassword ??
      process.env.DEMO_ADMIN_PASSWORD ??
      process.env.INITIAL_ADMIN_PASSWORD ??
      ''
    ).trim();
    const envWardenPwd = (
      options.demoWardenPassword ??
      process.env.DEMO_WARDEN_PASSWORD ??
      ''
    ).trim();
    const envMaintenancePwd = (
      options.demoMaintenancePassword ??
      process.env.DEMO_MAINTENANCE_PASSWORD ??
      envWardenPwd ??
      ''
    ).trim();
    const envStudentPwd = (
      options.demoStudentPassword ??
      process.env.DEMO_STUDENT_PASSWORD ??
      ''
    ).trim();

    this.seedSyntheticAccounts({
      adminPassword: envAdminPwd || null,
      wardenPassword: envWardenPwd || null,
      maintenancePassword: envMaintenancePwd || null,
      studentPassword: envStudentPwd || null,
    });

    if (envAdminPwd) {
      this.initialSetupClaimed = true;
    }
  }

  public isSupabaseConfigured(): boolean {
    return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_ANON_KEY?.trim());
  }

  public needsInitialSetup(): boolean {
    return !this.initialSetupClaimed;
  }

  public getSecuritySettings(): SystemSecuritySettings {
    return { ...this.settings };
  }

  public updateSecuritySettings(
    actor: AuthUserProfile,
    updates: Partial<SystemSecuritySettings>
  ): SystemSecuritySettings {
    if (actor.role !== 'ADMIN') {
      throw new Error('Only administrators may modify system security settings.');
    }
    const prev = { ...this.settings };
    this.settings = {
      ...this.settings,
      ...updates,
    };
    this.recordAdminAudit(actor, 'SECURITY_SETTINGS_UPDATED', null, prev as unknown as Record<string, unknown>, this.settings as unknown as Record<string, unknown>);
    return { ...this.settings };
  }

  public isUniversityEmailValid(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    const parts = normalized.split('@');
    if (parts.length !== 2 || !parts[0]) return false;
    return (
      parts[1] === this.settings.allowed_email_domain ||
      parts[1] === 'hostelhub.local'
    );
  }

  private seedSyntheticAccounts(passwords: {
    adminPassword: string | null;
    wardenPassword: string | null;
    maintenancePassword: string | null;
    studentPassword: string | null;
  }): void {
    const now = '2026-07-15T09:00:00.000Z';

    // 1. Official Admin Demo Account (password ONLY from env or one-time Initial Setup)
    const adminProfile: AuthUserProfile = {
      id: 'usr-admin-001',
      auth_user_id: 'auth-uuid-admin-001',
      full_name: 'Dr. Rajeev Deshpande',
      email: 'admin.demo@hostelhub.local',
      student_id: null,
      student_code: null,
      role: 'ADMIN',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: [],
      assigned_block_ids: [],
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(adminProfile.id, {
      profile: adminProfile,
      passwordHash: passwords.adminPassword ? hashPassword(passwords.adminPassword) : null,
      mfaSecret: null,
    });

    // 2. Official Warden Demo Account (strictly assigned to Nilgiri & Kaveri Bhavans ONLY)
    const wardenAssignedBlocks = ['blk-nilgiri', 'blk-kaveri'];
    const wardenProfile: AuthUserProfile = {
      id: 'usr-warden-001',
      auth_user_id: 'auth-uuid-warden-001',
      full_name: 'Dr. Sunita Kulkarni',
      email: 'warden.demo@hostelhub.local',
      student_id: null,
      student_code: null,
      role: 'WARDEN',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: ['hst-north'],
      assigned_block_ids: wardenAssignedBlocks,
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(wardenProfile.id, {
      profile: wardenProfile,
      passwordHash: passwords.wardenPassword ? hashPassword(passwords.wardenPassword) : null,
      mfaSecret: null,
    });
    for (const blockId of wardenAssignedBlocks) {
      this.wardenAssignments.push({
        id: `wa-${wardenProfile.id}-${blockId}`,
        warden_id: wardenProfile.id,
        block_id: blockId,
        assigned_at: now,
      });
    }

    // 3. Secondary Warden (Vindhya & Narmada) for multi-warden realism
    const warden2Blocks = ['blk-vindhya', 'blk-narmada'];
    const warden2Profile: AuthUserProfile = {
      id: 'usr-warden-002',
      auth_user_id: 'auth-uuid-warden-002',
      full_name: 'Prof. Arvind Subramanian',
      email: 'arvind.warden@univ.edu.in',
      student_id: null,
      student_code: null,
      role: 'WARDEN',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: ['hst-south'],
      assigned_block_ids: warden2Blocks,
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(warden2Profile.id, {
      profile: warden2Profile,
      passwordHash: passwords.wardenPassword ? hashPassword(passwords.wardenPassword) : null,
      mfaSecret: null,
    });
    for (const blockId of warden2Blocks) {
      this.wardenAssignments.push({
        id: `wa-${warden2Profile.id}-${blockId}`,
        warden_id: warden2Profile.id,
        block_id: blockId,
        assigned_at: now,
      });
    }

    // 4. Maintenance Staff Demo Account (strictly assigned to Nilgiri & Kaveri Bhavans)
    const maintBlocks = ['blk-nilgiri', 'blk-kaveri'];
    const maintProfile: AuthUserProfile = {
      id: 'usr-maint-001',
      auth_user_id: 'auth-uuid-maint-001',
      full_name: 'Ramesh Nair (Estate Electrician)',
      email: 'maintenance.demo@hostelhub.local',
      student_id: null,
      student_code: null,
      role: 'MAINTENANCE_STAFF',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: ['hst-north'],
      assigned_block_ids: maintBlocks,
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(maintProfile.id, {
      profile: maintProfile,
      passwordHash: passwords.maintenancePassword ? hashPassword(passwords.maintenancePassword) : null,
      mfaSecret: null,
    });
    for (const blockId of maintBlocks) {
      this.maintenanceAssignments.push({
        id: `ma-${maintProfile.id}-${blockId}`,
        staff_id: maintProfile.id,
        block_id: blockId,
        assigned_at: now,
      });
    }

    // 5. Secondary Maintenance Staff (Vindhya & Narmada) for cross-block isolation tests
    const maint2Blocks = ['blk-vindhya', 'blk-narmada'];
    const maint2Profile: AuthUserProfile = {
      id: 'usr-maint-002',
      auth_user_id: 'auth-uuid-maint-002',
      full_name: 'Prakash Verma (Carpentry & Civil)',
      email: 'prakash.maint@univ.edu.in',
      student_id: null,
      student_code: null,
      role: 'MAINTENANCE_STAFF',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: ['hst-south'],
      assigned_block_ids: maint2Blocks,
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(maint2Profile.id, {
      profile: maint2Profile,
      passwordHash: passwords.maintenancePassword ? hashPassword(passwords.maintenancePassword) : null,
      mfaSecret: null,
    });
    for (const blockId of maint2Blocks) {
      this.maintenanceAssignments.push({
        id: `ma-${maint2Profile.id}-${blockId}`,
        staff_id: maint2Profile.id,
        block_id: blockId,
        assigned_at: now,
      });
    }

    // 6. Synthetic Student Demo Account (linked to stu-001 Rohan Kulkarni)
    const studentProfile: AuthUserProfile = {
      id: 'usr-student-001',
      auth_user_id: 'auth-uuid-student-001',
      full_name: 'Rohan Kulkarni',
      email: 'student.demo@hostelhub.local',
      student_id: 'stu-001',
      student_code: 'VV2024CO101',
      role: 'STUDENT',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: [],
      assigned_block_ids: [],
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(studentProfile.id, {
      profile: studentProfile,
      passwordHash: passwords.studentPassword ? hashPassword(passwords.studentPassword) : null,
      mfaSecret: null,
    });

    // 7. Secondary Student Demo Account (linked to stu-151 Ananya Iyer)
    const student2Profile: AuthUserProfile = {
      id: 'usr-student-151',
      auth_user_id: 'auth-uuid-student-151',
      full_name: 'Ananya Iyer',
      email: 'ananya.iyer@univ.edu.in',
      student_id: 'stu-151',
      student_code: 'VV2024MA251',
      role: 'STUDENT',
      status: 'active',
      email_verified: true,
      assigned_hostel_ids: [],
      assigned_block_ids: [],
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };
    this.users.set(student2Profile.id, {
      profile: student2Profile,
      passwordHash: passwords.studentPassword ? hashPassword(passwords.studentPassword) : null,
      mfaSecret: null,
    });

    this.adminAuditLogs.push({
      id: 'aaud-001',
      actor_id: 'system',
      actor_email: 'system@hostelhub.local',
      action: 'INITIAL_STAFF_ASSIGNMENTS_SEEDED',
      entity_type: 'role_assignments',
      entity_id: wardenProfile.id,
      target_user_id: wardenProfile.id,
      previous_value: null,
      new_value: {
        warden_blocks: wardenAssignedBlocks,
        maintenance_blocks: maintBlocks,
      },
      timestamp: now,
    });
  }

  /**
   * One-time controlled initial setup for local development/preview when env passwords
   * are not yet configured. Locks itself atomically on completion.
   */
  public claimInitialSetup(params: {
    adminPassword: string;
    wardenPassword: string;
    maintenancePassword?: string;
    studentPassword: string;
  }): {
    claimed: boolean;
    accounts: Array<{ role: Role; email: string; student_code?: string }>;
  } {
    if (this.initialSetupClaimed) {
      throw new Error('Initial campus setup has already been completed and is permanently locked.');
    }

    const effectiveMaintPassword = params.maintenancePassword || params.wardenPassword;
    const adminRec = this.users.get('usr-admin-001');
    const wardenRec = this.users.get('usr-warden-001');
    const warden2Rec = this.users.get('usr-warden-002');
    const maintRec = this.users.get('usr-maint-001');
    const maint2Rec = this.users.get('usr-maint-002');
    const studentRec = this.users.get('usr-student-001');
    const student2Rec = this.users.get('usr-student-151');

    if (adminRec) adminRec.passwordHash = hashPassword(params.adminPassword);
    if (wardenRec) wardenRec.passwordHash = hashPassword(params.wardenPassword);
    if (warden2Rec) warden2Rec.passwordHash = hashPassword(params.wardenPassword);
    if (maintRec) maintRec.passwordHash = hashPassword(effectiveMaintPassword);
    if (maint2Rec) maint2Rec.passwordHash = hashPassword(effectiveMaintPassword);
    if (studentRec) studentRec.passwordHash = hashPassword(params.studentPassword);
    if (student2Rec) student2Rec.passwordHash = hashPassword(params.studentPassword);

    this.initialSetupClaimed = true;

    this.adminAuditLogs.unshift({
      id: `aaud-${crypto.randomUUID().slice(0, 8)}`,
      actor_id: 'usr-admin-001',
      actor_email: 'admin.demo@hostelhub.local',
      action: 'INITIAL_SETUP_CLAIMED',
      entity_type: 'system_bootstrap',
      entity_id: 'usr-admin-001',
      target_user_id: 'usr-admin-001',
      previous_value: { initialized: false },
      new_value: { initialized: true },
      timestamp: new Date().toISOString(),
    });

    return {
      claimed: true,
      accounts: [
        { role: 'ADMIN', email: 'admin.demo@hostelhub.local' },
        { role: 'WARDEN', email: 'warden.demo@hostelhub.local' },
        { role: 'MAINTENANCE_STAFF', email: 'maintenance.demo@hostelhub.local' },
        {
          role: 'STUDENT',
          email: 'student.demo@hostelhub.local',
          student_code: 'VV2024CO101',
        },
      ],
    };
  }

  private findByIdentifier(identifier: string, portalRole: Role): InternalCredentialRecord | null {
    const clean = identifier.trim().toLowerCase();
    for (const rec of this.users.values()) {
      if (rec.profile.email.toLowerCase() === clean) {
        return rec;
      }
      if (
        portalRole === 'STUDENT' &&
        rec.profile.student_code &&
        rec.profile.student_code.toLowerCase() === clean
      ) {
        return rec;
      }
    }
    return null;
  }

  private getAttemptKey(identifier: string, ip: string): string {
    return `${identifier.trim().toLowerCase()}::${ip}`;
  }

  private recordFailedAttempt(key: string, nowMs: number): void {
    const existing = this.loginAttempts.get(key) ?? {
      failures: 0,
      lockedUntil: 0,
      lastFailureAt: 0,
    };
    const nextFailures = existing.failures + 1;
    const lockedUntil =
      nextFailures >= this.settings.max_failed_login_attempts
        ? nowMs + this.settings.lockout_duration_minutes * 60 * 1000
        : 0;
    this.loginAttempts.set(key, {
      failures: nextFailures,
      lockedUntil,
      lastFailureAt: nowMs,
    });
  }

  public getUserProfileById(userId: string): AuthUserProfile | null {
    const rec = this.users.get(userId);
    return rec ? structuredClone(rec.profile) : null;
  }

  public toSessionUser(profile: AuthUserProfile): SessionUser {
    return {
      id: profile.id,
      role: profile.role,
      name: profile.full_name,
      email: profile.email,
      student_id: profile.student_id,
      student_code: profile.student_code,
      assigned_hostel_ids: [...profile.assigned_hostel_ids],
      assigned_block_ids: [...profile.assigned_block_ids],
      mfa_enabled: profile.mfa_enabled,
      permissions: getPermissionsForRole(profile.role),
    };
  }

  /**
   * Authenticates a user against the requested login portal role.
   * CRITICAL: `loginPortalRole` NEVER grants a role; it only verifies that the
   * user's server-stored role matches the selected login portal.
   */
  public async login(params: {
    identifier: string;
    password: string;
    loginPortalRole: Role;
    mfaCode?: string;
    ip?: string;
    nowMs?: number;
  }): Promise<
    | { ok: true; user: AuthUserProfile; cookieValue: string; maxAgeSeconds: number }
    | { ok: false; mfaRequired?: boolean; locked?: boolean; statusCode: number; error: string }
  > {
    const nowMs = params.nowMs ?? Date.now();
    const ip = params.ip ?? 'local';
    const attemptKey = this.getAttemptKey(params.identifier, ip);
    const attemptState = this.loginAttempts.get(attemptKey);

    if (attemptState && attemptState.lockedUntil > nowMs) {
      const waitMins = Math.max(1, Math.ceil((attemptState.lockedUntil - nowMs) / 60000));
      return {
        ok: false,
        locked: true,
        statusCode: 429,
        error: `Too many failed sign-in attempts. Please wait ${waitMins} minute(s) before trying again.`,
      };
    }

    const record = this.findByIdentifier(params.identifier, params.loginPortalRole);
    const passwordValid = record ? verifyPassword(params.password, record.passwordHash) : false;

    // Constant generic denial if account missing, password wrong, inactive, or role mismatches portal
    if (
      !record ||
      !passwordValid ||
      record.profile.status !== 'active' ||
      !record.profile.email_verified ||
      record.profile.role !== params.loginPortalRole
    ) {
      this.recordFailedAttempt(attemptKey, nowMs);
      if (record && record.profile.role !== params.loginPortalRole) {
        this.adminAuditLogs.unshift({
          id: `aaud-${crypto.randomUUID().slice(0, 8)}`,
          actor_id: record.profile.id,
          actor_email: record.profile.email,
          action: 'LOGIN_PORTAL_ROLE_MISMATCH',
          target_user_id: record.profile.id,
          previous_value: { assigned_role: record.profile.role },
          new_value: { attempted_portal: params.loginPortalRole },
          timestamp: new Date(nowMs).toISOString(),
        });
      }
      return {
        ok: false,
        statusCode: 401,
        error: GENERIC_AUTH_ERROR,
      };
    }

    // Admin MFA verification when configured on the account
    if (record.profile.role === 'ADMIN' && record.profile.mfa_enabled && record.mfaSecret) {
      if (!params.mfaCode) {
        return {
          ok: false,
          mfaRequired: true,
          statusCode: 200,
          error: 'Enter your 6-digit authenticator verification code to complete Admin sign-in.',
        };
      }
      if (!verifyTotpCode(record.mfaSecret, params.mfaCode, nowMs)) {
        this.recordFailedAttempt(attemptKey, nowMs);
        return {
          ok: false,
          mfaRequired: true,
          statusCode: 401,
          error: 'Invalid verification code. Please check your authenticator app and try again.',
        };
      }
    }

    // Clear failed attempts on success
    this.loginAttempts.delete(attemptKey);

    const ttlMinutes = this.settings.session_ttl_minutes;
    const { cookieValue } = this.sessions.createSession(
      record.profile.id,
      ttlMinutes,
      true,
      nowMs
    );

    if (
      record.profile.role === 'ADMIN' ||
      record.profile.role === 'WARDEN' ||
      record.profile.role === 'MAINTENANCE_STAFF'
    ) {
      this.adminAuditLogs.unshift({
        id: `aaud-${crypto.randomUUID().slice(0, 8)}`,
        actor_id: record.profile.id,
        actor_email: record.profile.email,
        action: `${record.profile.role}_LOGIN_SUCCESS`,
        entity_type: 'auth_session',
        entity_id: record.profile.id,
        target_user_id: record.profile.id,
        previous_value: null,
        new_value: { role: record.profile.role },
        timestamp: new Date(nowMs).toISOString(),
      });
    }

    return {
      ok: true,
      user: structuredClone(record.profile),
      cookieValue,
      maxAgeSeconds: ttlMinutes * 60,
    };
  }

  /**
   * Public student-only registration.
   * Server ALWAYS forces role = 'STUDENT' regardless of any extra request fields.
   */
  public async registerStudent(
    params: {
      fullName: string;
      email: string;
      studentCode: string;
      password: string;
      year: 1 | 2 | 3 | 4;
      branch: string;
      gender: 'male' | 'female';
    },
    repo: IHostelRepository
  ): Promise<{ profile: AuthUserProfile; verificationToken: string }> {
    const email = params.email.trim().toLowerCase();
    const studentCode = params.studentCode.trim().toUpperCase();

    if (!this.isUniversityEmailValid(email)) {
      throw new Error(
        `Student registration requires an official @${this.settings.allowed_email_domain} email address.`
      );
    }

    for (const rec of this.users.values()) {
      if (rec.profile.email.toLowerCase() === email) {
        throw new Error('An account with this university email already exists.');
      }
      if (rec.profile.student_code?.toUpperCase() === studentCode) {
        throw new Error('This student ID is already registered.');
      }
    }

    const existingStudents = await repo.getStudents();
    const matchedSeedStudent = existingStudents.find(
      (s) => s.student_code.toUpperCase() === studentCode
    );

    const now = new Date().toISOString();
    const userId = `usr-stu-${crypto.randomUUID().slice(0, 8)}`;
    const linkedStudentId = matchedSeedStudent?.id ?? `stu-reg-${crypto.randomUUID().slice(0, 6)}`;

    // If not already in the hostel repository, create the Student record cleanly
    if (!matchedSeedStudent && 'createStudentRecord' in repo) {
      const creator = repo as IHostelRepository & {
        createStudentRecord?: (input: {
          id: string;
          student_code: string;
          name: string;
          email: string;
          year: 1 | 2 | 3 | 4;
          branch: string;
          gender: 'male' | 'female';
        }) => Promise<unknown>;
      };
      if (creator.createStudentRecord) {
        await creator.createStudentRecord({
          id: linkedStudentId,
          student_code: studentCode,
          name: params.fullName.trim(),
          email,
          year: params.year,
          branch: params.branch,
          gender: params.gender,
        });
      }
    }

    const profile: AuthUserProfile = {
      id: userId,
      auth_user_id: `auth-uuid-${crypto.randomUUID().slice(0, 8)}`,
      full_name: params.fullName.trim(),
      email,
      student_id: linkedStudentId,
      student_code: studentCode,
      role: 'STUDENT', // Hardcoded server-side — never client-selectable
      status: 'pending_verification',
      email_verified: false,
      assigned_hostel_ids: [],
      assigned_block_ids: [],
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };

    this.users.set(profile.id, {
      profile,
      passwordHash: hashPassword(params.password),
      mfaSecret: null,
    });

    const rawToken = crypto.randomBytes(24).toString('base64url');
    this.tokens.set(sha256Hex(rawToken), {
      tokenHash: sha256Hex(rawToken),
      userId: profile.id,
      purpose: 'email_verify',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      used: false,
    });

    return {
      profile: structuredClone(profile),
      verificationToken: rawToken,
    };
  }

  public verifyEmailToken(rawToken: string): AuthUserProfile {
    const hashed = sha256Hex(rawToken.trim());
    const rec = this.tokens.get(hashed);
    if (!rec || rec.used || rec.purpose !== 'email_verify' || rec.expiresAt <= Date.now()) {
      throw new Error('This verification link is invalid or has expired.');
    }
    const userRec = this.users.get(rec.userId);
    if (!userRec) {
      throw new Error('Account no longer exists.');
    }
    rec.used = true;
    userRec.profile.email_verified = true;
    userRec.profile.status = 'active';
    userRec.profile.updated_at = new Date().toISOString();
    return structuredClone(userRec.profile);
  }

  /**
   * Password Reset Flow:
   * Always responds neutrally to avoid account enumeration.
   * Returns `devResetToken` strictly for local development preview when no SMTP provider is attached.
   */
  public requestPasswordReset(email: string): {
    message: string;
    devResetToken?: string;
  } {
    const clean = email.trim().toLowerCase();
    let matchedUser: InternalCredentialRecord | null = null;
    for (const rec of this.users.values()) {
      if (rec.profile.email.toLowerCase() === clean && rec.profile.status === 'active') {
        matchedUser = rec;
        break;
      }
    }

    let devResetToken: string | undefined;
    if (matchedUser) {
      const rawToken = crypto.randomBytes(24).toString('base64url');
      this.tokens.set(sha256Hex(rawToken), {
        tokenHash: sha256Hex(rawToken),
        userId: matchedUser.profile.id,
        purpose: 'password_reset',
        expiresAt: Date.now() + 15 * 60 * 1000,
        used: false,
      });
      if (process.env.NODE_ENV !== 'production') {
        devResetToken = rawToken;
      }
    }

    return {
      message:
        'If an active HostelHub account matches that email, a single-use password reset link has been generated (valid for 15 minutes).',
      ...(devResetToken ? { devResetToken } : {}),
    };
  }

  public completePasswordReset(rawToken: string, newPassword: string): void {
    const hashed = sha256Hex(rawToken.trim());
    const rec = this.tokens.get(hashed);
    if (
      !rec ||
      rec.used ||
      (rec.purpose !== 'password_reset' && rec.purpose !== 'account_activation') ||
      rec.expiresAt <= Date.now()
    ) {
      throw new Error('Reset or activation token is invalid or has expired.');
    }
    const userRec = this.users.get(rec.userId);
    if (!userRec) {
      throw new Error('Account not found.');
    }

    rec.used = true;
    userRec.passwordHash = hashPassword(newPassword);
    userRec.profile.email_verified = true;
    if (userRec.profile.status === 'pending_verification') {
      userRec.profile.status = 'active';
    }
    userRec.profile.updated_at = new Date().toISOString();

    // Immediately invalidate all existing sessions for security
    this.sessions.revokeAllForUser(userRec.profile.id);

    this.adminAuditLogs.unshift({
      id: `aaud-${crypto.randomUUID().slice(0, 8)}`,
      actor_id: userRec.profile.id,
      actor_email: userRec.profile.email,
      action:
        rec.purpose === 'account_activation'
          ? 'ACCOUNT_ACTIVATED_PASSWORD_SET'
          : 'PASSWORD_RESET_COMPLETED',
      target_user_id: userRec.profile.id,
      previous_value: null,
      new_value: { sessions_revoked: true },
      timestamp: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Admin-Only Account Provisioning, Role Governance & MFA Management
  // ---------------------------------------------------------------------------
  public listAllAccounts(actor: AuthUserProfile): AuthUserProfile[] {
    if (actor.role !== 'ADMIN') {
      throw new Error('Administrator authorization required to list accounts.');
    }
    return Array.from(this.users.values())
      .map((r) => structuredClone(r.profile))
      .sort((a, b) => a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name));
  }

  public provisionStaffAccount(
    actor: AuthUserProfile,
    params: {
      fullName: string;
      email: string;
      role: 'WARDEN' | 'MAINTENANCE_STAFF' | 'ADMIN';
      assignedBlockIds: string[];
      validBlockIds: Set<string>;
      initialPassword?: string;
    }
  ): { profile: AuthUserProfile; activationToken: string } {
    if (actor.role !== 'ADMIN') {
      throw new Error(
        'Only an authorized administrator can provision Warden, Maintenance Staff, or Admin accounts.'
      );
    }

    const email = params.email.trim().toLowerCase();
    for (const rec of this.users.values()) {
      if (rec.profile.email.toLowerCase() === email) {
        throw new Error('An account with this email already exists.');
      }
    }

    const requiresBlocks = params.role === 'WARDEN' || params.role === 'MAINTENANCE_STAFF';
    if (requiresBlocks) {
      if (params.assignedBlockIds.length === 0) {
        throw new Error(`${params.role} accounts must be assigned to at least one hostel block.`);
      }
      for (const bid of params.assignedBlockIds) {
        if (!params.validBlockIds.has(bid)) {
          throw new Error(`Invalid hostel block ID: ${bid}`);
        }
      }
    }

    const now = new Date().toISOString();
    const id = `usr-${params.role.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
    const assigned = requiresBlocks ? Array.from(new Set(params.assignedBlockIds)) : [];

    const profile: AuthUserProfile = {
      id,
      auth_user_id: `auth-uuid-${crypto.randomUUID().slice(0, 8)}`,
      full_name: params.fullName.trim(),
      email,
      student_id: null,
      student_code: null,
      role: params.role,
      status: params.initialPassword ? 'active' : 'pending_verification',
      email_verified: Boolean(params.initialPassword),
      assigned_hostel_ids: assigned.length > 0 ? ['hst-north'] : [],
      assigned_block_ids: assigned,
      mfa_enabled: false,
      created_at: now,
      updated_at: now,
    };

    this.users.set(id, {
      profile,
      passwordHash: params.initialPassword ? hashPassword(params.initialPassword) : null,
      mfaSecret: null,
    });

    for (const bid of assigned) {
      if (params.role === 'WARDEN') {
        this.wardenAssignments.push({
          id: `wa-${id}-${bid}`,
          warden_id: id,
          block_id: bid,
          assigned_at: now,
        });
      } else if (params.role === 'MAINTENANCE_STAFF') {
        this.maintenanceAssignments.push({
          id: `ma-${id}-${bid}`,
          staff_id: id,
          block_id: bid,
          assigned_at: now,
        });
      }
    }

    const rawActivationToken = crypto.randomBytes(24).toString('base64url');
    this.tokens.set(sha256Hex(rawActivationToken), {
      tokenHash: sha256Hex(rawActivationToken),
      userId: id,
      purpose: 'account_activation',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      used: false,
    });

    this.recordAdminAudit(
      actor,
      `PROVISIONED_${params.role}_ACCOUNT`,
      id,
      null,
      { email, role: params.role, assigned_block_ids: assigned }
    );

    return {
      profile: structuredClone(profile),
      activationToken: rawActivationToken,
    };
  }

  public listMaintenanceStaffForBlock(blockId: string): Array<{ id: string; full_name: string; email: string }> {
    const staff: Array<{ id: string; full_name: string; email: string }> = [];
    for (const rec of this.users.values()) {
      if (
        rec.profile.role === 'MAINTENANCE_STAFF' &&
        rec.profile.status === 'active' &&
        rec.profile.assigned_block_ids.includes(blockId)
      ) {
        staff.push({
          id: rec.profile.id,
          full_name: rec.profile.full_name,
          email: rec.profile.email,
        });
      }
    }
    return staff;
  }

  public updateAccountAccess(
    actor: AuthUserProfile,
    targetUserId: string,
    updates: {
      role?: Role;
      status?: AccountStatus;
      assigned_block_ids?: string[];
    },
    validBlockIds: Set<string>
  ): AuthUserProfile {
    if (actor.role !== 'ADMIN') {
      throw new Error('Only administrators may modify account roles or status.');
    }

    const targetRec = this.users.get(targetUserId);
    if (!targetRec) {
      throw new Error('Target user account not found.');
    }

    // Security boundary: never allow any user (even an admin) to alter their own role or deactivate themselves
    if (actor.id === targetUserId) {
      if (updates.role !== undefined && updates.role !== targetRec.profile.role) {
        throw new Error('You cannot modify your own role. Another administrator must perform this change.');
      }
      if (updates.status !== undefined && updates.status !== 'active') {
        throw new Error('You cannot deactivate your own active administrator account.');
      }
    }

    const prevSnapshot = {
      role: targetRec.profile.role,
      status: targetRec.profile.status,
      assigned_block_ids: [...targetRec.profile.assigned_block_ids],
    };

    const nextRole = updates.role ?? targetRec.profile.role;
    const nextStatus = updates.status ?? targetRec.profile.status;
    let nextBlocks =
      updates.assigned_block_ids !== undefined
        ? Array.from(new Set(updates.assigned_block_ids))
        : targetRec.profile.assigned_block_ids;

    const requiresBlocks = nextRole === 'WARDEN' || nextRole === 'MAINTENANCE_STAFF';
    if (requiresBlocks) {
      if (nextBlocks.length === 0) {
        throw new Error(`${nextRole} accounts require at least one assigned hostel block.`);
      }
      for (const bid of nextBlocks) {
        if (!validBlockIds.has(bid)) {
          throw new Error(`Unknown hostel block '${bid}'.`);
        }
      }
    } else {
      nextBlocks = [];
    }

    targetRec.profile.role = nextRole;
    targetRec.profile.status = nextStatus;
    targetRec.profile.assigned_block_ids = nextBlocks;
    targetRec.profile.updated_at = new Date().toISOString();

    // Sync warden_assignments & maintenance_staff_assignments tables
    for (let i = this.wardenAssignments.length - 1; i >= 0; i -= 1) {
      if (this.wardenAssignments[i].warden_id === targetUserId) {
        this.wardenAssignments.splice(i, 1);
      }
    }
    for (let i = this.maintenanceAssignments.length - 1; i >= 0; i -= 1) {
      if (this.maintenanceAssignments[i].staff_id === targetUserId) {
        this.maintenanceAssignments.splice(i, 1);
      }
    }
    const now = new Date().toISOString();
    for (const bid of nextBlocks) {
      if (nextRole === 'WARDEN') {
        this.wardenAssignments.push({
          id: `wa-${targetUserId}-${bid}`,
          warden_id: targetUserId,
          block_id: bid,
          assigned_at: now,
        });
      } else if (nextRole === 'MAINTENANCE_STAFF') {
        this.maintenanceAssignments.push({
          id: `ma-${targetUserId}-${bid}`,
          staff_id: targetUserId,
          block_id: bid,
          assigned_at: now,
        });
      }
    }

    // Revoke sessions if deactivated or role changed
    if (nextStatus !== 'active' || nextRole !== prevSnapshot.role) {
      this.sessions.revokeAllForUser(targetUserId);
    }

    this.recordAdminAudit(actor, 'ACCOUNT_ACCESS_UPDATED', targetUserId, prevSnapshot, {
      role: nextRole,
      status: nextStatus,
      assigned_block_ids: nextBlocks,
    });

    return structuredClone(targetRec.profile);
  }

  public beginAdminMfaSetup(actor: AuthUserProfile): {
    secret: string;
    otpauthUri: string;
  } {
    if (actor.role !== 'ADMIN') {
      throw new Error('MFA setup is restricted to Administrator accounts.');
    }
    const rec = this.users.get(actor.id);
    if (!rec) throw new Error('Account not found.');
    const secret = generateTotpSecret();
    rec.mfaSecret = secret;
    return {
      secret,
      otpauthUri: `otpauth://totp/HostelHub:${encodeURIComponent(actor.email)}?secret=${secret}&issuer=HostelHub`,
    };
  }

  public confirmAdminMfaSetup(actor: AuthUserProfile, code: string): AuthUserProfile {
    if (actor.role !== 'ADMIN') {
      throw new Error('MFA verification is restricted to Administrator accounts.');
    }
    const rec = this.users.get(actor.id);
    if (!rec || !rec.mfaSecret) {
      throw new Error('Start MFA setup first to generate a secret.');
    }
    if (!verifyTotpCode(rec.mfaSecret, code)) {
      throw new Error('Verification code did not match. Ensure device clock is synced.');
    }
    rec.profile.mfa_enabled = true;
    rec.profile.updated_at = new Date().toISOString();
    this.recordAdminAudit(actor, 'ADMIN_MFA_ENABLED', actor.id, { mfa_enabled: false }, { mfa_enabled: true });
    return structuredClone(rec.profile);
  }

  public disableAdminMfa(actor: AuthUserProfile): AuthUserProfile {
    if (actor.role !== 'ADMIN') {
      throw new Error('Administrator privileges required.');
    }
    const rec = this.users.get(actor.id);
    if (!rec) throw new Error('Account not found.');
    rec.profile.mfa_enabled = false;
    rec.mfaSecret = null;
    rec.profile.updated_at = new Date().toISOString();
    this.recordAdminAudit(actor, 'ADMIN_MFA_DISABLED', actor.id, { mfa_enabled: true }, { mfa_enabled: false });
    return structuredClone(rec.profile);
  }

  public getAdminAuditLogs(actor: AuthUserProfile, limit = 100): AdminAuditLog[] {
    if (actor.role !== 'ADMIN') {
      throw new Error('Administrator privileges required to view security audit logs.');
    }
    return structuredClone(this.adminAuditLogs.slice(0, limit));
  }

  public purgeExpiredAuthArtifacts(nowMs = Date.now()): {
    expired_sessions_purged: number;
    expired_tokens_purged: number;
    active_sessions: number;
  } {
    const expired_sessions_purged = this.sessions.purgeExpiredSessions(nowMs);
    let expired_tokens_purged = 0;
    for (const [key, rec] of this.tokens.entries()) {
      if (rec.used || rec.expiresAt <= nowMs) {
        this.tokens.delete(key);
        expired_tokens_purged += 1;
      }
    }
    return {
      expired_sessions_purged,
      expired_tokens_purged,
      active_sessions: this.sessions.getActiveSessionCount(nowMs),
    };
  }

  public revokeAllNonAdminSessions(
    actor: AuthUserProfile,
    reason: string
  ): { revoked_count: number; remaining_active_sessions: number } {
    if (actor.role !== 'ADMIN') {
      throw new Error('Only Administrators may execute an emergency global session revocation.');
    }
    const adminIds = new Set<string>();
    for (const rec of this.users.values()) {
      if (rec.profile.role === 'ADMIN') {
        adminIds.add(rec.profile.id);
      }
    }
    const revoked_count = this.sessions.revokeAllExceptUserIds(adminIds);
    this.recordAdminAudit(actor, 'EMERGENCY_GLOBAL_SESSION_REVOCATION', null, null, {
      revoked_sessions: revoked_count,
      reason: reason.trim(),
    });
    return {
      revoked_count,
      remaining_active_sessions: this.sessions.getActiveSessionCount(),
    };
  }

  private recordAdminAudit(
    actor: AuthUserProfile,
    action: string,
    targetUserId: string | null,
    previousValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null
  ): void {
    this.adminAuditLogs.unshift({
      id: `aaud-${crypto.randomUUID().slice(0, 8)}`,
      actor_id: actor.id,
      actor_email: actor.email,
      action,
      target_user_id: targetUserId,
      previous_value: previousValue,
      new_value: newValue,
      timestamp: new Date().toISOString(),
    });
  }
}

let sharedAuthService: HostelAuthService | null = null;

export function getAuthService(): HostelAuthService {
  if (!sharedAuthService) {
    sharedAuthService = new HostelAuthService();
  }
  return sharedAuthService;
}
