import { runDeterministicAllotment } from '../lib/allotment/engine.ts';
import { DEFAULT_ALLOTMENT_RULES, generateSyntheticDataset } from '../lib/repo/seedData.ts';
import type { Room, RoomTag } from '../lib/types.ts';

/**
 * Large-Scale Allotment Performance Benchmark
 * Runs deterministic serial dictatorship + mutual roommate preservation + Pareto pass
 * across 1,200 synthetic students and 480 rooms.
 */
function main() {
  const studentCount = 1200;
  const seed = 'BENCHMARK-1200-2026';
  const base = generateSyntheticDataset(studentCount, seed);

  // Scale hostel inventory proportionally to 480 rooms (~1,150 beds) for realistic competition
  const scaledRooms: Room[] = [];
  for (const block of base.blocks) {
    for (let floor = 1; floor <= 6; floor += 1) {
      for (let idx = 1; idx <= 20; idx += 1) {
        const number = `${floor}${String(idx).padStart(2, '0')}`;
        const capacity = (floor === 6 && idx <= 4 ? 1 : idx % 4 === 0 ? 3 : 2) as 1 | 2 | 3 | 4;
        const tags: RoomTag[] = [];
        if (idx === 1 || idx === 20) tags.push('corner');
        if (floor >= 4) tags.push('quiet');
        if (block.has_mess_nearby && floor <= 2) tags.push('near_mess');
        if (idx % 5 === 0) tags.push('balcony');

        scaledRooms.push({
          id: `${block.code.toLowerCase()}-${number}`,
          block_id: block.id,
          floor,
          number,
          capacity,
          ac: idx % 2 === 0,
          tags,
          occupants: [],
        });
      }
    }
  }

  // Re-map student preferences onto scaled rooms for accurate high-contention benchmark
  const boysRoomIds = scaledRooms
    .filter((r) => r.block_id === 'blk-nilgiri' || r.block_id === 'blk-vindhya')
    .map((r) => r.id);
  const girlsRoomIds = scaledRooms
    .filter((r) => r.block_id === 'blk-kaveri' || r.block_id === 'blk-narmada')
    .map((r) => r.id);

  const scaledStudents = base.students.map((s, idx) => {
    const pool = s.gender === 'male' ? boysRoomIds : girlsRoomIds;
    // Skew preferences toward first 60% of rooms (lower floors / popular rooms)
    const prefs: string[] = [];
    for (let p = 0; p < 5; p += 1) {
      const candidate = pool[(idx * 7 + p * 13) % Math.floor(pool.length * 0.75)];
      if (!prefs.includes(candidate)) prefs.push(candidate);
    }
    return { ...s, preferences: prefs, allotted_room_id: null };
  });

  const output = runDeterministicAllotment({
    students: scaledStudents,
    rooms: scaledRooms,
    blocks: base.blocks,
    seed,
    rules: DEFAULT_ALLOTMENT_RULES,
  });

  console.log('=== HostelHub 1,200-Student Allotment Simulation ===');
  console.log(`Seed:                     ${seed}`);
  console.log(`Total Students:           ${output.stats.total_students}`);
  console.log(`Total Rooms:              ${scaledRooms.length}`);
  console.log(`Successful Allotments:    ${output.stats.allotted_count}`);
  console.log(`Unallotted Students:      ${output.stats.unallotted_count}`);
  console.log(`First-Choice Percentage:  ${output.stats.first_choice_pct}%`);
  console.log(`Top-Three Percentage:     ${output.stats.top_three_pct}%`);
  console.log(`Average Preference Rank:  ${output.stats.avg_preference_rank}`);
  console.log(`Mutual Pairs Honored:     ${output.stats.mutual_pairs_honored}`);
  console.log(`Pareto Swaps Executed:    ${output.stats.pareto_swaps_executed}`);
  console.log(`Engine Runtime:           ${output.stats.runtime_ms} ms`);
}

main();
