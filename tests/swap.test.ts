import { describe, expect, it } from 'vitest';
import { detectValidSwapCycles } from '../lib/swap/engine.ts';
import { InMemoryHostelRepository } from '../lib/repo/memoryRepo.ts';
import type { Block, Room, Student, SwapRequest } from '../lib/types.ts';
import type { SeedDataset } from '../lib/repo/seedData.ts';
import { DEFAULT_ALLOTMENT_RULES } from '../lib/repo/seedData.ts';

function createFixtureDataset(): SeedDataset {
  const blocks: Block[] = [
    {
      id: 'blk-b',
      name: 'Nilgiri Bhavan',
      code: 'NB',
      gender_type: 'boys',
      floors: 4,
      has_mess_nearby: true,
      warden_name: 'Dr. Deshpande',
      description: 'Boys block',
    },
    {
      id: 'blk-g',
      name: 'Kaveri Bhavan',
      code: 'KB',
      gender_type: 'girls',
      floors: 4,
      has_mess_nearby: true,
      warden_name: 'Dr. Kulkarni',
      description: 'Girls block',
    },
  ];

  const rooms: Room[] = [
    { id: 'nb-101', block_id: 'blk-b', floor: 1, number: '101', capacity: 1, ac: true, tags: ['near_mess'], occupants: ['s1'] },
    { id: 'nb-201', block_id: 'blk-b', floor: 2, number: '201', capacity: 1, ac: false, tags: ['quiet'], occupants: ['s2'] },
    { id: 'nb-301', block_id: 'blk-b', floor: 3, number: '301', capacity: 1, ac: true, tags: ['balcony'], occupants: ['s3'] },
    { id: 'nb-401', block_id: 'blk-b', floor: 4, number: '401', capacity: 1, ac: false, tags: ['corner'], occupants: ['s4'] },
    { id: 'kb-101', block_id: 'blk-g', floor: 1, number: '101', capacity: 1, ac: true, tags: ['near_mess'], occupants: ['g1'] },
  ];

  const makeS = (id: string, gender: 'male' | 'female', roomId: string): Student => ({
    id,
    student_code: `VV24${id.toUpperCase()}`,
    name: `Student ${id}`,
    email: `${id}@univ.edu.in`,
    year: 3,
    branch: 'CS',
    gender,
    cgpa_band: 'A',
    sleep_schedule: 'late',
    study_style: 'quiet',
    cleanliness: 4,
    about_me: '',
    preferences: [roomId],
    roommate_requests: [],
    allotted_room_id: roomId,
  });

  const students: Student[] = [
    makeS('s1', 'male', 'nb-101'),
    makeS('s2', 'male', 'nb-201'),
    makeS('s3', 'male', 'nb-301'),
    makeS('s4', 'male', 'nb-401'),
    makeS('g1', 'female', 'kb-101'),
  ];

  return {
    blocks,
    rooms,
    students,
    runs: [],
    swapRequests: [],
    swapProposals: [],
    announcements: [],
    disputes: [],
    auditLogs: [],
    rules: DEFAULT_ALLOTMENT_RULES,
  };
}

describe('Swap Cycle Detection & Atomic Execution', () => {
  it('detects and atomically executes a 2-way room swap once both accept', async () => {
    const repo = new InMemoryHostelRepository(createFixtureDataset());
    await repo.createSwapRequest('s1', { preferred_room_ids: ['nb-201'] });
    await repo.createSwapRequest('s2', { preferred_room_ids: ['nb-101'] });

    const proposals = await repo.discoverAndCreateProposals('system');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].cycle_length).toBe(2);

    // First acceptance does NOT execute swap yet
    const first = await repo.respondToSwapProposal({
      proposalId: proposals[0].id,
      studentId: 's1',
      action: 'accept',
    });
    expect(first.executed).toBe(false);
    expect((await repo.getStudentById('s1'))?.allotted_room_id).toBe('nb-101');

    // Second acceptance triggers atomic execution
    const second = await repo.respondToSwapProposal({
      proposalId: proposals[0].id,
      studentId: 's2',
      action: 'accept',
    });
    expect(second.executed).toBe(true);
    expect((await repo.getStudentById('s1'))?.allotted_room_id).toBe('nb-201');
    expect((await repo.getStudentById('s2'))?.allotted_room_id).toBe('nb-101');
    expect((await repo.getRoomById('nb-101'))?.occupants).toEqual(['s2']);
    expect((await repo.getRoomById('nb-201'))?.occupants).toEqual(['s1']);
  });

  it('detects and atomically executes a 3-way swap cycle', async () => {
    const repo = new InMemoryHostelRepository(createFixtureDataset());
    await repo.createSwapRequest('s1', { preferred_room_ids: ['nb-201'] });
    await repo.createSwapRequest('s2', { preferred_room_ids: ['nb-301'] });
    await repo.createSwapRequest('s3', { preferred_room_ids: ['nb-101'] });

    const proposals = await repo.discoverAndCreateProposals('system');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].cycle_length).toBe(3);

    await repo.respondToSwapProposal({ proposalId: proposals[0].id, studentId: 's1', action: 'accept' });
    await repo.respondToSwapProposal({ proposalId: proposals[0].id, studentId: 's2', action: 'accept' });
    const finalRes = await repo.respondToSwapProposal({ proposalId: proposals[0].id, studentId: 's3', action: 'accept' });

    expect(finalRes.executed).toBe(true);
    expect((await repo.getStudentById('s1'))?.allotted_room_id).toBe('nb-201');
    expect((await repo.getStudentById('s2'))?.allotted_room_id).toBe('nb-301');
    expect((await repo.getStudentById('s3'))?.allotted_room_id).toBe('nb-101');
  });

  it('detects and atomically executes a 4-way swap cycle', async () => {
    const repo = new InMemoryHostelRepository(createFixtureDataset());
    await repo.createSwapRequest('s1', { preferred_room_ids: ['nb-201'] });
    await repo.createSwapRequest('s2', { preferred_room_ids: ['nb-301'] });
    await repo.createSwapRequest('s3', { preferred_room_ids: ['nb-401'] });
    await repo.createSwapRequest('s4', { preferred_room_ids: ['nb-101'] });

    const proposals = await repo.discoverAndCreateProposals('system');
    expect(proposals).toHaveLength(1);
    expect(proposals[0].cycle_length).toBe(4);

    for (const id of ['s1', 's2', 's3']) {
      const r = await repo.respondToSwapProposal({ proposalId: proposals[0].id, studentId: id, action: 'accept' });
      expect(r.executed).toBe(false);
    }
    const done = await repo.respondToSwapProposal({ proposalId: proposals[0].id, studentId: 's4', action: 'accept' });
    expect(done.executed).toBe(true);
    expect((await repo.getStudentById('s1'))?.allotted_room_id).toBe('nb-201');
    expect((await repo.getStudentById('s4'))?.allotted_room_id).toBe('nb-101');
  });

  it('cancels proposal and preserves rooms when any participant rejects', async () => {
    const repo = new InMemoryHostelRepository(createFixtureDataset());
    await repo.createSwapRequest('s1', { preferred_room_ids: ['nb-201'] });
    await repo.createSwapRequest('s2', { preferred_room_ids: ['nb-101'] });

    const [proposal] = await repo.discoverAndCreateProposals('system');
    await repo.respondToSwapProposal({ proposalId: proposal.id, studentId: 's1', action: 'accept' });
    const rejected = await repo.respondToSwapProposal({
      proposalId: proposal.id,
      studentId: 's2',
      action: 'reject',
    });

    expect(rejected.proposal.status).toBe('rejected');
    expect((await repo.getStudentById('s1'))?.allotted_room_id).toBe('nb-101');
    expect((await repo.getStudentById('s2'))?.allotted_room_id).toBe('nb-201');

    // Released requests return to 'open' status
    const reqs = await repo.getSwapRequests();
    expect(reqs.every((r) => r.status === 'open')).toBe(true);
  });

  it('expires stale proposals after 72 hours and refuses late acceptance', async () => {
    const repo = new InMemoryHostelRepository(createFixtureDataset());
    await repo.createSwapRequest('s1', { preferred_room_ids: ['nb-201'] });
    await repo.createSwapRequest('s2', { preferred_room_ids: ['nb-101'] });

    const baseTime = Date.parse('2026-11-20T00:00:00.000Z');
    const [proposal] = await repo.discoverAndCreateProposals('system', baseTime);
    const afterExpiry = baseTime + 73 * 60 * 60 * 1000;

    await expect(
      repo.respondToSwapProposal({
        proposalId: proposal.id,
        studentId: 's1',
        action: 'accept',
        nowMs: afterExpiry,
      })
    ).rejects.toThrow(/expired/i);

    const updatedProposals = await repo.getSwapProposals(afterExpiry);
    expect(updatedProposals[0].status).toBe('expired');
  });

  it('blocks invalid cross-gender swap cycles and over-capacity rooms', () => {
    const fixture = createFixtureDataset();
    // Cross-gender requests: s1 (male) wants kb-101 (girls), g1 (female) wants nb-101 (boys)
    const crossGenderRequests: SwapRequest[] = [
      {
        id: 'r1',
        student_id: 's1',
        current_room_id: 'nb-101',
        wanted_criteria: { preferred_room_ids: ['kb-101'] },
        status: 'open',
        created_at: new Date().toISOString(),
      },
      {
        id: 'r2',
        student_id: 'g1',
        current_room_id: 'kb-101',
        wanted_criteria: { preferred_room_ids: ['nb-101'] },
        status: 'open',
        created_at: new Date().toISOString(),
      },
    ];

    const invalidCycles = detectValidSwapCycles({
      requests: crossGenderRequests,
      students: fixture.students,
      rooms: fixture.rooms,
      blocks: fixture.blocks,
    });
    expect(invalidCycles).toHaveLength(0);

    // Over-capacity room guard
    fixture.rooms[0].occupants = ['s1', 's99']; // capacity is 1
    const overCapCycles = detectValidSwapCycles({
      requests: [
        {
          id: 'r1',
          student_id: 's1',
          current_room_id: 'nb-101',
          wanted_criteria: { preferred_room_ids: ['nb-201'] },
          status: 'open',
          created_at: new Date().toISOString(),
        },
        {
          id: 'r2',
          student_id: 's2',
          current_room_id: 'nb-201',
          wanted_criteria: { preferred_room_ids: ['nb-101'] },
          status: 'open',
          created_at: new Date().toISOString(),
        },
      ],
      students: fixture.students,
      rooms: fixture.rooms,
      blocks: fixture.blocks,
    });
    expect(overCapCycles).toHaveLength(0);
  });

  it('prevents concurrent overlapping proposals locking the same student twice', async () => {
    const repo = new InMemoryHostelRepository(createFixtureDataset());
    await repo.createSwapRequest('s1', { preferred_room_ids: ['nb-201'] });
    await repo.createSwapRequest('s2', { preferred_room_ids: ['nb-101'] });

    const firstDiscovery = await repo.discoverAndCreateProposals('system');
    expect(firstDiscovery).toHaveLength(1);

    // Re-running discovery while proposal is pending must not create a duplicate conflicting proposal
    const secondDiscovery = await repo.discoverAndCreateProposals('system');
    expect(secondDiscovery).toHaveLength(0);
  });
});
