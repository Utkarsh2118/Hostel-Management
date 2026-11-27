import { describe, expect, it } from 'vitest';
import {
  calculatePriorityScore,
  runDeterministicAllotment,
} from '../lib/allotment/engine.ts';
import type { AllotmentRulesConfig, Block, Room, Student } from '../lib/types.ts';

const TEST_BLOCKS: Block[] = [
  {
    id: 'blk-b',
    name: 'Nilgiri Bhavan',
    code: 'NB',
    gender_type: 'boys',
    floors: 2,
    has_mess_nearby: true,
    warden_name: 'Dr. Deshpande',
    description: 'Boys block',
  },
  {
    id: 'blk-g',
    name: 'Kaveri Bhavan',
    code: 'KB',
    gender_type: 'girls',
    floors: 2,
    has_mess_nearby: true,
    warden_name: 'Dr. Kulkarni',
    description: 'Girls block',
  },
];

const DEFAULT_RULES: AllotmentRulesConfig = {
  year_weight: 25,
  merit_weight: 5,
  enable_merit_band: true,
  preserve_mutual_roommates: true,
  enable_pareto_pass: true,
};

function makeStudent(overrides: Partial<Student> & { id: string }): Student {
  return {
    student_code: `VV24CS${overrides.id}`,
    name: `Student ${overrides.id}`,
    email: `${overrides.id}@univ.edu.in`,
    year: 3,
    branch: 'Computer Science',
    gender: 'male',
    cgpa_band: 'A',
    sleep_schedule: 'late',
    study_style: 'quiet',
    cleanliness: 4,
    about_me: '',
    preferences: [],
    roommate_requests: [],
    allotted_room_id: null,
    ...overrides,
  };
}

describe('Allotment Engine', () => {
  it('computes priority scores accurately with and without merit band', () => {
    const senior = makeStudent({ id: 's1', year: 4, cgpa_band: 'A+' });
    const junior = makeStudent({ id: 's2', year: 2, cgpa_band: 'C' });

    expect(calculatePriorityScore(senior, DEFAULT_RULES)).toBe(4 * 25 + 5 * 5);
    expect(calculatePriorityScore(junior, DEFAULT_RULES)).toBe(2 * 25 + 1 * 5);

    const noMeritRules: AllotmentRulesConfig = { ...DEFAULT_RULES, enable_merit_band: false };
    expect(calculatePriorityScore(senior, noMeritRules)).toBe(100);
    expect(calculatePriorityScore(junior, noMeritRules)).toBe(50);
  });

  it('produces bit-identical deterministic results for the same seed regardless of input order', () => {
    const rooms: Room[] = [
      { id: 'r1', block_id: 'blk-b', floor: 1, number: '101', capacity: 1, ac: true, tags: ['quiet'], occupants: [] },
      { id: 'r2', block_id: 'blk-b', floor: 1, number: '102', capacity: 1, ac: false, tags: [], occupants: [] },
      { id: 'r3', block_id: 'blk-b', floor: 2, number: '201', capacity: 2, ac: true, tags: [], occupants: [] },
    ];
    const students: Student[] = [
      makeStudent({ id: 's1', year: 3, cgpa_band: 'A', preferences: ['r1', 'r2', 'r3'] }),
      makeStudent({ id: 's2', year: 3, cgpa_band: 'A', preferences: ['r1', 'r2', 'r3'] }),
      makeStudent({ id: 's3', year: 3, cgpa_band: 'A', preferences: ['r1', 'r2', 'r3'] }),
      makeStudent({ id: 's4', year: 3, cgpa_band: 'A', preferences: ['r1', 'r2', 'r3'] }),
    ];

    const runA = runDeterministicAllotment({
      students,
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'FIXED-SEED-99',
      rules: DEFAULT_RULES,
    });
    const runB = runDeterministicAllotment({
      students: [...students].reverse(),
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'FIXED-SEED-99',
      rules: DEFAULT_RULES,
    });

    expect(runA.results).toEqual(runB.results);
    expect(runA.unallotted).toEqual(runB.unallotted);
  });

  it('strictly enforces room capacity and records explainable unallotted reasons', () => {
    const rooms: Room[] = [
      { id: 'r1', block_id: 'blk-b', floor: 1, number: '101', capacity: 2, ac: true, tags: [], occupants: [] },
    ];
    const students: Student[] = [
      makeStudent({ id: 's1', year: 4, preferences: ['r1'] }),
      makeStudent({ id: 's2', year: 3, preferences: ['r1'] }),
      makeStudent({ id: 's3', year: 1, preferences: ['r1'] }),
    ];

    const out = runDeterministicAllotment({
      students,
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'CAP-TEST',
      rules: DEFAULT_RULES,
    });

    expect(out.results).toHaveLength(2);
    expect(out.roomOccupantsMap['r1']).toHaveLength(2);
    expect(out.unallotted).toHaveLength(1);
    expect(out.unallotted[0].student_id).toBe('s3');
    expect(out.unallotted[0].reason).toContain('reached capacity');
  });

  it('strictly enforces block gender restrictions and rejects invalid room IDs', () => {
    const rooms: Room[] = [
      { id: 'r-boy', block_id: 'blk-b', floor: 1, number: '101', capacity: 2, ac: true, tags: [], occupants: [] },
      { id: 'r-girl', block_id: 'blk-g', floor: 1, number: '101', capacity: 2, ac: true, tags: [], occupants: [] },
    ];
    const students: Student[] = [
      makeStudent({ id: 'm1', gender: 'male', preferences: ['r-girl', 'nonexistent'] }),
      makeStudent({ id: 'f1', gender: 'female', preferences: ['r-boy', 'r-girl'] }),
    ];

    const out = runDeterministicAllotment({
      students,
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'GENDER-TEST',
      rules: DEFAULT_RULES,
    });

    expect(out.results).toHaveLength(1);
    expect(out.results[0].student_id).toBe('f1');
    expect(out.results[0].room_id).toBe('r-girl');
    expect(out.unallotted).toHaveLength(1);
    expect(out.unallotted[0].student_id).toBe('m1');
    expect(out.unallotted[0].reason).toContain('gender-ineligible');
  });

  it('prevents duplicate student assignment even if duplicate records appear in input', () => {
    const rooms: Room[] = [
      { id: 'r1', block_id: 'blk-b', floor: 1, number: '101', capacity: 4, ac: false, tags: [], occupants: [] },
    ];
    const s1 = makeStudent({ id: 'dup-1', preferences: ['r1'] });

    const out = runDeterministicAllotment({
      students: [s1, { ...s1 }],
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'DUP-TEST',
      rules: DEFAULT_RULES,
    });

    expect(out.results).toHaveLength(1);
    expect(out.roomOccupantsMap['r1']).toEqual(['dup-1']);
  });

  it('preserves mutual roommate requests when a 2+ capacity room is available', () => {
    const rooms: Room[] = [
      { id: 'r-single', block_id: 'blk-b', floor: 1, number: '101', capacity: 1, ac: true, tags: [], occupants: [] },
      { id: 'r-double', block_id: 'blk-b', floor: 1, number: '102', capacity: 2, ac: true, tags: [], occupants: [] },
    ];
    const s1 = makeStudent({
      id: 'pair-a',
      year: 4,
      preferences: ['r-single', 'r-double'],
      roommate_requests: ['pair-b'],
    });
    const s2 = makeStudent({
      id: 'pair-b',
      year: 1,
      preferences: ['r-double'],
      roommate_requests: ['pair-a'],
    });

    const out = runDeterministicAllotment({
      students: [s1, s2],
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'PAIR-TEST',
      rules: DEFAULT_RULES,
    });

    expect(out.stats.mutual_pairs_honored).toBe(1);
    expect(out.roomOccupantsMap['r-double']).toEqual(['pair-a', 'pair-b']);
  });

  it('executes Pareto-improving swaps when mutual roommate placement creates a beneficial trade', () => {
    const rooms: Room[] = [
      { id: 'r1', block_id: 'blk-b', floor: 1, number: '101', capacity: 2, ac: true, tags: [], occupants: [] },
      { id: 'r2', block_id: 'blk-b', floor: 1, number: '102', capacity: 1, ac: false, tags: [], occupants: [] },
    ];
    // pair-a (yr 4) & pair-b (yr 1) co-allot into r1 (pair-b actually prefers r2 #1, r1 #2)
    // solo (yr 3) wanted r1 #1, r2 #2 -> lands in r2. Pareto pass swaps pair-b and solo!
    const pairA = makeStudent({
      id: 'pa',
      year: 4,
      preferences: ['r1'],
      roommate_requests: ['pb'],
    });
    const pairB = makeStudent({
      id: 'pb',
      year: 1,
      preferences: ['r2', 'r1'],
      roommate_requests: ['pa'],
    });
    const solo = makeStudent({
      id: 'solo',
      year: 3,
      preferences: ['r1', 'r2'],
    });

    const out = runDeterministicAllotment({
      students: [pairA, pairB, solo],
      rooms,
      blocks: TEST_BLOCKS,
      seed: 'PARETO-TEST',
      rules: { ...DEFAULT_RULES, enable_pareto_pass: true },
    });

    expect(out.stats.pareto_swaps_executed).toBeGreaterThanOrEqual(1);
    const soloAssignment = out.results.find((r) => r.student_id === 'solo');
    const pbAssignment = out.results.find((r) => r.student_id === 'pb');
    expect(soloAssignment?.room_id).toBe('r1');
    expect(pbAssignment?.room_id).toBe('r2');
  });
});
