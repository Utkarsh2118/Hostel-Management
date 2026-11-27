import crypto from 'node:crypto';
import type { AuthUserProfile } from '../auth/roles.ts';
import type {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTask,
} from '../types.ts';

/**
 * Strictly Scoped Maintenance Task Service (Phase 1 Foundation)
 * =============================================================
 * Security & Data Minimization Invariant:
 * - Maintenance staff ONLY see tasks explicitly assigned to their account (`assigned_to_id === user.id`)
 *   within their assigned hostel blocks.
 * - Maintenance task records intentionally exclude all student PII, academic records (CGPA/branch),
 *   identity documents, and financial/invoice data.
 * - Wardens see and assign tasks only within their assigned hostel blocks.
 * - Admins have institution-wide oversight.
 */
export class MaintenanceTaskService {
  private readonly tasks: MaintenanceTask[] = [];

  constructor() {
    this.seedSyntheticTasks();
  }

  private seedSyntheticTasks(): void {
    const baseTime = '2026-07-18T08:30:00.000Z';
    this.tasks.push(
      {
        id: 'mt-001',
        ticket_code: 'MNT-2026-101',
        block_id: 'blk-nilgiri',
        block_name: 'Nilgiri Bhavan',
        floor: 2,
        room_number: 'N-204',
        category: 'electrical',
        priority: 'high',
        status: 'assigned',
        summary: 'Ceiling fan regulator sparking at speed 3 and desk socket loose',
        location_detail: 'North Wing, Floor 2, Room N-204',
        assigned_to_id: 'usr-maint-001',
        assigned_to_name: 'Ramesh Nair (Estate Electrician)',
        evidence_reference: null,
        parts_needed: null,
        work_notes: [
          {
            id: 'mwn-001',
            author_name: 'Dr. Sunita Kulkarni',
            author_role: 'WARDEN',
            note: 'Assigned for priority inspection before evening study hours.',
            parts_reported: null,
            timestamp: baseTime,
          },
        ],
        created_at: baseTime,
        updated_at: baseTime,
        completed_at: null,
      },
      {
        id: 'mt-002',
        ticket_code: 'MNT-2026-102',
        block_id: 'blk-kaveri',
        block_name: 'Kaveri Bhavan',
        floor: 1,
        room_number: 'K-108',
        category: 'plumbing',
        priority: 'medium',
        status: 'in_progress',
        summary: 'Washbasin drain pipe slow leak inside corridor utility shaft',
        location_detail: 'East Wing, Floor 1, Adjacent to Room K-108',
        assigned_to_id: 'usr-maint-001',
        assigned_to_name: 'Ramesh Nair (Estate Electrician)',
        evidence_reference: 'inspection-log-k108-initial',
        parts_needed: '40mm PVC trap gasket',
        work_notes: [
          {
            id: 'mwn-002',
            author_name: 'Ramesh Nair (Estate Electrician)',
            author_role: 'MAINTENANCE_STAFF',
            note: 'Isolated angle valve; awaiting 40mm trap gasket from central stores.',
            parts_reported: '40mm PVC trap gasket',
            timestamp: '2026-07-18T11:15:00.000Z',
          },
        ],
        created_at: baseTime,
        updated_at: '2026-07-18T11:15:00.000Z',
        completed_at: null,
      },
      {
        id: 'mt-003',
        ticket_code: 'MNT-2026-103',
        block_id: 'blk-vindhya',
        block_name: 'Vindhya Bhavan',
        floor: 3,
        room_number: 'V-312',
        category: 'furniture',
        priority: 'low',
        status: 'assigned',
        summary: 'Study desk drawer rail detached and wardrobe latch misaligned',
        location_detail: 'South Wing, Floor 3, Room V-312',
        assigned_to_id: 'usr-maint-002',
        assigned_to_name: 'Prakash Verma (Carpentry & Civil)',
        evidence_reference: null,
        parts_needed: null,
        work_notes: [],
        created_at: baseTime,
        updated_at: baseTime,
        completed_at: null,
      },
      {
        id: 'mt-004',
        ticket_code: 'MNT-2026-104',
        block_id: 'blk-nilgiri',
        block_name: 'Nilgiri Bhavan',
        floor: 1,
        room_number: 'N-102',
        category: 'safety',
        priority: 'medium',
        status: 'resolved',
        summary: 'Corridor emergency exit tube light ballast replaced and tested',
        location_detail: 'North Wing, Floor 1, Stairwell B',
        assigned_to_id: 'usr-maint-001',
        assigned_to_name: 'Ramesh Nair (Estate Electrician)',
        evidence_reference: 'completion-photo-n102-exitlight',
        parts_needed: null,
        work_notes: [
          {
            id: 'mwn-003',
            author_name: 'Ramesh Nair (Estate Electrician)',
            author_role: 'MAINTENANCE_STAFF',
            note: 'Replaced LED driver and verified backup battery switchover.',
            parts_reported: null,
            timestamp: '2026-07-17T16:40:00.000Z',
          },
        ],
        created_at: '2026-07-17T09:00:00.000Z',
        updated_at: '2026-07-17T16:40:00.000Z',
        completed_at: '2026-07-17T16:40:00.000Z',
      }
    );
  }

  public listTasksForUser(user: AuthUserProfile): MaintenanceTask[] {
    if (user.role === 'ADMIN') {
      return structuredClone(this.tasks);
    }
    if (user.role === 'WARDEN') {
      const allowed = new Set(user.assigned_block_ids);
      return structuredClone(this.tasks.filter((t) => allowed.has(t.block_id)));
    }
    if (user.role === 'MAINTENANCE_STAFF') {
      const allowed = new Set(user.assigned_block_ids);
      return structuredClone(
        this.tasks.filter(
          (t) => t.assigned_to_id === user.id && allowed.has(t.block_id)
        )
      );
    }
    return [];
  }

  public getTaskByIdForUser(user: AuthUserProfile, taskId: string): MaintenanceTask | null {
    const found = this.tasks.find((t) => t.id === taskId);
    if (!found) return null;
    if (user.role === 'ADMIN') return structuredClone(found);
    if (user.role === 'WARDEN') {
      return user.assigned_block_ids.includes(found.block_id) ? structuredClone(found) : null;
    }
    if (user.role === 'MAINTENANCE_STAFF') {
      return found.assigned_to_id === user.id && user.assigned_block_ids.includes(found.block_id)
        ? structuredClone(found)
        : null;
    }
    return null;
  }

  public createTask(
    actor: AuthUserProfile,
    input: {
      block_id: string;
      block_name: string;
      floor: number;
      room_number: string;
      category: MaintenanceCategory;
      priority: MaintenancePriority;
      summary: string;
      location_detail: string;
      assigned_to_id: string | null;
      assigned_to_name: string | null;
    }
  ): MaintenanceTask {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new Error('Only Wardens or Administrators may create maintenance work orders.');
    }
    if (actor.role === 'WARDEN' && !actor.assigned_block_ids.includes(input.block_id)) {
      throw new Error('You may only create maintenance tickets within your assigned hostel blocks.');
    }

    const now = new Date().toISOString();
    const task: MaintenanceTask = {
      id: `mt-${crypto.randomUUID().slice(0, 8)}`,
      ticket_code: `MNT-2026-${105 + this.tasks.length}`,
      block_id: input.block_id,
      block_name: input.block_name,
      floor: input.floor,
      room_number: input.room_number,
      category: input.category,
      priority: input.priority,
      status: input.assigned_to_id ? 'assigned' : 'submitted',
      summary: input.summary,
      location_detail: input.location_detail,
      assigned_to_id: input.assigned_to_id,
      assigned_to_name: input.assigned_to_name,
      evidence_reference: null,
      parts_needed: null,
      work_notes: [],
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    this.tasks.unshift(task);
    return structuredClone(task);
  }

  public updateTask(
    actor: AuthUserProfile,
    taskId: string,
    updates: {
      status?: MaintenanceStatus;
      work_note?: string;
      parts_needed?: string | null;
      evidence_reference?: string | null;
      assigned_to_id?: string | null;
      assigned_to_name?: string | null;
    }
  ): MaintenanceTask {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error('Maintenance ticket not found.');
    }

    if (actor.role === 'MAINTENANCE_STAFF') {
      if (task.assigned_to_id !== actor.id || !actor.assigned_block_ids.includes(task.block_id)) {
        throw new Error('Access denied. You may only update maintenance tasks assigned to you.');
      }
      if (updates.assigned_to_id !== undefined && updates.assigned_to_id !== actor.id) {
        throw new Error('Maintenance staff cannot reassign tickets to other personnel.');
      }
      if (updates.status === 'closed') {
        throw new Error('Only a Warden or Administrator can formally close a resolved ticket.');
      }
    } else if (actor.role === 'WARDEN') {
      if (!actor.assigned_block_ids.includes(task.block_id)) {
        throw new Error('Access denied. This maintenance ticket belongs to another hostel block.');
      }
    } else if (actor.role !== 'ADMIN') {
      throw new Error('Access denied.');
    }

    const now = new Date().toISOString();
    if (updates.status) {
      task.status = updates.status;
      if (updates.status === 'resolved' || updates.status === 'closed') {
        task.completed_at = task.completed_at ?? now;
      }
    }
    if (updates.parts_needed !== undefined) {
      task.parts_needed = updates.parts_needed;
    }
    if (updates.evidence_reference !== undefined) {
      task.evidence_reference = updates.evidence_reference;
    }
    if (
      (actor.role === 'ADMIN' || actor.role === 'WARDEN') &&
      updates.assigned_to_id !== undefined
    ) {
      task.assigned_to_id = updates.assigned_to_id;
      task.assigned_to_name = updates.assigned_to_name ?? null;
      if (updates.assigned_to_id && task.status === 'submitted') {
        task.status = 'assigned';
      }
    }
    if (updates.work_note && updates.work_note.trim().length > 0) {
      task.work_notes.push({
        id: `mwn-${crypto.randomUUID().slice(0, 8)}`,
        author_name: actor.full_name,
        author_role: actor.role as 'MAINTENANCE_STAFF' | 'WARDEN' | 'ADMIN',
        note: updates.work_note.trim(),
        parts_reported: updates.parts_needed ?? null,
        timestamp: now,
      });
    }
    task.updated_at = now;
    return structuredClone(task);
  }
}

let sharedMaintenanceService: MaintenanceTaskService | null = null;

export function getMaintenanceService(): MaintenanceTaskService {
  if (!sharedMaintenanceService) {
    sharedMaintenanceService = new MaintenanceTaskService();
  }
  return sharedMaintenanceService;
}
