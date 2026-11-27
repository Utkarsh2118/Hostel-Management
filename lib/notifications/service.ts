import crypto from 'node:crypto';
import type { AuthUserProfile, Role } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';

export type NotificationCategory = 'BILLING' | 'OPERATIONS' | 'ALLOTMENT' | 'NOTICE' | 'SECURITY';

export interface UserNotification {
  id: string;
  target_student_id: string | null;
  target_role: Role | null;
  category: NotificationCategory;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export type NoticeAudience = 'ALL_HOSTELS' | 'BLOCK_RESIDENTS' | 'MAINTENANCE_ADVISORY';

export interface InstitutionalNotice {
  id: string;
  notice_code: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  block_id: string | null;
  block_name: string;
  pinned: boolean;
  published_by: string;
  published_role: Role;
  created_at: string;
}

export class NotificationError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'NotificationError';
  }
}

/**
 * Phase 5 — Institutional Notifications & Block-Scoped Notice Board Service
 * =========================================================================
 * - Delivers user-isolated in-app notifications (billing, operations, notices).
 * - Enforces strict Warden block scoping when publishing block notices.
 * - Keeps Maintenance Staff isolated from student personal notifications.
 */
export class NotificationAndNoticeService {
  private readonly notifications = new Map<string, UserNotification>();
  private readonly notices = new Map<string, InstitutionalNotice>();
  private noticeSeq = 201;

  constructor(private readonly repo: IHostelRepository) {
    const now = new Date().toISOString();
    const initialNotices: InstitutionalNotice[] = [
      {
        id: 'ntc-seed-001',
        notice_code: 'NTC-2026-101',
        title: 'Autumn 2026 Semester Hostel Fee & Challan Submission Window',
        body: 'Allotted residents must submit their NEFT/IMPS or University Bank Challan reference on the Fee Ledger desk before 31 August 2026. Online payment gateway integration awaits university finance credentials.',
        audience: 'ALL_HOSTELS',
        block_id: null,
        block_name: 'All University Hostels',
        pinned: true,
        published_by: 'admin.demo@hostelhub.local',
        published_role: 'ADMIN',
        created_at: now,
      },
      {
        id: 'ntc-seed-002',
        notice_code: 'NTC-2026-102',
        title: 'Scheduled Overhead Water Tank Cleaning — Nilgiri & Kaveri Blocks',
        body: 'Maintenance crews will clean overhead tanks on Saturday between 10:00 AM and 1:00 PM. Water supply will resume automatically after chlorination verification.',
        audience: 'MAINTENANCE_ADVISORY',
        block_id: 'blk-nilgiri',
        block_name: 'Nilgiri Hall',
        pinned: false,
        published_by: 'warden.demo@hostelhub.local',
        published_role: 'WARDEN',
        created_at: now,
      },
    ];
    for (const n of initialNotices) {
      this.notices.set(n.id, n);
    }
  }

  public notifyStudent(
    studentId: string,
    payload: { category: NotificationCategory; title: string; body: string }
  ): UserNotification {
    const item: UserNotification = {
      id: `notif-${crypto.randomUUID().slice(0, 8)}`,
      target_student_id: studentId,
      target_role: 'STUDENT',
      category: payload.category,
      title: payload.title,
      body: payload.body,
      read: false,
      created_at: new Date().toISOString(),
    };
    this.notifications.set(item.id, item);
    return structuredClone(item);
  }

  public notifyRole(
    role: Role,
    payload: { category: NotificationCategory; title: string; body: string }
  ): UserNotification {
    const item: UserNotification = {
      id: `notif-${crypto.randomUUID().slice(0, 8)}`,
      target_student_id: null,
      target_role: role,
      category: payload.category,
      title: payload.title,
      body: payload.body,
      read: false,
      created_at: new Date().toISOString(),
    };
    this.notifications.set(item.id, item);
    return structuredClone(item);
  }

  public listMyNotifications(actor: AuthUserProfile): UserNotification[] {
    const all = Array.from(this.notifications.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    if (actor.role === 'STUDENT') {
      return all
        .filter((n) => n.target_student_id === actor.student_id)
        .map((n) => structuredClone(n));
    }
    if (actor.role === 'MAINTENANCE_STAFF') {
      return all
        .filter((n) => n.target_role === 'MAINTENANCE_STAFF' && n.target_student_id === null)
        .map((n) => structuredClone(n));
    }
    return all
      .filter((n) => n.target_role === actor.role && n.target_student_id === null)
      .map((n) => structuredClone(n));
  }

  public markNotificationRead(actor: AuthUserProfile, notificationId: string): UserNotification {
    const item = this.notifications.get(notificationId);
    if (!item) {
      throw new NotificationError('Notification not found.', 404);
    }
    if (actor.role === 'STUDENT') {
      if (item.target_student_id !== actor.student_id) {
        throw new NotificationError('Forbidden: You may only update your own notifications.', 403);
      }
    } else if (item.target_role !== actor.role || item.target_student_id !== null) {
      throw new NotificationError('Forbidden: Notification belongs to another recipient.', 403);
    }

    item.read = true;
    return structuredClone(item);
  }

  public markAllRead(actor: AuthUserProfile): number {
    let count = 0;
    for (const item of this.notifications.values()) {
      const owned =
        actor.role === 'STUDENT'
          ? item.target_student_id === actor.student_id
          : item.target_role === actor.role && item.target_student_id === null;
      if (owned && !item.read) {
        item.read = true;
        count += 1;
      }
    }
    return count;
  }

  public async listNotices(actor: AuthUserProfile): Promise<InstitutionalNotice[]> {
    const all = Array.from(this.notices.values()).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.created_at.localeCompare(a.created_at);
    });

    if (actor.role === 'ADMIN') {
      return all.map((n) => structuredClone(n));
    }

    if (actor.role === 'MAINTENANCE_STAFF') {
      return all
        .filter(
          (n) =>
            n.audience === 'ALL_HOSTELS' ||
            (n.audience === 'MAINTENANCE_ADVISORY' &&
              (!n.block_id || canAccessBlock(actor, n.block_id)))
        )
        .map((n) => structuredClone(n));
    }

    if (actor.role === 'WARDEN') {
      return all
        .filter((n) => !n.block_id || canAccessBlock(actor, n.block_id))
        .map((n) => structuredClone(n));
    }

    // STUDENT: campus-wide notices + notices for their allotted block
    let studentBlockId: string | null = null;
    if (actor.student_id) {
      const st = await this.repo.getStudentById(actor.student_id);
      if (st?.allotted_room_id) {
        const rm = await this.repo.getRoomById(st.allotted_room_id);
        studentBlockId = rm?.block_id ?? null;
      }
    }
    return all
      .filter((n) => !n.block_id || n.block_id === studentBlockId)
      .map((n) => structuredClone(n));
  }

  public async publishNotice(
    actor: AuthUserProfile,
    input: {
      title: string;
      body: string;
      audience: NoticeAudience;
      block_id: string | null;
      pinned: boolean;
    }
  ): Promise<InstitutionalNotice> {
    if (actor.role !== 'WARDEN' && actor.role !== 'ADMIN') {
      throw new NotificationError('Only Wardens or Administrators may publish official notices.', 403);
    }

    let blockName = 'All University Hostels';
    if (actor.role === 'WARDEN') {
      if (!input.block_id) {
        throw new NotificationError(
          'Wardens must target one of their assigned hostel blocks (campus-wide notices require Admin authority).',
          403
        );
      }
      if (!canAccessBlock(actor, input.block_id)) {
        throw new NotificationError(
          'Forbidden: You may only publish notices for your assigned hostel blocks.',
          403
        );
      }
    }

    if (input.block_id) {
      const block = await this.repo.getBlockById(input.block_id);
      if (!block) {
        throw new NotificationError(`Hostel block '${input.block_id}' not found.`, 404);
      }
      blockName = block.name;
    }

    const now = new Date().toISOString();
    const id = `ntc-${crypto.randomUUID().slice(0, 8)}`;
    const noticeCode = `NTC-2026-${this.noticeSeq++}`;
    const notice: InstitutionalNotice = {
      id,
      notice_code: noticeCode,
      title: input.title.trim(),
      body: input.body.trim(),
      audience: input.audience,
      block_id: input.block_id,
      block_name: blockName,
      pinned: input.pinned,
      published_by: actor.email,
      published_role: actor.role,
      created_at: now,
    };

    this.notices.set(id, notice);
    await this.repo.appendAuditLog(actor.email, actor.role, 'INSTITUTIONAL_NOTICE_PUBLISHED', {
      notice_id: id,
      notice_code: noticeCode,
      audience: notice.audience,
      block_id: notice.block_id,
    });

    return structuredClone(notice);
  }
}

let sharedNotificationService: NotificationAndNoticeService | null = null;

export function getNotificationService(repo: IHostelRepository): NotificationAndNoticeService {
  if (!sharedNotificationService) {
    sharedNotificationService = new NotificationAndNoticeService(repo);
  }
  return sharedNotificationService;
}
