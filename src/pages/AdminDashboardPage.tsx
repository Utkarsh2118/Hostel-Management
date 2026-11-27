import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import type {
  AllotmentRulesConfig,
  AllotmentRun,
  AuditLog,
  Block,
  Dispute,
  DisputeStatus,
  RoomTag,
  SessionUser,
  Student,
  SwapProposal,
} from '../../lib/types';
import type { MapRoomItem } from '../components/rooms/RoomMap';
import { AllotmentRegister } from '../components/allotment/AllotmentRegister';
import { AdminAccountsSecurityPanel } from '../components/admin/AdminAccountsSecurityPanel';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Stamp } from '../components/ui/Stamp';

interface AdminDashboardPageProps {
  sessionUser: SessionUser;
  onSessionRefresh: () => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

type AdminTab = 'security' | 'allotment' | 'inventory' | 'students' | 'disputes' | 'audit' | 'rules';

const ALL_ROOM_TAGS: RoomTag[] = ['quiet', 'near_mess', 'near_stairs', 'corner', 'balcony'];

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  sessionUser,
  onSessionRefresh,
  onToast,
}) => {
  const [tab, setTab] = useState<AdminTab>('allotment');
  const [loading, setLoading] = useState(true);

  // Operational datasets
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [rooms, setRooms] = useState<MapRoomItem[]>([]);
  const [students, setStudents] = useState<Array<Student & { allotted_room_label: string | null }>>([]);
  const [rules, setRules] = useState<AllotmentRulesConfig>({
    year_weight: 25,
    merit_weight: 6,
    enable_merit_band: true,
    preserve_mutual_roommates: true,
    enable_pareto_pass: true,
  });
  const [runs, setRuns] = useState<AllotmentRun[]>([]);
  const [proposals, setProposals] = useState<SwapProposal[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [rulesMd, setRulesMd] = useState('');

  // Allotment run creator + comparison state
  const [runLabel, setRunLabel] = useState('Autumn 2026 — Merit Stress Test');
  const [runSeed, setRunSeed] = useState('AUTUMN-2026-R2');
  const [runningEngine, setRunningEngine] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState<string>('');
  const [compareRightId, setCompareRightId] = useState<string>('');
  const [confirmApplyRun, setConfirmApplyRun] = useState<AllotmentRun | null>(null);

  // Inventory table filters + add room state
  const [roomSearch, setRoomSearch] = useState('');
  const [roomBlockFilter, setRoomBlockFilter] = useState('all');
  const [roomPage, setRoomPage] = useState(1);
  const [newRoomBlock, setNewRoomBlock] = useState('blk-nilgiri');
  const [newRoomFloor, setNewRoomFloor] = useState(1);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomCap, setNewRoomCap] = useState<1 | 2 | 3 | 4>(2);
  const [newRoomAc, setNewRoomAc] = useState(true);
  const [newRoomTags, setNewRoomTags] = useState<RoomTag[]>(['quiet']);

  // Student directory filter
  const [studentSearch, setStudentSearch] = useState('');
  const [studentPage, setStudentPage] = useState(1);

  // Dispute resolution notes map
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [savingRules, setSavingRules] = useState(false);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [roomsRes, studentsRes, rulesRes, runsRes, swapsRes, disputesRes, logsRes, mdRes] =
        await Promise.all([
          apiFetch<{ rooms: MapRoomItem[]; blocks: Block[] }>('/api/rooms'),
          apiFetch<{ students: Array<Student & { allotted_room_label: string | null }> }>(
            '/api/students'
          ),
          apiFetch<{ rules: AllotmentRulesConfig }>('/api/allotment/rules'),
          apiFetch<{ runs: AllotmentRun[] }>('/api/allotment/runs'),
          apiFetch<{ proposals: SwapProposal[] }>('/api/swaps'),
          apiFetch<{ disputes: Dispute[] }>('/api/disputes'),
          apiFetch<{ logs: AuditLog[] }>('/api/audit-logs'),
          apiFetch<{ content: string }>('/api/rules'),
        ]);

      setBlocks(roomsRes.blocks);
      setRooms(roomsRes.rooms);
      setStudents(studentsRes.students);
      setRules(rulesRes.rules);
      setRuns(runsRes.runs);
      setProposals(swapsRes.proposals);
      setDisputes(disputesRes.disputes);
      setAuditLogs(logsRes.logs);
      setRulesMd(mdRes.content);

      if (runsRes.runs.length > 0) {
        setCompareLeftId((prev) => prev || runsRes.runs[0].id);
        setCompareRightId((prev) => prev || (runsRes.runs[1]?.id ?? runsRes.runs[0].id));
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load Warden Office registers.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionUser.role === 'ADMIN') {
      void loadAdminData();
    }
  }, [sessionUser.role]);

  const handleRunAllotment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runSeed.trim()) {
      onToast('error', 'Please enter a deterministic seed string.');
      return;
    }
    setRunningEngine(true);
    try {
      await apiFetch('/api/allotment/rules', {
        method: 'PUT',
        body: JSON.stringify(rules),
      });
      const res = await apiFetch<{ run: AllotmentRun; message: string }>('/api/allotment/runs', {
        method: 'POST',
        body: JSON.stringify({
          label: runLabel.trim() || 'Allotment Run',
          seed: runSeed.trim(),
          rules,
          apply_immediately: false,
        }),
      });
      onToast('success', res.message);
      setCompareRightId(res.run.id);
      await loadAdminData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Allotment run failed.');
    } finally {
      setRunningEngine(false);
    }
  };

  const handleApplyRun = async (run: AllotmentRun) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/allotment/runs/${run.id}/apply`, {
        method: 'POST',
      });
      onToast('success', res.message);
      await loadAdminData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not apply run.');
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomNumber.trim()) {
      onToast('error', 'Enter a room number (e.g., 109).');
      return;
    }
    try {
      await apiFetch('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          block_id: newRoomBlock,
          floor: newRoomFloor,
          number: newRoomNumber.trim(),
          capacity: newRoomCap,
          ac: newRoomAc,
          tags: newRoomTags,
        }),
      });
      onToast('success', `Room ${newRoomNumber.trim()} added to inventory.`);
      setNewRoomNumber('');
      await loadAdminData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to add room.');
    }
  };

  const handleToggleRoomAc = async (room: MapRoomItem) => {
    try {
      await apiFetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ac: !room.ac }),
      });
      onToast('success', `Updated ${room.block_code}-${room.number} AC status.`);
      await loadAdminData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Room update failed.');
    }
  };

  const handleUpdateDispute = async (disputeId: string, status: DisputeStatus) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/disputes/${disputeId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          resolution_note: resolutionDrafts[disputeId] ?? '',
        }),
      });
      onToast('success', res.message);
      await loadAdminData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update dispute.');
    }
  };

  const handleSaveRulesMd = async () => {
    setSavingRules(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/rules', {
        method: 'PUT',
        body: JSON.stringify({ content: rulesMd }),
      });
      onToast('success', res.message);
      await loadAdminData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not save rules.md.');
    } finally {
      setSavingRules(false);
    }
  };

  const filteredRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    return rooms.filter((r) => {
      if (roomBlockFilter !== 'all' && r.block_id !== roomBlockFilter) return false;
      if (!q) return true;
      return (
        `${r.block_code}-${r.number}`.toLowerCase().includes(q) ||
        r.block_name.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q))
      );
    });
  }, [rooms, roomSearch, roomBlockFilter]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.student_code.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q) ||
        (s.allotted_room_label ?? '').toLowerCase().includes(q)
    );
  }, [students, studentSearch]);

  if (sessionUser.role !== 'ADMIN') {
    return null;
  }

  const compareLeft = runs.find((r) => r.id === compareLeftId) ?? runs[0] ?? null;
  const compareRight = runs.find((r) => r.id === compareRightId) ?? runs[1] ?? runs[0] ?? null;

  const roomsPerPage = 14;
  const totalRoomPages = Math.max(1, Math.ceil(filteredRooms.length / roomsPerPage));
  const pagedRooms = filteredRooms.slice((roomPage - 1) * roomsPerPage, roomPage * roomsPerPage);

  const studentsPerPage = 16;
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / studentsPerPage));
  const pagedStudents = filteredStudents.slice(
    (studentPage - 1) * studentsPerPage,
    studentPage * studentsPerPage
  );

  return (
    <div className="space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            CHIEF WARDEN CONTROL REGISTER · VIDYAVIHAR UNIVERSITY
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Hostel Administration Office
          </h1>
        </div>
        <div className="font-mono-code text-xs text-[#1F2A5A] bg-[#FBE9A6] border-2 border-[#1F2A5A] px-3 py-1.5">
          {rooms.length} Rooms · {students.length} Students ·{' '}
          {disputes.filter((d) => d.status === 'open').length} Open Disputes
        </div>
      </header>

      {/* Operational Register Tabs */}
      <nav
        aria-label="Warden administration sections"
        className="flex flex-wrap gap-1.5 border-b-2 border-[#1F2A5A] pb-3"
      >
        {(
          [
            ['security', '00. Accounts & Security'],
            ['allotment', '01. Allotment & Compare'],
            ['inventory', '02. Blocks & Rooms'],
            ['students', '03. Student Register'],
            ['disputes', '04. Swaps & Disputes'],
            ['audit', '05. Analytics & Audit Log'],
            ['rules', '06. Hostel Rules Manual'],
          ] as Array<[AdminTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              'px-3.5 py-2 text-xs font-bold border-2 border-[#1F2A5A] rounded-[2px] whitespace-nowrap transition-colors',
              tab === id
                ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                : 'bg-[#F8F2E4] text-[#1F2A5A] hover:bg-[#FBE9A6]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && runs.length === 0 ? (
        <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
          Loading Warden Office registers...
        </div>
      ) : (
        <>
          {/* TAB 0: Account Provisioning, Role Governance, MFA & Global Security */}
          {tab === 'security' && (
            <AdminAccountsSecurityPanel
              currentUser={sessionUser}
              blocks={blocks}
              onSessionRefresh={onSessionRefresh}
              onToast={onToast}
            />
          )}

          {/* TAB 1: Allotment Engine Config, Execution & Side-by-Side Comparison */}
          {tab === 'allotment' && (
            <div className="space-y-7">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
                {/* Rule Configuration & Seed Runner (5 cols) */}
                <form
                  onSubmit={handleRunAllotment}
                  className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4"
                >
                  <div className="border-b border-[#1F2A5A]/25 pb-2">
                    <h2 className="font-display text-2xl text-[#1F2A5A]">
                      Execute Deterministic Run
                    </h2>
                    <p className="text-xs text-[#465078]">
                      Same seed + same rules guarantees identical assignments across runs.
                    </p>
                  </div>

                  <label className="block">
                    <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Run Label *</span>
                    <input
                      type="text"
                      required
                      value={runLabel}
                      onChange={(e) => setRunLabel(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                      Public Random Tie-Break Seed *
                    </span>
                    <input
                      type="text"
                      required
                      value={runSeed}
                      onChange={(e) => setRunSeed(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono-code bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                        Year Weight ({rules.year_weight})
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={rules.year_weight}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, year_weight: Number(e.target.value) }))
                        }
                        className="w-full px-3 py-1.5 font-mono-code text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
                        Merit Weight ({rules.merit_weight})
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        disabled={!rules.enable_merit_band}
                        value={rules.merit_weight}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, merit_weight: Number(e.target.value) }))
                        }
                        className="w-full px-3 py-1.5 font-mono-code text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] disabled:opacity-40"
                      />
                    </label>
                  </div>

                  <div className="space-y-2 text-xs text-[#1F2A5A] pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rules.enable_merit_band}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, enable_merit_band: e.target.checked }))
                        }
                        className="w-4 h-4 accent-[#C2552D]"
                      />
                      Include CGPA merit band in priority score
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rules.preserve_mutual_roommates}
                        onChange={(e) =>
                          setRules((r) => ({
                            ...r,
                            preserve_mutual_roommates: e.target.checked,
                          }))
                        }
                        className="w-4 h-4 accent-[#C2552D]"
                      />
                      Preserve mutual roommate requests when 2+ slots open
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rules.enable_pareto_pass}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, enable_pareto_pass: e.target.checked }))
                        }
                        className="w-4 h-4 accent-[#C2552D]"
                      />
                      Run post-allotment Pareto-improving exchange pass
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={runningEngine}
                    className="w-full py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
                  >
                    {runningEngine ? 'Running Allotment Engine...' : 'Simulate & Save Allotment Run'}
                  </button>
                </form>

                {/* Side-by-Side Run Comparison Table (7 cols) */}
                <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#1F2A5A]/25 pb-2">
                    <h2 className="font-display text-2xl text-[#1F2A5A]">
                      Side-by-Side Run Comparison
                    </h2>
                    <span className="font-mono-code text-xs text-[#465078]">
                      {runs.length} recorded run(s)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <label className="block">
                      <span className="font-bold text-[#465078] block mb-1">Baseline Run (A)</span>
                      <select
                        value={compareLeft?.id ?? ''}
                        onChange={(e) => setCompareLeftId(e.target.value)}
                        className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] font-medium"
                      >
                        {runs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label} ({r.seed}) {r.applied ? '[ACTIVE]' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="font-bold text-[#465078] block mb-1">Comparison Run (B)</span>
                      <select
                        value={compareRight?.id ?? ''}
                        onChange={(e) => setCompareRightId(e.target.value)}
                        className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] font-medium"
                      >
                        {runs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label} ({r.seed}) {r.applied ? '[ACTIVE]' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {compareLeft && compareRight && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse font-mono-code">
                        <thead>
                          <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF]">
                            <th className="py-2 px-3">Metric</th>
                            <th className="py-2 px-3">Run A ({compareLeft.seed})</th>
                            <th className="py-2 px-3">Run B ({compareRight.seed})</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1F2A5A]/20">
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">Allotted / Total</td>
                            <td className="py-2 px-3">
                              {compareLeft.stats.allotted_count}/{compareLeft.stats.total_students}
                            </td>
                            <td className="py-2 px-3">
                              {compareRight.stats.allotted_count}/{compareRight.stats.total_students}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">Unallotted Students</td>
                            <td className="py-2 px-3">{compareLeft.stats.unallotted_count}</td>
                            <td className="py-2 px-3">{compareRight.stats.unallotted_count}</td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">First-Choice %</td>
                            <td className="py-2 px-3 font-bold text-[#295234]">
                              {compareLeft.stats.first_choice_pct}%
                            </td>
                            <td className="py-2 px-3 font-bold text-[#295234]">
                              {compareRight.stats.first_choice_pct}%
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">Top-3 Choice %</td>
                            <td className="py-2 px-3">{compareLeft.stats.top_three_pct}%</td>
                            <td className="py-2 px-3">{compareRight.stats.top_three_pct}%</td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">Avg Preference Rank</td>
                            <td className="py-2 px-3">#{compareLeft.stats.avg_preference_rank}</td>
                            <td className="py-2 px-3">#{compareRight.stats.avg_preference_rank}</td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">
                              Mutual Pairs / Pareto Swaps
                            </td>
                            <td className="py-2 px-3">
                              {compareLeft.stats.mutual_pairs_honored} /{' '}
                              {compareLeft.stats.pareto_swaps_executed}
                            </td>
                            <td className="py-2 px-3">
                              {compareRight.stats.mutual_pairs_honored} /{' '}
                              {compareRight.stats.pareto_swaps_executed}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-sans font-semibold">Engine Runtime</td>
                            <td className="py-2 px-3">{compareLeft.stats.runtime_ms} ms</td>
                            <td className="py-2 px-3">{compareRight.stats.runtime_ms} ms</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Apply Button for Non-Active Run B */}
                  {compareRight && !compareRight.applied && (
                    <div className="pt-2 flex items-center justify-between gap-3 border-t border-[#1F2A5A]/25">
                      <span className="text-xs text-[#465078]">
                        Run B is a simulation draft. Publish it to update official room assignments.
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmApplyRun(compareRight)}
                        className="px-4 py-2 text-xs font-bold text-[#F8F2E4] bg-[#295234] border-2 border-[#1F2A5A] rounded-[2px] whitespace-nowrap"
                      >
                        Publish Run B Officially
                      </button>
                    </div>
                  )}
                </section>
              </div>

              {compareRight && (
                <AllotmentRegister
                  title={`${compareRight.label} (${compareRight.applied ? 'Active' : 'Simulation'})`}
                  seed={compareRight.seed}
                  entries={compareRight.results}
                />
              )}
            </div>
          )}

          {/* TAB 2: Blocks & Room Inventory Management */}
          {tab === 'inventory' && (
            <div className="space-y-6">
              <form
                onSubmit={handleCreateRoom}
                className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4"
              >
                <h2 className="font-display text-xl text-[#1F2A5A]">Add New Room to Register</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-sm">
                  <label className="block lg:col-span-2">
                    <span className="text-xs font-bold block mb-1">Hostel Block</span>
                    <select
                      value={newRoomBlock}
                      onChange={(e) => setNewRoomBlock(e.target.value)}
                      className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                    >
                      {blocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.gender_type})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold block mb-1">Floor</span>
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={newRoomFloor}
                      onChange={(e) => setNewRoomFloor(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold block mb-1">Room No.</span>
                    <input
                      type="text"
                      required
                      value={newRoomNumber}
                      onChange={(e) => setNewRoomNumber(e.target.value)}
                      placeholder="109"
                      className="w-full px-3 py-2 font-mono-code bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold block mb-1">Capacity</span>
                    <select
                      value={newRoomCap}
                      onChange={(e) => setNewRoomCap(Number(e.target.value) as 1 | 2 | 3 | 4)}
                      className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                    >
                      <option value={1}>1 Bed</option>
                      <option value={2}>2 Beds</option>
                      <option value={3}>3 Beds</option>
                      <option value={4}>4 Beds</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px]"
                    >
                      Add Room
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="inline-flex items-center gap-2 font-bold">
                    <input
                      type="checkbox"
                      checked={newRoomAc}
                      onChange={(e) => setNewRoomAc(e.target.checked)}
                      className="w-4 h-4 accent-[#C2552D]"
                    />
                    AC Equipped
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ALL_ROOM_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setNewRoomTags((prev) =>
                            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                          )
                        }
                        className={`px-2 py-0.5 font-mono-code border border-[#1F2A5A] ${
                          newRoomTags.includes(tag)
                            ? 'bg-[#FBE9A6] font-bold'
                            : 'bg-[#F1E6CF]'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </form>

              <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
                <div className="p-4 border-b-2 border-[#1F2A5A] bg-[#F1E6CF] flex flex-wrap items-center gap-3">
                  <input
                    type="search"
                    value={roomSearch}
                    onChange={(e) => {
                      setRoomSearch(e.target.value);
                      setRoomPage(1);
                    }}
                    placeholder="Search room number, block, tag..."
                    className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                  />
                  <select
                    value={roomBlockFilter}
                    onChange={(e) => {
                      setRoomBlockFilter(e.target.value);
                      setRoomPage(1);
                    }}
                    className="px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                  >
                    <option value="all">All Blocks</option>
                    {blocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF] text-xs font-mono-code">
                        <th className="py-2.5 px-4">Room</th>
                        <th className="py-2.5 px-4">Block &amp; Floor</th>
                        <th className="py-2.5 px-4">Occupancy</th>
                        <th className="py-2.5 px-4">AC</th>
                        <th className="py-2.5 px-4">Tags</th>
                        <th className="py-2.5 px-4">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2A5A]/20">
                      {pagedRooms.map((rm) => (
                        <tr key={rm.id}>
                          <td className="py-2.5 px-4 font-mono-code font-bold">
                            {rm.block_code}-{rm.number}
                          </td>
                          <td className="py-2.5 px-4">
                            {rm.block_name} · Fl {rm.floor}
                          </td>
                          <td className="py-2.5 px-4 font-mono-code">
                            {rm.occupants.length}/{rm.capacity}
                          </td>
                          <td className="py-2.5 px-4 font-mono-code">
                            {rm.ac ? 'AC' : 'Non-AC'}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-[#465078]">
                            {rm.tags.join(' · ') || '—'}
                          </td>
                          <td className="py-2.5 px-4">
                            <button
                              type="button"
                              onClick={() => void handleToggleRoomAc(rm)}
                              className="text-xs font-bold text-[#C2552D] hover:underline whitespace-nowrap"
                            >
                              Toggle AC
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-3 border-t-2 border-[#1F2A5A] bg-[#F1E6CF] flex items-center justify-between text-xs font-mono-code">
                  <span>
                    Page {roomPage} of {totalRoomPages} ({filteredRooms.length} rooms)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={roomPage <= 1}
                      onClick={() => setRoomPage((p) => p - 1)}
                      className="px-3 py-1 bg-[#F8F2E4] border border-[#1F2A5A] disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={roomPage >= totalRoomPages}
                      onClick={() => setRoomPage((p) => p + 1)}
                      className="px-3 py-1 bg-[#F8F2E4] border border-[#1F2A5A] disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 3: Student Directory Register */}
          {tab === 'students' && (
            <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
              <div className="p-4 border-b-2 border-[#1F2A5A] bg-[#F1E6CF] flex flex-wrap items-center justify-between gap-3">
                <input
                  type="search"
                  value={studentSearch}
                  onChange={(e) => {
                    setStudentSearch(e.target.value);
                    setStudentPage(1);
                  }}
                  placeholder="Search student name, ID, branch, or room..."
                  className="flex-1 min-w-[220px] px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                />
                <span className="font-mono-code text-xs text-[#465078]">
                  {filteredStudents.length} student record(s)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF] text-xs font-mono-code">
                      <th className="py-2.5 px-4">ID &amp; Student</th>
                      <th className="py-2.5 px-4">Year / Branch</th>
                      <th className="py-2.5 px-4">Gender</th>
                      <th className="py-2.5 px-4">Band</th>
                      <th className="py-2.5 px-4">Prefs</th>
                      <th className="py-2.5 px-4">Allotted Room</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2A5A]/20">
                    {pagedStudents.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-[#1F2A5A]">{s.name}</div>
                          <div className="font-mono-code text-xs text-[#465078]">
                            {s.student_code}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          Yr {s.year} · {s.branch}
                        </td>
                        <td className="py-2.5 px-4 capitalize">{s.gender}</td>
                        <td className="py-2.5 px-4 font-mono-code">{s.cgpa_band}</td>
                        <td className="py-2.5 px-4 font-mono-code">{s.preferences.length}/5</td>
                        <td className="py-2.5 px-4 font-mono-code font-bold">
                          {s.allotted_room_label ?? (
                            <span className="text-[#B3261E]">Unallotted</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t-2 border-[#1F2A5A] bg-[#F1E6CF] flex items-center justify-between text-xs font-mono-code">
                <span>
                  Page {studentPage} of {totalStudentPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={studentPage <= 1}
                    onClick={() => setStudentPage((p) => p - 1)}
                    className="px-3 py-1 bg-[#F8F2E4] border border-[#1F2A5A] disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={studentPage >= totalStudentPages}
                    onClick={() => setStudentPage((p) => p + 1)}
                    className="px-3 py-1 bg-[#F8F2E4] border border-[#1F2A5A] disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* TAB 4: Swap Oversight & Dispute Resolution */}
          {tab === 'disputes' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
              <section className="lg:col-span-7 space-y-4">
                <h2 className="font-display text-2xl text-[#1F2A5A]">
                  Student Disputes &amp; Special Requests ({disputes.length})
                </h2>
                {disputes.map((d) => (
                  <article
                    key={d.id}
                    className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono-code text-xs text-[#465078]">
                          {d.id} · {d.category.toUpperCase()} · {d.student_name}
                        </p>
                        <h3 className="font-bold text-base text-[#1F2A5A] mt-0.5">{d.subject}</h3>
                      </div>
                      <Stamp
                        label={d.status.replace('_', ' ')}
                        variant={d.status === 'resolved' ? 'green' : 'brick'}
                        size="sm"
                      />
                    </div>
                    <p className="text-sm text-[#1F2A5A]">{d.description}</p>
                    <div className="space-y-2 pt-2 border-t border-[#1F2A5A]/20">
                      <input
                        type="text"
                        value={resolutionDrafts[d.id] ?? d.resolution_note ?? ''}
                        onChange={(e) =>
                          setResolutionDrafts((prev) => ({ ...prev, [d.id]: e.target.value }))
                        }
                        placeholder="Record official warden note..."
                        className="w-full px-3 py-2 text-xs bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
                      />
                      <div className="flex flex-wrap gap-2">
                        {(['under_review', 'resolved', 'dismissed'] as DisputeStatus[]).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => void handleUpdateDispute(d.id, st)}
                            className="px-3 py-1.5 text-xs font-bold bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] capitalize"
                          >
                            Mark {st.replace('_', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </section>

              <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-3">
                <h2 className="font-display text-xl text-[#1F2A5A] border-b border-[#1F2A5A]/25 pb-2">
                  Swap Cycle Proposals ({proposals.length})
                </h2>
                {proposals.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 bg-[#F1E6CF] border border-[#1F2A5A]/40 text-xs space-y-1"
                  >
                    <div className="flex justify-between font-mono-code font-bold">
                      <span>
                        {p.cycle_length}-Way · {p.id}
                      </span>
                      <span className="uppercase text-[#C2552D]">{p.status}</span>
                    </div>
                    <p className="text-[#465078]">{p.feasibility_summary}</p>
                    <p className="font-mono-code text-[#1F2A5A]">
                      Accepted:{' '}
                      {p.cycle.filter((s) => p.acceptances[s.student_id]).length}/{p.cycle.length}
                    </p>
                  </div>
                ))}
              </section>
            </div>
          )}

          {/* TAB 5: Real Occupancy Analytics & Audit Log Register */}
          {tab === 'audit' && (
            <div className="space-y-7">
              {/* Block Utilization Breakdown (Real Data) */}
              <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4">
                <h2 className="font-display text-2xl text-[#1F2A5A]">
                  Live Bhavan Occupancy Analytics
                </h2>
                <div className="space-y-3">
                  {blocks.map((block) => {
                    const bRooms = rooms.filter((r) => r.block_id === block.id);
                    const cap = bRooms.reduce((s, r) => s + r.capacity, 0);
                    const occ = bRooms.reduce((s, r) => s + r.occupants.length, 0);
                    const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
                    return (
                      <div key={block.id} className="space-y-1">
                        <div className="flex items-baseline justify-between text-xs font-mono-code">
                          <span className="font-bold text-[#1F2A5A]">
                            {block.name} ({block.gender_type})
                          </span>
                          <span>
                            {occ}/{cap} beds ({pct}%) · {bRooms.length} rooms
                          </span>
                        </div>
                        <div className="h-4 bg-[#F1E6CF] border border-[#1F2A5A] w-full">
                          <div
                            className="h-full bg-[#5E8C6A]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Chronological Audit Log Table */}
              <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
                <div className="p-4 border-b-2 border-[#1F2A5A] bg-[#F1E6CF]">
                  <h2 className="font-display text-2xl text-[#1F2A5A]">
                    Immutable Audit Log Register
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono-code">
                    <thead>
                      <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF]">
                        <th className="py-2.5 px-4">Timestamp</th>
                        <th className="py-2.5 px-4">Actor</th>
                        <th className="py-2.5 px-4">Action</th>
                        <th className="py-2.5 px-4">Payload</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2A5A]/20">
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="py-2.5 px-4 whitespace-nowrap text-[#465078]">
                            {new Date(log.timestamp).toLocaleString('en-IN')}
                          </td>
                          <td className="py-2.5 px-4">
                            {log.actor} ({log.actor_role})
                          </td>
                          <td className="py-2.5 px-4 font-bold text-[#1F2A5A]">{log.action}</td>
                          <td className="py-2.5 px-4 text-[#465078] max-w-md truncate">
                            {JSON.stringify(log.payload)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB 6: Official rules.md Editor */}
          {tab === 'rules' && (
            <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl text-[#1F2A5A]">
                    Edit Official Hostel Manual (rules.md)
                  </h2>
                  <p className="text-xs text-[#465078]">
                    Updates take effect immediately for the grounded Hostel Information Desk.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingRules}
                  onClick={() => void handleSaveRulesMd()}
                  className="px-4 py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm disabled:opacity-50"
                >
                  {savingRules ? 'Saving...' : 'Publish Rules Update'}
                </button>
              </div>
              <textarea
                rows={18}
                value={rulesMd}
                onChange={(e) => setRulesMd(e.target.value)}
                className="w-full p-4 font-mono-code text-xs bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A]"
              />
            </section>
          )}
        </>
      )}

      {confirmApplyRun && (
        <ConfirmDialog
          open={Boolean(confirmApplyRun)}
          title="Publish Allotment Run Officially?"
          description={`Applying "${confirmApplyRun.label}" (seed: ${confirmApplyRun.seed}) will replace current live room assignments for all ${confirmApplyRun.stats.total_students} students and cancel pending swap proposals.`}
          confirmLabel="Publish Official Allotment"
          onCancel={() => setConfirmApplyRun(null)}
          onConfirm={async () => {
            const target = confirmApplyRun;
            setConfirmApplyRun(null);
            await handleApplyRun(target);
          }}
        />
      )}
    </div>
  );
};
