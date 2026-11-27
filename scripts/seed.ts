import { generateSyntheticDataset } from '../lib/repo/seedData.ts';

function main() {
  const dataset = generateSyntheticDataset(300, 'VIDYAVIHAR-2026');
  const totalCapacity = dataset.rooms.reduce((sum, r) => sum + r.capacity, 0);
  const totalOccupied = dataset.rooms.reduce((sum, r) => sum + r.occupants.length, 0);
  const run = dataset.runs[0];

  console.log('=== HostelHub Synthetic Dataset Summary ===');
  console.log(`Blocks:             ${dataset.blocks.length} (2 boys, 2 girls)`);
  console.log(`Rooms:              ${dataset.rooms.length} (Total bed capacity: ${totalCapacity})`);
  console.log(`Students:           ${dataset.students.length} (Synthetic data only)`);
  console.log(`Occupied Beds:      ${totalOccupied}/${totalCapacity}`);
  console.log(`Baseline Run:       ${run.label} (Seed: ${run.seed})`);
  console.log(`Allotted:           ${run.stats.allotted_count}/${run.stats.total_students}`);
  console.log(`Unallotted:         ${run.stats.unallotted_count}`);
  console.log(`1st Choice Rate:    ${run.stats.first_choice_pct}%`);
  console.log(`Top-3 Choice Rate:  ${run.stats.top_three_pct}%`);
  console.log(`Avg Pref Rank:      ${run.stats.avg_preference_rank}`);
  console.log(`Swap Notices:       ${dataset.swapRequests.length}`);
  console.log(`Pending Proposals:  ${dataset.swapProposals.length}`);
}

main();
