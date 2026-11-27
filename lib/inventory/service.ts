import crypto from 'node:crypto';
import type { AuthUserProfile, Role } from '../auth/roles.ts';
import { canAccessBlock } from '../auth/permissions.ts';
import type { IHostelRepository } from '../repo/interface.ts';
import type { Block, Room } from '../types.ts';

export type RoomOperationalStatus =
  | 'AVAILABLE'
  | 'PARTIALLY_OCCUPIED'
  | 'FULL'
  | 'UNDER_MAINTENANCE'
  | 'BLOCKED'
  | 'RESERVED';

export type RoomOverrideStatus = 'AVAILABLE' | 'UNDER_MAINTENANCE' | 'BLOCKED' | 'RESERVED';

export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE';
export type BedOverrideStatus = 'AVAILABLE' | 'RESERVED' | 'MAINTENANCE';

export interface Campus {
  id: string;
  code: string;
  name: string;
  location_label: string;
}

export interface Hostel {
  id: string;
  campus_id: string;
  code: string;
  name: string;
  gender_policy: 'boys' | 'girls';
  block_ids: string[];
}

export interface BedRecord {
  id: string;
  room_id: string;
  block_id: string;
  bed_label: string; // A, B, C, D
  status: BedStatus;
  is_occupied: boolean;
  occupant_student_id: string | null; // Redacted to null for STUDENT viewers
  occupant_student_code: string | null; // Redacted to null for STUDENT viewers
  is_accessible: boolean;
  notes: string | null;
}

export interface RoomStatusHistoryEntry {
  id: string;
  room_id: string;
  bed_id: string | null;
  block_id: string;
  previous_status: string;
  new_status: string;
  reason: string;
  changed_by_email: string;
  changed_by_role: Role;
  timestamp: string;
}

export interface InventoryRoomSummary {
  id: string;
  block_id: string;
  floor: number;
  number: string;
  capacity: 1 | 2 | 3 | 4;
  ac: boolean;
  tags: Room['tags'];
  is_accessible: boolean;
  operational_override: RoomOverrideStatus | null;
  derived_status: RoomOperationalStatus;
  total_beds: number;
  occupied_beds: number;
  reserved_beds: number;
  maintenance_beds: number;
  available_beds: number;
}

export interface FloorSummary {
  floor_number: number;
  total_rooms: number;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  rooms: InventoryRoomSummary[];
}

export interface BlockInventoryNode extends Block {
  hostel_id: string;
  campus_id: string;
  total_rooms: number;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  can_manage: boolean;
  floors_detail: FloorSummary[];
}

export interface HostelInventoryNode extends Hostel {
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  blocks: BlockInventoryNode[];
}

export interface CampusInventoryNode extends Campus {
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  hostels: HostelInventoryNode[];
}

export interface InstitutionalHierarchyResponse {
  university: {
    id: string;
    name: string;
    code: string;
  };
  totals: {
    campuses: number;
    hostels: number;
    blocks: number;
    rooms: number;
    beds: number;
    occupied_beds: number;
    available_beds: number;
  };
  campuses: CampusInventoryNode[];
}

const BED_LABELS = ['A', 'B', 'C', 'D'] as const;

const CAMPUSES: ReadonlyArray<Campus> = [
  {
    id: 'cmp-north',
    code: 'NORTH',
    name: 'North Academic Campus',
    location_label: 'Main Academic Ring & Central Mess',
  },
  {
    id: 'cmp-south',
    code: 'SOUTH',
    name: 'South Residential Campus',
    location_label: 'Botanical Quadrangle & Library Avenue',
  },
];

const HOSTELS: ReadonlyArray<Hostel> = [
  {
    id: 'hst-north-boys',
    campus_id: 'cmp-north',
    code: 'NBH',
    name: 'North Boys Hostel (Nilgiri Wing)',
    gender_policy: 'boys',
    block_ids: ['blk-nilgiri'],
  },
  {
    id: 'hst-north-girls',
    campus_id: 'cmp-north',
    code: 'NGH',
    name: 'North Girls Hostel (Kaveri Wing)',
    gender_policy: 'girls',
    block_ids: ['blk-kaveri'],
  },
  {
    id: 'hst-south-boys',
    campus_id: 'cmp-south',
    code: 'SBH',
    name: 'South Boys Hostel (Vindhya Wing)',
    gender_policy: 'boys',
    block_ids: ['blk-vindhya'],
  },
  {
    id: 'hst-south-girls',
    campus_id: 'cmp-south',
    code: 'SGH',
    name: 'South Girls Hostel (Narmada Wing)',
    gender_policy: 'girls',
    block_ids: ['blk-narmada'],
  },
];

function findHostelForBlock(blockId: string): Hostel {
  const found = HOSTELS.find((h) => h.block_ids.includes(blockId));
  return found ?? HOSTELS[0];
}

export class InventoryError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'InventoryError';
  }
}

/**
 * Institutional Hostel & Bed-Level Inventory Service
 * ==================================================
 * Layers University -> Campus -> Hostel -> Block -> Floor -> Room -> Bed
 * semantics directly over IHostelRepository without breaking existing allotment
 * or swap engines. Availability is ALWAYS derived from active occupancy +
 * bed/room operational overrides (never stale cached counts).
 */
export class InstitutionalInventoryService {
  private readonly roomOverrides = new Map<string, RoomOverrideStatus>();
  private readonly bedOverrides = new Map<string, { status: BedOverrideStatus; notes: string | null }>();
  private readonly statusHistory: RoomStatusHistoryEntry[] = [];

  constructor(private readonly repo: IHostelRepository) {}

  private buildBedId(roomId: string, label: string): string {
    return `${roomId}-bed-${label.toLowerCase()}`;
  }

  public parseBedId(bedId: string): { roomId: string; bedLabel: string } | null {
    const match = /^(.+)-bed-([a-d])$/i.exec(bedId.trim());
    if (!match) return null;
    return {
      roomId: match[1],
      bedLabel: match[2].toUpperCase(),
    };
  }

  private deriveBedsForRoom(
    room: Room,
    studentCodeById: Map<string, string>,
    redactOccupants: boolean
  ): BedRecord[] {
    const roomOverride = this.roomOverrides.get(room.id) ?? null;
    const uniqueOccupants = Array.from(new Set(room.occupants));
    const beds: BedRecord[] = [];

    for (let idx = 0; idx < room.capacity; idx++) {
      const label = BED_LABELS[idx] ?? String(idx + 1);
      const bedId = this.buildBedId(room.id, label);
      const occupantId = uniqueOccupants[idx] ?? null;
      const bedOverride = this.bedOverrides.get(bedId);

      let status: BedStatus;
      if (occupantId) {
        status = 'OCCUPIED';
      } else if (roomOverride === 'UNDER_MAINTENANCE' || bedOverride?.status === 'MAINTENANCE') {
        status = 'MAINTENANCE';
      } else if (
        roomOverride === 'BLOCKED' ||
        roomOverride === 'RESERVED' ||
        bedOverride?.status === 'RESERVED'
      ) {
        status = 'RESERVED';
      } else {
        status = 'AVAILABLE';
      }

      beds.push({
        id: bedId,
        room_id: room.id,
        block_id: room.block_id,
        bed_label: label,
        status,
        is_occupied: Boolean(occupantId),
        occupant_student_id: redactOccupants ? null : occupantId,
        occupant_student_code:
          redactOccupants || !occupantId ? null : (studentCodeById.get(occupantId) ?? null),
        is_accessible: room.floor === 1 && idx === 0,
        notes: bedOverride?.notes ?? null,
      });
    }

    return beds;
  }

  private summarizeRoom(room: Room, beds: BedRecord[]): InventoryRoomSummary {
    const roomOverride = this.roomOverrides.get(room.id) ?? null;
    const occupied = beds.filter((b) => b.status === 'OCCUPIED').length;
    const reserved = beds.filter((b) => b.status === 'RESERVED').length;
    const maintenance = beds.filter((b) => b.status === 'MAINTENANCE').length;
    const available = beds.filter((b) => b.status === 'AVAILABLE').length;

    let derivedStatus: RoomOperationalStatus;
    if (roomOverride === 'UNDER_MAINTENANCE') {
      derivedStatus = 'UNDER_MAINTENANCE';
    } else if (roomOverride === 'BLOCKED') {
      derivedStatus = 'BLOCKED';
    } else if (roomOverride === 'RESERVED' && occupied === 0) {
      derivedStatus = 'RESERVED';
    } else if (available === 0 && occupied > 0) {
      derivedStatus = 'FULL';
    } else if (available === 0 && maintenance === beds.length) {
      derivedStatus = 'UNDER_MAINTENANCE';
    } else if (available === 0) {
      derivedStatus = 'RESERVED';
    } else if (occupied > 0) {
      derivedStatus = 'PARTIALLY_OCCUPIED';
    } else {
      derivedStatus = 'AVAILABLE';
    }

    return {
      id: room.id,
      block_id: room.block_id,
      floor: room.floor,
      number: room.number,
      capacity: room.capacity,
      ac: room.ac,
      tags: room.tags,
      is_accessible: room.floor === 1,
      operational_override: roomOverride,
      derived_status: derivedStatus,
      total_beds: beds.length,
      occupied_beds: occupied,
      reserved_beds: reserved,
      maintenance_beds: maintenance,
      available_beds: available,
    };
  }

  public async getHierarchy(viewer: AuthUserProfile): Promise<InstitutionalHierarchyResponse> {
    if (viewer.role === 'MAINTENANCE_STAFF') {
      throw new InventoryError('Maintenance staff cannot access institutional hostel occupancy inventory.', 403);
    }

    const [blocks, rooms, students] = await Promise.all([
      this.repo.getBlocks(),
      this.repo.getRooms(),
      this.repo.getStudents(),
    ]);

    const studentCodeById = new Map<string, string>(
      students.map((s) => [s.id, s.student_code])
    );
    const redactOccupants = viewer.role === 'STUDENT';

    const roomsByBlock = new Map<string, Room[]>();
    for (const r of rooms) {
      const list = roomsByBlock.get(r.block_id) ?? [];
      list.push(r);
      roomsByBlock.set(r.block_id, list);
    }

    const blockNodesById = new Map<string, BlockInventoryNode>();
    for (const block of blocks) {
      const hostel = findHostelForBlock(block.id);
      const blockRooms = roomsByBlock.get(block.id) ?? [];

      const floorsMap = new Map<number, InventoryRoomSummary[]>();
      let blockTotalBeds = 0;
      let blockOccupiedBeds = 0;
      let blockAvailableBeds = 0;

      for (const room of blockRooms) {
        const beds = this.deriveBedsForRoom(room, studentCodeById, redactOccupants);
        const summary = this.summarizeRoom(room, beds);
        blockTotalBeds += summary.total_beds;
        blockOccupiedBeds += summary.occupied_beds;
        blockAvailableBeds += summary.available_beds;

        const floorList = floorsMap.get(room.floor) ?? [];
        floorList.push(summary);
        floorsMap.set(room.floor, floorList);
      }

      const floorsDetail: FloorSummary[] = Array.from(floorsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([floorNum, floorRooms]) => {
          floorRooms.sort((a, b) => a.number.localeCompare(b.number));
          return {
            floor_number: floorNum,
            total_rooms: floorRooms.length,
            total_beds: floorRooms.reduce((acc, r) => acc + r.total_beds, 0),
            occupied_beds: floorRooms.reduce((acc, r) => acc + r.occupied_beds, 0),
            available_beds: floorRooms.reduce((acc, r) => acc + r.available_beds, 0),
            rooms: floorRooms,
          };
        });

      blockNodesById.set(block.id, {
        ...block,
        hostel_id: hostel.id,
        campus_id: hostel.campus_id,
        total_rooms: blockRooms.length,
        total_beds: blockTotalBeds,
        occupied_beds: blockOccupiedBeds,
        available_beds: blockAvailableBeds,
        can_manage: canAccessBlock(viewer, block.id),
        floors_detail: floorsDetail,
      });
    }

    const campuses: CampusInventoryNode[] = CAMPUSES.map((campus) => {
      const campusHostels: HostelInventoryNode[] = HOSTELS.filter(
        (h) => h.campus_id === campus.id
      ).map((hostel) => {
        const hostelBlocks = hostel.block_ids
          .map((bid) => blockNodesById.get(bid))
          .filter((b): b is BlockInventoryNode => Boolean(b));
        return {
          ...hostel,
          total_beds: hostelBlocks.reduce((acc, b) => acc + b.total_beds, 0),
          occupied_beds: hostelBlocks.reduce((acc, b) => acc + b.occupied_beds, 0),
          available_beds: hostelBlocks.reduce((acc, b) => acc + b.available_beds, 0),
          blocks: hostelBlocks,
        };
      });

      return {
        ...campus,
        total_beds: campusHostels.reduce((acc, h) => acc + h.total_beds, 0),
        occupied_beds: campusHostels.reduce((acc, h) => acc + h.occupied_beds, 0),
        available_beds: campusHostels.reduce((acc, h) => acc + h.available_beds, 0),
        hostels: campusHostels,
      };
    });

    const totalBeds = campuses.reduce((acc, c) => acc + c.total_beds, 0);
    const totalOccupied = campuses.reduce((acc, c) => acc + c.occupied_beds, 0);
    const totalAvailable = campuses.reduce((acc, c) => acc + c.available_beds, 0);

    return {
      university: {
        id: 'univ-vidyavihar',
        name: 'VidyaVihar University',
        code: 'VVU',
      },
      totals: {
        campuses: campuses.length,
        hostels: HOSTELS.length,
        blocks: blocks.length,
        rooms: rooms.length,
        beds: totalBeds,
        occupied_beds: totalOccupied,
        available_beds: totalAvailable,
      },
      campuses,
    };
  }

  public async getRoomBeds(
    roomId: string,
    viewer: AuthUserProfile
  ): Promise<{
    room: InventoryRoomSummary;
    block: Block;
    can_manage: boolean;
    beds: BedRecord[];
    status_history: RoomStatusHistoryEntry[];
  }> {
    if (viewer.role === 'MAINTENANCE_STAFF') {
      throw new InventoryError('Maintenance staff cannot view student room occupancy details.', 403);
    }

    const room = await this.repo.getRoomById(roomId);
    if (!room) {
      throw new InventoryError(`Room '${roomId}' was not found.`, 404);
    }
    const block = await this.repo.getBlockById(room.block_id);
    if (!block) {
      throw new InventoryError(`Block '${room.block_id}' was not found.`, 404);
    }

    const students = await this.repo.getStudents();
    const studentCodeById = new Map<string, string>(
      students.map((s) => [s.id, s.student_code])
    );

    // Privacy rule: Students NEVER receive other students' IDs or codes on bed records.
    // Wardens see occupant codes only for their assigned blocks; Admins see all.
    const redactOccupants =
      viewer.role === 'STUDENT' ||
      (viewer.role === 'WARDEN' && !canAccessBlock(viewer, room.block_id));

    const beds = this.deriveBedsForRoom(room, studentCodeById, redactOccupants);
    const summary = this.summarizeRoom(room, beds);
    const history = this.statusHistory.filter((h) => h.room_id === room.id).slice(0, 20);

    return {
      room: summary,
      block,
      can_manage: canAccessBlock(viewer, room.block_id),
      beds,
      status_history: redactOccupants ? [] : history,
    };
  }

  public async updateRoomOperationalStatus(
    actor: AuthUserProfile,
    params: {
      roomId: string;
      status: RoomOverrideStatus;
      reason: string;
    }
  ): Promise<{ room: InventoryRoomSummary; beds: BedRecord[]; history_entry: RoomStatusHistoryEntry }> {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new InventoryError('Only Wardens or Administrators may update room operational status.', 403);
    }

    const room = await this.repo.getRoomById(params.roomId);
    if (!room) {
      throw new InventoryError(`Room '${params.roomId}' not found.`, 404);
    }

    if (!canAccessBlock(actor, room.block_id)) {
      throw new InventoryError('Forbidden: You can only manage rooms within your assigned hostel blocks.', 403);
    }

    // Hard safety invariant: cannot block or mark a fully/partially occupied room as completely blocked without relocating students
    if (params.status === 'BLOCKED' && room.occupants.length > 0) {
      throw new InventoryError(
        `Cannot mark room ${room.number} as BLOCKED while ${room.occupants.length} active occupant(s) are assigned.`,
        409
      );
    }

    const students = await this.repo.getStudents();
    const studentCodeById = new Map<string, string>(students.map((s) => [s.id, s.student_code]));
    const beforeSummary = this.summarizeRoom(
      room,
      this.deriveBedsForRoom(room, studentCodeById, false)
    );

    if (params.status === 'AVAILABLE') {
      this.roomOverrides.delete(room.id);
    } else {
      this.roomOverrides.set(room.id, params.status);
    }

    const afterBeds = this.deriveBedsForRoom(room, studentCodeById, false);
    const afterSummary = this.summarizeRoom(room, afterBeds);

    const entry: RoomStatusHistoryEntry = {
      id: `rm-hist-${crypto.randomUUID().slice(0, 8)}`,
      room_id: room.id,
      bed_id: null,
      block_id: room.block_id,
      previous_status: beforeSummary.derived_status,
      new_status: afterSummary.derived_status,
      reason: params.reason.trim(),
      changed_by_email: actor.email,
      changed_by_role: actor.role,
      timestamp: new Date().toISOString(),
    };
    this.statusHistory.unshift(entry);

    await this.repo.appendAuditLog(actor.email, actor.role, 'ROOM_OPERATIONAL_STATUS_UPDATED', {
      room_id: room.id,
      block_id: room.block_id,
      previous_status: entry.previous_status,
      new_status: entry.new_status,
      reason: entry.reason,
    });

    return { room: afterSummary, beds: afterBeds, history_entry: entry };
  }

  public async updateBedStatus(
    actor: AuthUserProfile,
    params: {
      bedId: string;
      status: BedOverrideStatus;
      reason: string;
      notes?: string | null;
    }
  ): Promise<{ room: InventoryRoomSummary; bed: BedRecord; history_entry: RoomStatusHistoryEntry }> {
    if (actor.role !== 'ADMIN' && actor.role !== 'WARDEN') {
      throw new InventoryError('Only Wardens or Administrators may update individual bed status.', 403);
    }

    const parsed = this.parseBedId(params.bedId);
    if (!parsed) {
      throw new InventoryError(`Invalid bed identifier '${params.bedId}'.`, 400);
    }

    const room = await this.repo.getRoomById(parsed.roomId);
    if (!room) {
      throw new InventoryError(`Room '${parsed.roomId}' for bed '${params.bedId}' was not found.`, 404);
    }

    if (!canAccessBlock(actor, room.block_id)) {
      throw new InventoryError('Forbidden: You can only manage beds within your assigned hostel blocks.', 403);
    }

    const students = await this.repo.getStudents();
    const studentCodeById = new Map<string, string>(students.map((s) => [s.id, s.student_code]));
    const beforeBeds = this.deriveBedsForRoom(room, studentCodeById, false);
    const targetBed = beforeBeds.find((b) => b.id === params.bedId.toLowerCase());
    if (!targetBed) {
      throw new InventoryError(`Bed '${params.bedId}' does not exist in room ${room.number}.`, 404);
    }

    // Hard bed-level occupancy invariant: cannot override an actively occupied bed
    if (targetBed.is_occupied) {
      throw new InventoryError(
        `Bed ${targetBed.bed_label} in room ${room.number} is currently OCCUPIED by an active resident and cannot be changed to ${params.status}.`,
        409
      );
    }

    const normalizedBedId = targetBed.id;
    if (params.status === 'AVAILABLE') {
      this.bedOverrides.delete(normalizedBedId);
    } else {
      this.bedOverrides.set(normalizedBedId, {
        status: params.status,
        notes: params.notes?.trim() || params.reason.trim(),
      });
    }

    const afterBeds = this.deriveBedsForRoom(room, studentCodeById, false);
    const updatedBed = afterBeds.find((b) => b.id === normalizedBedId)!;
    const afterSummary = this.summarizeRoom(room, afterBeds);

    const entry: RoomStatusHistoryEntry = {
      id: `bed-hist-${crypto.randomUUID().slice(0, 8)}`,
      room_id: room.id,
      bed_id: normalizedBedId,
      block_id: room.block_id,
      previous_status: targetBed.status,
      new_status: updatedBed.status,
      reason: params.reason.trim(),
      changed_by_email: actor.email,
      changed_by_role: actor.role,
      timestamp: new Date().toISOString(),
    };
    this.statusHistory.unshift(entry);

    await this.repo.appendAuditLog(actor.email, actor.role, 'BED_STATUS_UPDATED', {
      bed_id: normalizedBedId,
      room_id: room.id,
      block_id: room.block_id,
      previous_status: entry.previous_status,
      new_status: entry.new_status,
      reason: entry.reason,
    });

    return { room: afterSummary, bed: updatedBed, history_entry: entry };
  }

  /**
   * Verifies the institutional invariant that no active student holds more than
   * one active bed across all rooms.
   */
  public async verifyOccupancyInvariants(): Promise<{
    valid: boolean;
    duplicate_student_ids: string[];
    over_capacity_room_ids: string[];
  }> {
    const rooms = await this.repo.getRooms();
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const overCapacity: string[] = [];

    for (const room of rooms) {
      if (room.occupants.length > room.capacity) {
        overCapacity.push(room.id);
      }
      for (const sid of room.occupants) {
        if (seen.has(sid)) {
          duplicates.add(sid);
        }
        seen.add(sid);
      }
    }

    return {
      valid: duplicates.size === 0 && overCapacity.length === 0,
      duplicate_student_ids: Array.from(duplicates),
      over_capacity_room_ids: overCapacity,
    };
  }
}

let sharedInventoryService: InstitutionalInventoryService | null = null;

export function getInventoryService(repo: IHostelRepository): InstitutionalInventoryService {
  if (!sharedInventoryService) {
    sharedInventoryService = new InstitutionalInventoryService(repo);
  }
  return sharedInventoryService;
}
