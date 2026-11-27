import React, { useCallback, useEffect, useState } from 'react';
import {
  Accessibility,
  CheckCircle2,
  ClipboardCheck,
  Play,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Room, SessionUser } from '../../lib/types';
import type {
  AllotmentCycle,
  CycleAllotmentRunSummary,
  HostelApplication,
} from '../../lib/applications/service';
import type { ToastMessage } from '../components/layout/ToastContainer';

interface StaffApplicationsResponse {
  cycles: AllotmentCycle[];
  applications: HostelApplication[];
  runs: CycleAllotmentRunSummary[];
}

export interface AllotmentOperationsPageProps {
  sessionUser: SessionUser;
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

export const AllotmentOperationsPage: React.FC<AllotmentOperationsPageProps> = ({
  sessionUser,
  onToast,
}) => {
  const isAdmin = sessionUser.role === 'ADMIN';
  const [loading, setLoading] = useState(true);
  const [cycles, setCycles] = useState<AllotmentCycle[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [applications, setApplications] = useState<HostelApplication[]>([]);
  const [runs, setRuns] = useState<CycleAllotmentRunSummary[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Execution form (Admin)
  const [seed, setSeed] = useState('VVU-MONSOON-2026-SEED-01');
  const [executing, setExecuting] = useState(false);
  const [latestRun, setLatestRun] = useState<CycleAllotmentRunSummary | null>(null);

  // Manual override form (Admin)
  const [overrideAppId, setOverrideAppId] = useState('');
  const [overrideRoomId, setOverrideRoomId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overriding, setOverriding] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const query = selectedCycleId ? `?cycle_id=${encodeURIComponent(selectedCycleId)}` : '';
      const [appRes, roomsRes] = await Promise.all([
        apiFetch<StaffApplicationsResponse>(`/api/applications${query}`),
        apiFetch<{ rooms: Room[] }>('/api/rooms'),
      ]);
      setCycles(appRes.cycles);
      setApplications(appRes.applications);
      setRuns(appRes.runs);
      setRooms(roomsRes.rooms);
      if (!selectedCycleId && appRes.cycles[0]) {
        setSelectedCycleId(appRes.cycles[0].id);
      }
      if (appRes.runs[0] && !latestRun) {
        setLatestRun(appRes.runs[0]);
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load applications operations desk.'
      );
    } finally {
      setLoading(false);
    }
  }, [latestRun, onToast, selectedCycleId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeCycle = cycles.find((c) => c.id === selectedCycleId) ?? cycles[0] ?? null;

  const handleReviewApp = async (
    app: HostelApplication,
    decision: 'ELIGIBLE' | 'REJECTED',
    verifyAccessibility?: boolean
  ) => {
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/applications/${encodeURIComponent(app.id)}/review`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            decision,
            accessibility_verified:
              verifyAccessibility !== undefined ? verifyAccessibility : app.accessibility_verified,
            review_note:
              decision === 'ELIGIBLE'
                ? 'Application reviewed and confirmed against university hostel policy.'
                : 'Application rejected following institutional policy review.',
          }),
        }
      );
      onToast('success', res.message);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Application review failed.');
    }
  };

  const handleExecuteCycle = async (dryRun: boolean) => {
    if (!activeCycle) return;
    setExecuting(true);
    try {
      const res = await apiFetch<{ run: CycleAllotmentRunSummary; message: string }>(
        `/api/applications/cycles/${encodeURIComponent(activeCycle.id)}/execute`,
        {
          method: 'POST',
          body: JSON.stringify({ seed: seed.trim(), dry_run: dryRun }),
        }
      );
      setLatestRun(res.run);
      onToast('success', res.message);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Allotment execution failed.');
    } finally {
      setExecuting(false);
    }
  };

  const handleManualOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideAppId || !overrideRoomId || overrideReason.trim().length < 10) {
      onToast('error', 'Select application, target room, and enter a 10+ char audit justification.');
      return;
    }
    setOverriding(true);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/applications/${encodeURIComponent(overrideAppId)}/override`,
        {
          method: 'POST',
          body: JSON.stringify({
            target_room_id: overrideRoomId,
            justification: overrideReason.trim(),
          }),
        }
      );
      onToast('success', res.message);
      setOverrideReason('');
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Manual override failed.');
    } finally {
      setOverriding(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Institutional Applications &amp; Allotment Operations...
      </div>
    );
  }

  const eligibleCount = applications.filter((a) => a.status === 'ELIGIBLE').length;
  const waitlistedCount = applications.filter((a) => a.status === 'WAITLISTED').length;
  const allottedCount = applications.filter(
    (a) => a.status === 'ALLOTTED' || a.status === 'ACCEPTED'
  ).length;

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASE 3 · {isAdmin ? 'ADMIN ALLOTMENT ENGINE & GOVERNANCE' : 'WARDEN APPLICATIONS QUEUE'}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              Hostel Applications &amp; Deterministic Allotment
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              Rule-based eligibility review, deterministic waitlist ordering, dry-run simulation, and
              transactional bed allocation respecting Phase 2 operational overrides.
            </p>
          </div>
          {cycles.length > 0 && (
            <select
              value={selectedCycleId}
              onChange={(e) => setSelectedCycleId(e.target.value)}
              className="px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs font-bold text-[#1F2A5A]"
            >
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} ({c.status})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 font-mono-code">
          {[
            { label: 'Total Applications', value: applications.length },
            { label: 'Eligible Queue', value: eligibleCount },
            { label: 'Allotted / Accepted', value: allottedCount },
            { label: 'Waitlisted', value: waitlistedCount },
          ].map((item) => (
            <div key={item.label} className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">{item.label}</span>
              <span className="block text-xl font-bold text-[#1F2A5A] tabular-nums mt-0.5">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Admin Deterministic Cycle Runner */}
      {isAdmin && activeCycle && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <div className="flex items-center gap-2 border-b-2 border-[#1F2A5A] pb-2.5">
            <SlidersHorizontal className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Deterministic Cycle Allotment Runner ({activeCycle.policy.policy_version})
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-[#F1E6CF] border border-[#1F2A5A] p-4">
            <div className="md:col-span-6">
              <label
                htmlFor="allot-seed"
                className="block font-mono-code text-xs font-bold uppercase text-[#1F2A5A] mb-1"
              >
                Reproducible Tie-Breaker Seed
              </label>
              <input
                id="allot-seed"
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="w-full px-3 py-2 bg-[#F8F2E4] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
              />
            </div>
            <div className="md:col-span-3">
              <button
                type="button"
                disabled={executing}
                onClick={() => void handleExecuteCycle(true)}
                className="w-full py-2.5 px-3 bg-[#FBE9A6] text-[#1F2A5A] font-bold text-xs border-2 border-[#1F2A5A] hover:bg-[#F2C94C] inline-flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                Dry-Run Simulation
              </button>
            </div>
            <div className="md:col-span-3">
              <button
                type="button"
                disabled={executing}
                onClick={() => void handleExecuteCycle(false)}
                className="w-full py-2.5 px-3 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420]"
              >
                Commit to Bed Inventory
              </button>
            </div>
          </div>

          {latestRun && (
            <div className="border-2 border-[#1F2A5A] bg-[#F1E6CF] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono-code text-xs">
                <span className="font-bold text-[#1F2A5A]">
                  Run {latestRun.run_id} · {latestRun.committed ? 'COMMITTED' : 'DRY-RUN PREVIEW'} ·
                  Seed: {latestRun.seed}
                </span>
                <span className="text-[#465078] tabular-nums">
                  Allotted: {latestRun.allotted_count} · Waitlisted: {latestRun.waitlisted_count} ·
                  1st Choice: {latestRun.first_choice_count} · Accessibility:{' '}
                  {latestRun.accessibility_honored_count}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b-2 border-[#1F2A5A] font-mono-code uppercase text-[#465078]">
                      <th className="py-1.5 pr-3">Student</th>
                      <th className="py-1.5 pr-3">Score</th>
                      <th className="py-1.5 pr-3">Outcome</th>
                      <th className="py-1.5 pr-3">Room / Bed</th>
                      <th className="py-1.5">Explanation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2A5A]/20">
                    {latestRun.decisions.map((d) => (
                      <tr key={d.application_id}>
                        <td className="py-2 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                          {d.student_name} ({d.student_code})
                        </td>
                        <td className="py-2 pr-3 font-mono-code tabular-nums text-[#1F2A5A]">
                          {d.priority_score}
                        </td>
                        <td className="py-2 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                          {d.outcome}
                          {d.waitlist_position ? ` #${d.waitlist_position}` : ''}
                        </td>
                        <td className="py-2 pr-3 font-mono-code text-[#1F2A5A]">
                          {d.room_label ? `${d.room_label} Bed ${d.bed_label}` : '—'}
                        </td>
                        <td className="py-2 text-[#465078]">{d.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Applications Review Queue & Waitlist Ledger */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
        <div className="flex items-center justify-between border-b-2 border-[#1F2A5A] pb-2.5">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Applications Review Queue &amp; Waitlist
            </h2>
          </div>
          <span className="font-mono-code text-xs text-[#465078] tabular-nums">
            {runs.length} historical run(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-[#1F2A5A] font-mono-code uppercase text-[#465078]">
                <th className="py-2 pr-3">Applicant</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2 pr-3">Accessibility</th>
                <th className="py-2 pr-3">Assignment / Waitlist</th>
                <th className="py-2 text-right">Review Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2A5A]/20">
              {applications.map((app) => (
                <tr key={app.id}>
                  <td className="py-2.5 pr-3">
                    <p className="font-bold text-[#1F2A5A]">
                      {app.student_name}{' '}
                      <span className="font-mono-code text-[11px] text-[#465078]">
                        ({app.student_code})
                      </span>
                    </p>
                    <p className="font-mono-code text-[10px] text-[#465078]">
                      Y{app.student_year} · {app.student_branch} · {app.home_distance_km} km
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                    {app.status}
                  </td>
                  <td className="py-2.5 pr-3 font-mono-code font-bold tabular-nums text-[#1F2A5A]">
                    {app.eligibility.computed_priority_score}
                  </td>
                  <td className="py-2.5 pr-3 font-mono-code text-[11px]">
                    {app.accessibility_requested ? (
                      <span className="inline-flex items-center gap-1 text-[#C2552D] font-bold">
                        <Accessibility className="w-3.5 h-3.5" aria-hidden="true" />
                        {app.accessibility_verified ? 'VERIFIED' : 'REQUESTED'}
                      </span>
                    ) : (
                      <span className="text-[#465078]">None</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 font-mono-code text-[11px] text-[#1F2A5A]">
                    {app.allotment
                      ? `${app.allotment.room_label} Bed ${app.allotment.bed_label}`
                      : app.waitlist_position
                        ? `Waitlist #${app.waitlist_position}`
                        : `${app.preferred_room_ids.length} pref(s)`}
                  </td>
                  <td className="py-2.5 text-right space-x-1.5 whitespace-nowrap">
                    {app.status !== 'ACCEPTED' && app.status !== 'WITHDRAWN' && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void handleReviewApp(
                              app,
                              'ELIGIBLE',
                              app.accessibility_requested ? true : undefined
                            )
                          }
                          className="px-2.5 py-1 bg-[#5E8C6A] text-[#F8F2E4] font-mono-code text-[10px] font-bold border border-[#1F2A5A] inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                          {app.accessibility_requested && !app.accessibility_verified
                            ? 'Verify ADA & Eligible'
                            : 'Mark Eligible'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReviewApp(app, 'REJECTED')}
                          className="px-2.5 py-1 bg-[#B3261E] text-[#F8F2E4] font-mono-code text-[10px] font-bold border border-[#1F2A5A]"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[#465078]">
                    No hostel applications submitted for this cycle yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin Audited Manual Override Panel */}
      {isAdmin && applications.length > 0 && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-[#1F2A5A]/30 pb-2">
            <ShieldAlert className="w-5 h-5 text-[#B3261E]" aria-hidden="true" />
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Audited Manual Bed Override (Admin Only)
            </h2>
          </div>
          <form
            onSubmit={handleManualOverride}
            className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-4">
              <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                Application
              </label>
              <select
                value={overrideAppId}
                onChange={(e) => setOverrideAppId(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
              >
                <option value="">Select applicant...</option>
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.student_name} ({a.student_code}) — {a.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                Target Room
              </label>
              <select
                value={overrideRoomId}
                onChange={(e) => setOverrideRoomId(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
              >
                <option value="">Select room...</option>
                {rooms
                  .filter((r) => r.occupants.length < r.capacity)
                  .slice(0, 60)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} (Fl {r.floor}, {r.occupants.length}/{r.capacity})
                    </option>
                  ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1">
                Audit Justification (Min 10 chars)
              </label>
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Official dean/medical committee order #..."
                className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={overriding}
                className="w-full py-2 bg-[#B3261E] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A]"
              >
                {overriding ? 'Applying...' : 'Commit Override'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
};
