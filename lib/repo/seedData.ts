import {
  AllotmentRulesConfig,
  AllotmentRun,
  Announcement,
  AuditLog,
  Block,
  CgpaBand,
  Dispute,
  Room,
  RoomTag,
  Student,
  SwapProposal,
  SwapRequest,
} from '../types.ts';
import { createSeededRng } from '../utils/prng.ts';
import { runDeterministicAllotment } from '../allotment/engine.ts';

const MALE_FIRST_NAMES = [
  'Aarav', 'Rohan', 'Kabir', 'Siddharth', 'Vikram', 'Aditya', 'Pranav', 'Arjun',
  'Karan', 'Nikhil', 'Devansh', 'Harsh', 'Manav', 'Ishaan', 'Raghav', 'Varun',
  'Yash', 'Tanmay', 'Shubham', 'Utkarsh', 'Ayush', 'Gaurav', 'Saurabh', 'Aniket',
  'Chinmay', 'Mayank', 'Piyush', 'Ritvik', 'Saksham', 'Tushar',
];

const FEMALE_FIRST_NAMES = [
  'Ananya', 'Diya', 'Meera', 'Kavya', 'Ishita', 'Riya', 'Sanya', 'Nandini',
  'Priya', 'Shreya', 'Aishwarya', 'Tanvi', 'Niharika', 'Aditi', 'Bhavna', 'Kritika',
  'Mansi', 'Pallavi', 'Roshni', 'Sakshi', 'Simran', 'Sneha', 'Swati', 'Trisha',
  'Vaishnavi', 'Vidhi', 'Charvi', 'Devika', 'Gargi', 'Harshita',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Nair', 'Kulkarni', 'Iyer', 'Reddy', 'Gupta',
  'Deshmukh', 'Joshi', 'Mehta', 'Singh', 'Rao', 'Banerjee', 'Chatterjee', 'Bose',
  'Mishra', 'Tiwari', 'Agarwal', 'Chauhan', 'Malhotra', 'Menon', 'Pillai', 'Saxena',
  'Bhattacharya', 'Tripathi', 'Pandey', 'Srivastava', 'Gokhale', 'Bhardwaj',
];

const BRANCHES = [
  'Computer Science',
  'Electrical Engineering',
  'Mechanical Engineering',
  'Electronics & Comm.',
  'Civil Engineering',
  'Mathematics & Computing',
  'Chemical Engineering',
  'Biotechnology',
];

const CGPA_BANDS: CgpaBand[] = ['A+', 'A', 'B+', 'B', 'C'];

const BIO_SNIPPETS = [
  'Competitive programmer, usually headphones on after 11 PM, likes a tidy desk.',
  'Plays badminton at 6:30 AM, prefers quiet mornings and organized shelves.',
  'Robotics club builder, keeps late lab hours before fests, respectful of quiet hours.',
  'Enjoys filter coffee, group problem-solving before midsems, and clean floors.',
  'Prepares for GATE/research internships, appreciates calm evenings and minimal clutter.',
  'Acoustic guitar on weekends (never during quiet hours), early riser, vegetarian mess regular.',
  'Works on open-source web projects at night, dim desk lamp only after midnight.',
  'Debate society member, likes lively evening discussions and neat study tables.',
];

export const DEFAULT_ALLOTMENT_RULES: AllotmentRulesConfig = {
  year_weight: 25,
  merit_weight: 6,
  enable_merit_band: true,
  preserve_mutual_roommates: true,
  enable_pareto_pass: true,
};

export interface SeedDataset {
  blocks: Block[];
  rooms: Room[];
  students: Student[];
  runs: AllotmentRun[];
  swapRequests: SwapRequest[];
  swapProposals: SwapProposal[];
  announcements: Announcement[];
  disputes: Dispute[];
  auditLogs: AuditLog[];
  rules: AllotmentRulesConfig;
}

export function generateSyntheticDataset(studentCount = 300, seed = 'VIDYAVIHAR-2026'): SeedDataset {
  const rng = createSeededRng(seed);

  const blocks: Block[] = [
    {
      id: 'blk-nilgiri',
      name: 'Nilgiri Bhavan',
      code: 'NB',
      gender_type: 'boys',
      floors: 4,
      has_mess_nearby: true,
      warden_name: 'Dr. Rajeev Deshpande',
      description: 'East wing boys hostel directly connected to the Central Mess walkway.',
    },
    {
      id: 'blk-vindhya',
      name: 'Vindhya Bhavan',
      code: 'VB',
      gender_type: 'boys',
      floors: 4,
      has_mess_nearby: false,
      warden_name: 'Prof. Arvind Subramanian',
      description: 'North courtyard boys hostel facing the cricket oval and academic complex.',
    },
    {
      id: 'blk-kaveri',
      name: 'Kaveri Bhavan',
      code: 'KB',
      gender_type: 'girls',
      floors: 4,
      has_mess_nearby: true,
      warden_name: 'Dr. Sunita Kulkarni',
      description: 'Central girls hostel adjacent to the Central Mess and Health Centre.',
    },
    {
      id: 'blk-narmada',
      name: 'Narmada Bhavan',
      code: 'NM',
      gender_type: 'girls',
      floors: 4,
      has_mess_nearby: false,
      warden_name: 'Dr. Meenakshi Nair',
      description: 'Quiet west-garden girls hostel overlooking the Central Library lawn.',
    },
  ];

  // Generate 120 rooms (30 rooms per block: 4 floors -> 8, 8, 7, 7 rooms per floor)
  // Total capacity across 120 rooms is ~280-296 beds so 300 students create genuine competition.
  const rooms: Room[] = [];
  const roomsPerFloorPattern = [8, 8, 7, 7];

  for (const block of blocks) {
    for (let floor = 1; floor <= block.floors; floor += 1) {
      const count = roomsPerFloorPattern[floor - 1];
      for (let idx = 1; idx <= count; idx += 1) {
        const numStr = `${floor}${String(idx).padStart(2, '0')}`;
        const roomId = `${block.code.toLowerCase()}-${numStr}`;

        // Capacity mix: Floor 4 has more 1-seaters; lower floors have 2 & 3-seaters; select 4-seaters on Floor 1
        let capacity: 1 | 2 | 3 | 4;
        if (floor === 4 && idx <= 3) {
          capacity = 1;
        } else if (floor === 1 && idx <= 2) {
          capacity = 4;
        } else if (idx % 3 === 0) {
          capacity = 3;
        } else {
          capacity = 2;
        }

        // AC rooms ~40% (higher concentration on floors 2 & 3)
        const ac = (floor === 2 || floor === 3) ? idx % 2 === 1 : idx % 3 === 1;

        const tags: RoomTag[] = [];
        if (idx === 1 || idx === count) tags.push('corner');
        if (idx === Math.ceil(count / 2)) tags.push('near_stairs');
        if (floor >= 3 && idx !== Math.ceil(count / 2)) tags.push('quiet');
        if (block.has_mess_nearby && floor <= 2) tags.push('near_mess');
        if (floor >= 2 && (idx === 2 || idx === count - 1)) tags.push('balcony');

        rooms.push({
          id: roomId,
          block_id: block.id,
          floor,
          number: numStr,
          capacity,
          ac,
          tags,
          occupants: [],
        });
      }
    }
  }

  const boysRooms = rooms.filter(
    (r) => r.block_id === 'blk-nilgiri' || r.block_id === 'blk-vindhya'
  );
  const girlsRooms = rooms.filter(
    (r) => r.block_id === 'blk-kaveri' || r.block_id === 'blk-narmada'
  );

  // Compute realistic popularity weights (strong demand for AC, lower floors, near_mess, quiet)
  const roomWeight = (r: Room): number => {
    let w = 10;
    if (r.ac) w += 18;
    if (r.floor <= 2) w += 12;
    if (r.tags.includes('near_mess')) w += 14;
    if (r.tags.includes('balcony')) w += 8;
    if (r.tags.includes('quiet')) w += 6;
    if (r.capacity === 1) w += 10;
    if (r.capacity === 2) w += 8;
    return w;
  };

  const pickWeightedPreferences = (pool: Room[], count: number): string[] => {
    const selected: string[] = [];
    const remaining = [...pool];
    for (let k = 0; k < count && remaining.length > 0; k += 1) {
      const totalW = remaining.reduce((sum, r) => sum + roomWeight(r), 0);
      let cursor = rng() * totalW;
      let chosenIdx = 0;
      for (let i = 0; i < remaining.length; i += 1) {
        cursor -= roomWeight(remaining[i]);
        if (cursor <= 0) {
          chosenIdx = i;
          break;
        }
      }
      selected.push(remaining[chosenIdx].id);
      remaining.splice(chosenIdx, 1);
    }
    return selected;
  };

  const students: Student[] = [];
  const half = Math.floor(studentCount / 2);

  for (let i = 0; i < studentCount; i += 1) {
    const isMale = i < half;
    const gender: Student['gender'] = isMale ? 'male' : 'female';
    const firstPool = isMale ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES;
    const firstName = firstPool[i % firstPool.length];
    const lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];

    // Deterministic showcase demo students at indices 0..5 (boys) and half..half+2 (girls)
    const id = `stu-${String(i + 1).padStart(3, '0')}`;
    const yearRoll = rng();
    const year: 1 | 2 | 3 | 4 =
      i === 0
        ? 3
        : i === half
          ? 3
          : yearRoll < 0.24
            ? 4
            : yearRoll < 0.52
              ? 3
              : yearRoll < 0.78
                ? 2
                : 1;

    const entryYear = 2027 - year;
    const branch = BRANCHES[Math.floor(rng() * BRANCHES.length)];
    const branchCode = branch.slice(0, 2).toUpperCase();
    const student_code = `VV${entryYear}${branchCode}${String(i + 101).padStart(3, '0')}`;
    const cgpa_band = CGPA_BANDS[Math.floor(rng() * CGPA_BANDS.length)];
    const sleep_schedule: Student['sleep_schedule'] = rng() < 0.42 ? 'early' : 'late';
    const study_style: Student['study_style'] = rng() < 0.58 ? 'quiet' : 'group';
    const cleanliness = (Math.floor(rng() * 5) + 1) as 1 | 2 | 3 | 4 | 5;
    const about_me = BIO_SNIPPETS[Math.floor(rng() * BIO_SNIPPETS.length)];

    const eligiblePool = isMale ? boysRooms : girlsRooms;
    const preferences = pickWeightedPreferences(eligiblePool, 5);

    const cleanName = i === 0 ? 'Rohan Kulkarni' : i === half ? 'Ananya Iyer' : `${firstName} ${lastName}`;
    const emailSlug = cleanName.toLowerCase().replace(/[^a-z]+/g, '.');

    students.push({
      id,
      student_code,
      name: cleanName,
      email: `${emailSlug}.${i + 1}@univ.edu.in`,
      year,
      branch: i === 0 ? 'Computer Science' : i === half ? 'Mathematics & Computing' : branch,
      gender,
      cgpa_band: i === 0 ? 'A' : i === half ? 'A+' : cgpa_band,
      sleep_schedule: i === 0 ? 'late' : sleep_schedule,
      study_style: i === 0 ? 'quiet' : study_style,
      cleanliness: i === 0 ? 4 : cleanliness,
      about_me:
        i === 0
          ? '3rd-year CS student building distributed systems projects. Late sleeper, keeps desk neat, prefers quiet study.'
          : i === half
            ? 'Math & Computing junior, morning runner, quiet room fan, enjoys group revision before exams.'
            : about_me,
      preferences,
      roommate_requests: [],
      allotted_room_id: null,
    });
  }

  // Create realistic mutual roommate pairs across same-gender students
  for (let p = 10; p < 30; p += 2) {
    if (students[p] && students[p + 1] && students[p].gender === students[p + 1].gender) {
      students[p].roommate_requests.push(students[p + 1].id);
      students[p + 1].roommate_requests.push(students[p].id);
    }
  }
  // Demo student stu-001 has one incoming roommate request for realism
  if (students[2] && students[0]) {
    students[2].roommate_requests.push(students[0].id);
  }

  // Execute initial baseline allotment run and apply it so HostelHub starts populated with live data
  const initialSeed = 'AUTUMN-2026-R1';
  const engineOut = runDeterministicAllotment({
    students,
    rooms,
    blocks,
    seed: initialSeed,
    rules: DEFAULT_ALLOTMENT_RULES,
  });

  // Apply occupants to rooms & allotted_room_id to students
  for (const room of rooms) {
    room.occupants = engineOut.roomOccupantsMap[room.id] ?? [];
  }
  const assignmentByStudent = new Map(engineOut.results.map((r) => [r.student_id, r]));
  for (const student of students) {
    student.allotted_room_id = assignmentByStudent.get(student.id)?.room_id ?? null;
  }

  const initialRun: AllotmentRun = {
    id: 'run-2026-01',
    label: 'Autumn 2026 — Official Round 1',
    seed: initialSeed,
    rules_snapshot: { ...DEFAULT_ALLOTMENT_RULES },
    results: engineOut.results,
    unallotted: engineOut.unallotted,
    stats: engineOut.stats,
    applied: true,
    created_by: 'warden@univ.edu.in',
    created_at: '2026-07-18T10:15:00.000Z',
  };

  // Seed realistic open swap requests forming:
  // 1) A clear 3-way boys cycle involving demo student stu-001 (Rohan) -> stu-004 -> stu-007 -> stu-001
  // 2) A direct 2-way girls cycle involving demo student stu-151 (Ananya) <-> stu-154
  // 3) Additional open marketplace chits on the board for browsing and matching
  const swapRequests: SwapRequest[] = [];
  const swapProposals: SwapProposal[] = [];

  const allottedBoys = students.filter((s) => s.gender === 'male' && s.allotted_room_id !== null);
  const allottedGirls = students.filter((s) => s.gender === 'female' && s.allotted_room_id !== null);

  // Distinct rooms for 3-way boys cycle (ensuring demo student stu-001 is included if allotted)
  const boyCycleStudents: Student[] = [];
  const usedRooms = new Set<string>();
  for (const s of allottedBoys) {
    if (s.allotted_room_id && !usedRooms.has(s.allotted_room_id)) {
      boyCycleStudents.push(s);
      usedRooms.add(s.allotted_room_id);
      if (boyCycleStudents.length === 3) break;
    }
  }

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  if (boyCycleStudents.length === 3) {
    const [b0, b1, b2] = boyCycleStudents;
    const r0 = roomById.get(b0.allotted_room_id!)!;
    const r1 = roomById.get(b1.allotted_room_id!)!;
    const r2 = roomById.get(b2.allotted_room_id!)!;

    swapRequests.push(
      {
        id: 'swreq-101',
        student_id: b0.id,
        current_room_id: r0.id,
        wanted_criteria: {
          preferred_room_ids: [r1.id],
          ac: r1.ac,
          note: 'Looking for a room closer to friends in my study group before midsems.',
        },
        status: 'matched',
        created_at: '2026-11-21T09:10:00.000Z',
      },
      {
        id: 'swreq-102',
        student_id: b1.id,
        current_room_id: r1.id,
        wanted_criteria: {
          preferred_room_ids: [r2.id],
          block_id: r2.block_id,
          note: 'Prefer switching to the quieter wing near the library shortcut.',
        },
        status: 'matched',
        created_at: '2026-11-21T11:40:00.000Z',
      },
      {
        id: 'swreq-103',
        student_id: b2.id,
        current_room_id: r2.id,
        wanted_criteria: {
          preferred_room_ids: [r0.id],
          block_id: r0.block_id,
          note: 'Want a room closer to the Central Mess entrance for early classes.',
        },
        status: 'matched',
        created_at: '2026-11-22T08:20:00.000Z',
      }
    );

    const lbl = (r: Room) => `${blockById.get(r.block_id)!.code}-${r.number}`;
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    swapProposals.push({
      id: 'swprop-301',
      cycle: [
        {
          student_id: b0.id,
          student_name: b0.name,
          student_code: b0.student_code,
          request_id: 'swreq-101',
          from_room_id: r0.id,
          from_room_label: lbl(r0),
          to_room_id: r1.id,
          to_room_label: lbl(r1),
          reason: `Exact target room match (#1 on wishlist: ${r1.number}).`,
        },
        {
          student_id: b1.id,
          student_name: b1.name,
          student_code: b1.student_code,
          request_id: 'swreq-102',
          from_room_id: r1.id,
          from_room_label: lbl(r1),
          to_room_id: r2.id,
          to_room_label: lbl(r2),
          reason: `Exact target room match (#1 on wishlist: ${r2.number}).`,
        },
        {
          student_id: b2.id,
          student_name: b2.name,
          student_code: b2.student_code,
          request_id: 'swreq-103',
          from_room_id: r2.id,
          from_room_label: lbl(r2),
          to_room_id: r0.id,
          to_room_label: lbl(r0),
          reason: `Exact target room match (#1 on wishlist: ${r0.number}).`,
        },
      ],
      cycle_length: 3,
      score: 150,
      feasibility_summary:
        '3-way rotation cycle: all 3 rooms retain valid capacity and boys-block eligibility.',
      acceptances: {
        [b0.id]: false, // Pending demo student Rohan's action!
        [b1.id]: true,
        [b2.id]: true,
      },
      rejected_by: null,
      status: 'pending',
      created_at: '2026-11-22T14:00:00.000Z',
      expires_at: expiresAt,
      executed_at: null,
    });
  }

  // Open 2-way girls pair + open boys requests ready to be matched via "Run Cycle Matcher"
  const girlPair: Student[] = [];
  const usedGirlRooms = new Set<string>();
  for (const s of allottedGirls) {
    if (s.allotted_room_id && !usedGirlRooms.has(s.allotted_room_id)) {
      girlPair.push(s);
      usedGirlRooms.add(s.allotted_room_id);
      if (girlPair.length === 2) break;
    }
  }
  if (girlPair.length === 2) {
    const [g0, g1] = girlPair;
    const gr0 = roomById.get(g0.allotted_room_id!)!;
    const gr1 = roomById.get(g1.allotted_room_id!)!;
    swapRequests.push(
      {
        id: 'swreq-104',
        student_id: g0.id,
        current_room_id: gr0.id,
        wanted_criteria: {
          preferred_room_ids: [gr1.id],
          ac: gr1.ac,
          note: 'Looking to shift near the Health Centre side of Kaveri Bhavan.',
        },
        status: 'open',
        created_at: '2026-11-23T10:05:00.000Z',
      },
      {
        id: 'swreq-105',
        student_id: g1.id,
        current_room_id: gr1.id,
        wanted_criteria: {
          preferred_room_ids: [gr0.id],
          block_id: gr0.block_id,
          note: 'Prefer a quieter corridor overlooking the library lawn.',
        },
        status: 'open',
        created_at: '2026-11-23T11:30:00.000Z',
      }
    );
  }

  // Extra open notices on the Swap Notice Board (4 more boys forming a discoverable 2-way or open board chits)
  const extraBoys = allottedBoys
    .filter((s) => !boyCycleStudents.some((b) => b.id === s.id))
    .slice(0, 4);
  extraBoys.forEach((student, idx) => {
    const currentRoom = roomById.get(student.allotted_room_id!)!;
    const targetRoom =
      idx === 0 && extraBoys[1]
        ? roomById.get(extraBoys[1].allotted_room_id!)!
        : idx === 1 && extraBoys[0]
          ? roomById.get(extraBoys[0].allotted_room_id!)!
          : null;
    swapRequests.push({
      id: `swreq-10${6 + idx}`,
      student_id: student.id,
      current_room_id: currentRoom.id,
      wanted_criteria: targetRoom
        ? {
            preferred_room_ids: [targetRoom.id],
            ac: targetRoom.ac,
            note:
              idx === 0
                ? 'Need an AC room on a lower floor due to morning lab schedule.'
                : 'Happy to move to a quieter upper floor away from the mess stairs.',
          }
        : {
            block_id: currentRoom.block_id,
            floor_max: 2,
            ac: true,
            note:
              idx === 2
                ? 'Seeking any AC double room on Floor 1 or 2 near the mess.'
                : 'Looking for a balcony or quiet corner room in Vindhya or Nilgiri.',
          },
      status: 'open',
      created_at: `2026-11-2${Math.min(4, idx + 1)}T15:20:00.000Z`,
    });
  });

  const announcements: Announcement[] = [
    {
      id: 'ann-01',
      title: 'Autumn 2026 Round 1 Allotment Published',
      body: 'Allotment results generated under seed AUTUMN-2026-R1 are now posted. Students allotted a room must collect brass room keys from their Bhavan Ground Floor Desk (Room G-01) within 48 hours.',
      issued_by: 'Office of the Chief Warden',
      priority: 'urgent',
      date: '2026-11-20',
    },
    {
      id: 'ann-02',
      title: 'Room Swap Window Open Until 30 Nov',
      body: 'Direct 2-way, 3-way, and 4-way room exchange proposals must be posted and accepted by all participants on HostelHub. Informal verbal room swaps are not recognized by the Estate Office.',
      issued_by: 'Hostel Allotment Committee',
      priority: 'notice',
      date: '2026-11-22',
    },
    {
      id: 'ann-03',
      title: 'Central Mess Winter Menu & Sunday Brunch Timings',
      body: 'Weekend breakfast will run from 8:00 AM to 10:00 AM starting this Saturday. Students applying for 5+ day mess rebate must submit intimation 24 hours prior.',
      issued_by: 'Mess Warden, Nilgiri & Kaveri',
      priority: 'circular',
      date: '2026-11-23',
    },
  ];

  const disputes: Dispute[] = [
    {
      id: 'disp-01',
      student_id: students[12]?.id ?? 'stu-013',
      student_name: students[12]?.name ?? 'Vikram Patel',
      category: 'allotment',
      subject: 'Medical ground floor preference request',
      description:
        'Recovering from a knee ligament injury; requesting review for ground or 1st-floor room near stairs.',
      status: 'under_review',
      resolution_note: 'Medical certificate verified by Health Centre; awaiting 1st-floor vacancy.',
      created_at: '2026-11-21T10:30:00.000Z',
      updated_at: '2026-11-22T16:15:00.000Z',
    },
    {
      id: 'disp-02',
      student_id: students[160]?.id ?? 'stu-161',
      student_name: students[160]?.name ?? 'Nandini Rao',
      category: 'room_condition',
      subject: 'Split AC remote and thermostat inspection in Kaveri',
      description: 'AC unit turns on manually but remote sensor does not respond to temperature changes.',
      status: 'open',
      resolution_note: null,
      created_at: '2026-11-23T09:00:00.000Z',
      updated_at: '2026-11-23T09:00:00.000Z',
    },
  ];

  const auditLogs: AuditLog[] = [
    {
      id: 'aud-001',
      actor: 'admin.demo@hostelhub.local',
      actor_role: 'ADMIN',
      action: 'ALLOTMENT_RUN_EXECUTED',
      payload: {
        run_id: initialRun.id,
        seed: initialSeed,
        allotted: initialRun.stats.allotted_count,
        unallotted: initialRun.stats.unallotted_count,
      },
      timestamp: '2026-07-18T10:15:00.000Z',
    },
    {
      id: 'aud-002',
      actor: 'admin.demo@hostelhub.local',
      actor_role: 'ADMIN',
      action: 'ALLOTMENT_RUN_APPLIED',
      payload: { run_id: initialRun.id },
      timestamp: '2026-07-18T10:18:00.000Z',
    },
    {
      id: 'aud-003',
      actor: 'system',
      actor_role: 'system',
      action: 'SWAP_PROPOSAL_CREATED',
      payload: { proposal_id: 'swprop-301', cycle_length: 3 },
      timestamp: '2026-11-22T14:00:00.000Z',
    },
  ];

  return {
    blocks,
    rooms,
    students,
    runs: [initialRun],
    swapRequests,
    swapProposals,
    announcements,
    disputes,
    auditLogs,
    rules: { ...DEFAULT_ALLOTMENT_RULES },
  };
}
