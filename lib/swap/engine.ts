import {
  Block,
  Room,
  Student,
  SwapCycleStep,
  SwapProposal,
  SwapRequest,
  SwapWantedCriteria,
} from '../types.ts';
import { isGenderCompatibleWithBlock } from '../allotment/engine.ts';

/**
 * HostelHub Multi-Way Room Swap Cycle Engine
 * ==========================================
 * Represents active swap requests as a directed graph G = (V, E):
 * - Vertex u in V: a student with an open SwapRequest occupying room R(u).
 * - Directed edge (u -> v) in E: student u is eligible for room R(v) (same gender block)
 *   AND room R(v) satisfies u's wanted_criteria AND R(u) !== R(v).
 *
 * Cycle Detection:
 * - Bounded DFS finds all simple directed cycles of length L in {2, 3, 4}.
 * - Canonical deduplication anchors each cycle at its lexicographically smallest
 *   student ID so each cycle is discovered exactly once.
 * - Every cycle is validated against hard constraints:
 *   1. Every student currently occupies their declared `current_room_id`.
 *   2. Every student is gender-eligible for the target room's block.
 *   3. Post-swap room occupancy never exceeds room capacity (for any room participating
 *      in a permutation cycle, net delta is 0, and we still verify initial occupancy <= capacity).
 *   4. No student appears twice in the cycle.
 */

export interface CandidateEdge {
  fromStudentId: string;
  toStudentId: string;
  score: number;
  reason: string;
}

export interface DetectedSwapCycle {
  cycle: SwapCycleStep[];
  cycle_length: 2 | 3 | 4;
  score: number;
  feasibility_summary: string;
}

export function evaluateRoomMatchCriteria(
  room: Room,
  criteria: SwapWantedCriteria
): { matches: boolean; score: number; reason: string } {
  const reasons: string[] = [];
  let score = 0;

  if (criteria.preferred_room_ids && criteria.preferred_room_ids.length > 0) {
    const exactIdx = criteria.preferred_room_ids.indexOf(room.id);
    if (exactIdx !== -1) {
      const rankBonus = Math.max(20, 50 - exactIdx * 8);
      return {
        matches: true,
        score: rankBonus,
        reason: `Exact target room match (#${exactIdx + 1} on wishlist: ${room.number}).`,
      };
    }
    // If the student ONLY specified preferred_room_ids and no other criteria, require exact match.
    const hasAttributeCriteria =
      criteria.block_id !== undefined ||
      criteria.floor_min !== undefined ||
      criteria.floor_max !== undefined ||
      criteria.ac !== undefined ||
      criteria.capacity !== undefined ||
      (criteria.required_tags !== undefined && criteria.required_tags.length > 0);
    if (!hasAttributeCriteria) {
      return { matches: false, score: 0, reason: 'Does not match requested target room IDs.' };
    }
  }

  if (criteria.block_id && room.block_id !== criteria.block_id) {
    return { matches: false, score: 0, reason: 'Block mismatch.' };
  }
  if (criteria.block_id) {
    score += 12;
    reasons.push('preferred block');
  }

  if (criteria.floor_min !== undefined && room.floor < criteria.floor_min) {
    return { matches: false, score: 0, reason: 'Floor below minimum.' };
  }
  if (criteria.floor_max !== undefined && room.floor > criteria.floor_max) {
    return { matches: false, score: 0, reason: 'Floor above maximum.' };
  }
  if (criteria.floor_min !== undefined || criteria.floor_max !== undefined) {
    score += 10;
    reasons.push(`Floor ${room.floor}`);
  }

  if (criteria.ac !== undefined && room.ac !== criteria.ac) {
    return { matches: false, score: 0, reason: 'AC preference mismatch.' };
  }
  if (criteria.ac !== undefined) {
    score += 12;
    reasons.push(room.ac ? 'AC room' : 'Non-AC room');
  }

  if (criteria.capacity !== undefined && room.capacity !== criteria.capacity) {
    return { matches: false, score: 0, reason: 'Capacity mismatch.' };
  }
  if (criteria.capacity !== undefined) {
    score += 10;
    reasons.push(`${room.capacity}-seater`);
  }

  if (criteria.required_tags && criteria.required_tags.length > 0) {
    for (const tag of criteria.required_tags) {
      if (!room.tags.includes(tag)) {
        return { matches: false, score: 0, reason: `Missing required tag: ${tag}.` };
      }
    }
    score += criteria.required_tags.length * 8;
    reasons.push(`tags: ${criteria.required_tags.join(', ')}`);
  }

  if (reasons.length === 0) {
    return { matches: false, score: 0, reason: 'No active criteria matched.' };
  }

  return {
    matches: true,
    score: Math.max(15, score),
    reason: `Matches criteria (${reasons.join(' · ')}).`,
  };
}

export interface SwapDetectionInput {
  requests: SwapRequest[];
  students: Student[];
  rooms: Room[];
  blocks: Block[];
  excludedStudentIds?: Set<string>;
  maxCycles?: number;
}

export function detectValidSwapCycles(
  input: SwapDetectionInput
): DetectedSwapCycle[] {
  const {
    requests,
    students,
    rooms,
    blocks,
    excludedStudentIds = new Set<string>(),
    maxCycles = 30,
  } = input;

  const studentMap = new Map(students.map((s) => [s.id, s]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const blockMap = new Map(blocks.map((b) => [b.id, b]));

  // Keep only open requests whose student genuinely occupies current_room_id.
  const activeRequests = requests.filter((req) => {
    if (req.status !== 'open') return false;
    if (excludedStudentIds.has(req.student_id)) return false;
    const student = studentMap.get(req.student_id);
    const room = roomMap.get(req.current_room_id);
    if (!student || !room) return false;
    if (student.allotted_room_id !== room.id) return false;
    if (!room.occupants.includes(student.id)) return false;
    if (room.occupants.length > room.capacity) return false;
    return true;
  });

  // One active request per student in graph construction.
  const requestByStudent = new Map<string, SwapRequest>();
  for (const req of activeRequests) {
    if (!requestByStudent.has(req.student_id)) {
      requestByStudent.set(req.student_id, req);
    }
  }

  const nodeIds = Array.from(requestByStudent.keys()).sort();
  const adjacency = new Map<string, CandidateEdge[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }

  // Build directed preference graph edges.
  for (const fromId of nodeIds) {
    const fromReq = requestByStudent.get(fromId)!;
    const fromStudent = studentMap.get(fromId)!;

    for (const toId of nodeIds) {
      if (fromId === toId) continue;
      const toReq = requestByStudent.get(toId)!;
      if (fromReq.current_room_id === toReq.current_room_id) continue;

      const targetRoom = roomMap.get(toReq.current_room_id)!;
      const targetBlock = blockMap.get(targetRoom.block_id);
      if (!targetBlock) continue;

      // Hard constraint: gender compatibility with target block.
      if (!isGenderCompatibleWithBlock(fromStudent.gender, targetBlock)) continue;

      const evalResult = evaluateRoomMatchCriteria(targetRoom, fromReq.wanted_criteria);
      if (evalResult.matches) {
        adjacency.get(fromId)!.push({
          fromStudentId: fromId,
          toStudentId: toId,
          score: evalResult.score,
          reason: evalResult.reason,
        });
      }
    }
  }

  const foundCycles: DetectedSwapCycle[] = [];
  const seenSignatures = new Set<string>();

  const buildCycleObject = (pathIds: string[], edges: CandidateEdge[]): DetectedSwapCycle | null => {
    const length = pathIds.length;
    if (length < 2 || length > 4) return null;

    // Verify room capacity invariants after permutation.
    const roomDelta = new Map<string, number>();
    const steps: SwapCycleStep[] = [];
    let totalScore = 0;

    for (let i = 0; i < length; i += 1) {
      const fromId = pathIds[i];
      const toId = pathIds[(i + 1) % length];
      const edge = edges[i];
      const student = studentMap.get(fromId)!;
      const fromReq = requestByStudent.get(fromId)!;
      const toReq = requestByStudent.get(toId)!;
      const fromRoom = roomMap.get(fromReq.current_room_id)!;
      const toRoom = roomMap.get(toReq.current_room_id)!;
      const fromBlock = blockMap.get(fromRoom.block_id)!;
      const toBlock = blockMap.get(toRoom.block_id)!;

      if (!isGenderCompatibleWithBlock(student.gender, toBlock)) {
        return null;
      }

      roomDelta.set(fromRoom.id, (roomDelta.get(fromRoom.id) ?? 0) - 1);
      roomDelta.set(toRoom.id, (roomDelta.get(toRoom.id) ?? 0) + 1);
      totalScore += edge.score;

      steps.push({
        student_id: student.id,
        student_name: student.name,
        student_code: student.student_code,
        request_id: fromReq.id,
        from_room_id: fromRoom.id,
        from_room_label: `${fromBlock.code}-${fromRoom.number}`,
        to_room_id: toRoom.id,
        to_room_label: `${toBlock.code}-${toRoom.number}`,
        reason: edge.reason,
      });
    }

    for (const [roomId, delta] of roomDelta.entries()) {
      const room = roomMap.get(roomId)!;
      if (room.occupants.length + delta > room.capacity) {
        return null;
      }
    }

    const cycleLen = length as 2 | 3 | 4;
    const kindLabel =
      cycleLen === 2 ? 'Direct 2-way swap' : cycleLen === 3 ? '3-way rotation cycle' : '4-way rotation cycle';

    return {
      cycle: steps,
      cycle_length: cycleLen,
      score: totalScore,
      feasibility_summary: `${kindLabel}: all ${cycleLen} rooms retain valid capacity and gender-matched block eligibility.`,
    };
  };

  // Bounded DFS anchored at startId; only visit nodes >= startId to guarantee canonical uniqueness.
  const dfs = (
    startId: string,
    currentId: string,
    visited: string[],
    usedEdges: CandidateEdge[]
  ): void => {
    const outgoing = adjacency.get(currentId) ?? [];
    for (const edge of outgoing) {
      if (edge.toStudentId === startId && visited.length >= 2 && visited.length <= 4) {
        const signature = visited.join('->');
        if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          const candidate = buildCycleObject(visited, [...usedEdges, edge]);
          if (candidate) {
            foundCycles.push(candidate);
          }
        }
        continue;
      }

      if (visited.length >= 4) continue;
      if (edge.toStudentId <= startId) continue; // Canonical anchor rule
      if (visited.includes(edge.toStudentId)) continue;

      dfs(startId, edge.toStudentId, [...visited, edge.toStudentId], [...usedEdges, edge]);
    }
  };

  for (const startId of nodeIds) {
    dfs(startId, startId, [startId], []);
  }

  // Rank cycles: higher score first, then prefer shorter cycles on ties for lower coordination friction.
  foundCycles.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.cycle_length - b.cycle_length;
  });

  return foundCycles.slice(0, maxCycles);
}

/**
 * Validates whether a SwapProposal is still safe to execute atomically at commit time.
 */
export function validateProposalExecution(
  proposal: SwapProposal,
  students: Map<string, Student>,
  rooms: Map<string, Room>,
  blocks: Map<string, Block>,
  nowMs = Date.now()
): { valid: boolean; reason?: string } {
  if (proposal.status !== 'pending') {
    return { valid: false, reason: `Proposal is already ${proposal.status}.` };
  }

  if (Date.parse(proposal.expires_at) <= nowMs) {
    return { valid: false, reason: 'Proposal has expired.' };
  }

  // Every participant must have explicitly accepted.
  for (const step of proposal.cycle) {
    if (!proposal.acceptances[step.student_id]) {
      return {
        valid: false,
        reason: `Waiting for acceptance from ${step.student_name}.`,
      };
    }
  }

  // Ensure no duplicate students in cycle.
  const participantIds = new Set(proposal.cycle.map((s) => s.student_id));
  if (participantIds.size !== proposal.cycle.length) {
    return { valid: false, reason: 'Cycle contains duplicate student participants.' };
  }

  // Verify live room occupancy, gender eligibility, and post-swap capacity.
  const roomDelta = new Map<string, number>();
  for (const step of proposal.cycle) {
    const student = students.get(step.student_id);
    const fromRoom = rooms.get(step.from_room_id);
    const toRoom = rooms.get(step.to_room_id);

    if (!student || !fromRoom || !toRoom) {
      return { valid: false, reason: 'Missing student or room record for swap execution.' };
    }

    if (student.allotted_room_id !== fromRoom.id || !fromRoom.occupants.includes(student.id)) {
      return {
        valid: false,
        reason: `${student.name} no longer occupies ${step.from_room_label}.`,
      };
    }

    const toBlock = blocks.get(toRoom.block_id);
    if (!toBlock || !isGenderCompatibleWithBlock(student.gender, toBlock)) {
      return {
        valid: false,
        reason: `Gender eligibility violation for ${student.name} moving to ${step.to_room_label}.`,
      };
    }

    roomDelta.set(fromRoom.id, (roomDelta.get(fromRoom.id) ?? 0) - 1);
    roomDelta.set(toRoom.id, (roomDelta.get(toRoom.id) ?? 0) + 1);
  }

  for (const [roomId, delta] of roomDelta.entries()) {
    const room = rooms.get(roomId)!;
    const projectedOccupancy = room.occupants.length + delta;
    if (projectedOccupancy < 0 || projectedOccupancy > room.capacity) {
      return {
        valid: false,
        reason: `Room ${room.number} would violate capacity (${projectedOccupancy}/${room.capacity}).`,
      };
    }
  }

  return { valid: true };
}
