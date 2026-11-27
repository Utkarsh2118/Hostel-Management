import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  CheckCircle2,
  ClipboardList,
  FileCheck,
  Printer,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Block, Room, Student } from '../../lib/types';
import type {
  AllotmentCycle,
  HostelApplication,
  OfficialAllotmentSlip,
} from '../../lib/applications/service';
import type { ToastMessage } from '../components/layout/ToastContainer';

interface MyApplicationsResponse {
  cycles: AllotmentCycle[];
  applications: HostelApplication[];
}

interface RoomsResponse {
  blocks: Block[];
  rooms: Room[];
}

export interface StudentApplicationsPageProps {
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-[#F1E6CF] text-[#1F2A5A]',
  SUBMITTED: 'bg-[#FBE9A6] text-[#1F2A5A]',
  UNDER_REVIEW: 'bg-[#F2C94C] text-[#1F2A5A]',
  ELIGIBLE: 'bg-[#5E8C6A] text-[#F8F2E4]',
  WAITLISTED: 'bg-[#C2552D] text-[#F8F2E4]',
  ALLOTTED: 'bg-[#1F2A5A] text-[#F8F2E4]',
  ACCEPTED: 'bg-[#5E8C6A] text-[#F8F2E4]',
  DECLINED: 'bg-[#465078] text-[#F8F2E4]',
  REJECTED: 'bg-[#B3261E] text-[#F8F2E4]',
  WITHDRAWN: 'bg-[#465078] text-[#F8F2E4]',
};

export const StudentApplicationsPage: React.FC<StudentApplicationsPageProps> = ({ onToast }) => {
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [cycles, setCycles] = useState<AllotmentCycle[]>([]);
  const [applications, setApplications] = useState<HostelApplication[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [slip, setSlip] = useState<OfficialAllotmentSlip | null>(null);

  // Form state
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [preferredRoomIds, setPreferredRoomIds] = useState<string[]>([]);
  const [preferredAc, setPreferredAc] = useState<'any' | 'ac' | 'non_ac'>('any');
  const [preferredCap, setPreferredCap] = useState<string>('any');
  const [homeDistanceKm, setHomeDistanceKm] = useState<number>(220);
  const [accessibilityRequested, setAccessibilityRequested] = useState(false);
  const [accessibilityNote, setAccessibilityNote] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [responding, setResponding] = useState(false);

  const loadSlipIfAllotted = useCallback(async (apps: HostelApplication[]) => {
    const allotted = apps.find(
      (a) => (a.status === 'ALLOTTED' || a.status === 'ACCEPTED') && a.allotment
    );
    if (!allotted) {
      setSlip(null);
      return;
    }
    try {
      const res = await apiFetch<{ slip: OfficialAllotmentSlip }>(
        `/api/applications/${encodeURIComponent(allotted.id)}/slip`
      );
      setSlip(res.slip);
    } catch {
      setSlip(null);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, appRes, roomsRes] = await Promise.all([
        apiFetch<{ student: Student }>('/api/students/me'),
        apiFetch<MyApplicationsResponse>('/api/applications/me'),
        apiFetch<RoomsResponse>('/api/rooms'),
      ]);
      setStudent(meRes.student);
      setCycles(appRes.cycles);
      setApplications(appRes.applications);
      setRooms(roomsRes.rooms);
      setBlocks(roomsRes.blocks);

      const openCycle = appRes.cycles.find((c) => c.status === 'OPEN') ?? appRes.cycles[0];
      const targetCycleId = selectedCycleId || openCycle?.id || '';
      setSelectedCycleId(targetCycleId);

      const existing = appRes.applications.find(
        (a) => a.cycle_id === targetCycleId && a.status !== 'WITHDRAWN'
      );
      if (existing) {
        setPreferredRoomIds(existing.preferred_room_ids);
        setPreferredAc(
          existing.preferred_ac === null ? 'any' : existing.preferred_ac ? 'ac' : 'non_ac'
        );
        setPreferredCap(existing.preferred_capacity ? String(existing.preferred_capacity) : 'any');
        setHomeDistanceKm(existing.home_distance_km);
        setAccessibilityRequested(existing.accessibility_requested);
        setAccessibilityNote(existing.accessibility_note ?? '');
        setDeclarationAccepted(existing.declaration_accepted);
      } else {
        setPreferredRoomIds(meRes.student.preferences.slice(0, 5));
      }

      await loadSlipIfAllotted(appRes.applications);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load hostel applications desk.'
      );
    } finally {
      setLoading(false);
    }
  }, [loadSlipIfAllotted, onToast, selectedCycleId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const activeCycle = useMemo(
    () => cycles.find((c) => c.id === selectedCycleId) ?? cycles[0] ?? null,
    [cycles, selectedCycleId]
  );

  const activeApp = useMemo(
    () =>
      applications.find(
        (a) => a.cycle_id === activeCycle?.id && a.status !== 'WITHDRAWN'
      ) ?? null,
    [activeCycle?.id, applications]
  );

  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const compatibleRooms = useMemo(() => {
    if (!student) return [];
    return rooms.filter((r) => {
      const blk = blockMap.get(r.block_id);
      if (!blk) return false;
      return (
        (student.gender === 'male' && blk.gender_type === 'boys') ||
        (student.gender === 'female' && blk.gender_type === 'girls')
      );
    });
  }, [blockMap, rooms, student]);

  const togglePreferredRoom = (roomId: string) => {
    setPreferredRoomIds((prev) => {
      if (prev.includes(roomId)) {
        return prev.filter((id) => id !== roomId);
      }
      if (prev.length >= 5) {
        onToast('info', 'Maximum 5 ranked room preferences allowed per cycle.');
        return prev;
      }
      return [...prev, roomId];
    });
  };

  const handleSave = async (submitNow: boolean) => {
    if (!activeCycle) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ application: HostelApplication; message: string }>(
        '/api/applications',
        {
          method: 'POST',
          body: JSON.stringify({
            cycle_id: activeCycle.id,
            preferred_room_ids: preferredRoomIds,
            preferred_ac: preferredAc === 'any' ? null : preferredAc === 'ac',
            preferred_capacity:
              preferredCap === 'any' ? null : (Number(preferredCap) as 1 | 2 | 3 | 4),
            home_distance_km: Number(homeDistanceKm) || 0,
            accessibility_requested: accessibilityRequested,
            accessibility_note: accessibilityNote.trim() || null,
            declaration_accepted: declarationAccepted,
            submit_now: submitNow,
          }),
        }
      );
      onToast('success', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to save application.');
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async () => {
    if (!activeApp) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/applications/${encodeURIComponent(activeApp.id)}/withdraw`,
        { method: 'POST' }
      );
      onToast('info', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to withdraw application.');
    } finally {
      setSaving(false);
    }
  };

  const handleRespondOffer = async (action: 'accept' | 'decline') => {
    if (!activeApp) return;
    setResponding(true);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/applications/${encodeURIComponent(activeApp.id)}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        }
      );
      onToast(action === 'accept' ? 'success' : 'info', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to record offer response.');
    } finally {
      setResponding(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Institutional Hostel Applications Desk...
      </div>
    );
  }

  const isLocked =
    activeApp?.status === 'ALLOTTED' ||
    activeApp?.status === 'ACCEPTED' ||
    activeCycle?.status !== 'OPEN';

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASE 3 · HOSTEL APPLICATION &amp; ALLOTMENT DESK
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              {activeCycle ? activeCycle.title : 'Hostel Application Portal'}
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              Eligibility and bed allotment are computed exclusively by deterministic, policy-versioned
              university rules (Policy {activeCycle?.policy.policy_version ?? 'N/A'}) — never by AI.
            </p>
          </div>
          {activeApp && (
            <div className="text-left md:text-right shrink-0">
              <span className="block font-mono-code text-[11px] uppercase text-[#465078]">
                Application Status
              </span>
              <span
                className={`inline-block mt-1 px-3 py-1 font-mono-code text-sm font-bold border-2 border-[#1F2A5A] ${
                  STATUS_BADGE[activeApp.status] ?? 'bg-[#F1E6CF]'
                }`}
              >
                {activeApp.status}
              </span>
            </div>
          )}
        </div>

        {/* Cycle Policy Strip */}
        {activeCycle && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 font-mono-code text-xs">
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
              <span className="block text-[10px] uppercase text-[#465078]">Cycle Code</span>
              <span className="font-bold text-[#1F2A5A]">{activeCycle.code}</span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
              <span className="block text-[10px] uppercase text-[#465078]">Cycle Window</span>
              <span className="font-bold text-[#1F2A5A]">{activeCycle.status}</span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
              <span className="block text-[10px] uppercase text-[#465078]">Weights (Yr / Merit)</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">
                {activeCycle.policy.year_weight} / {activeCycle.policy.merit_weight}
              </span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-2.5">
              <span className="block text-[10px] uppercase text-[#465078]">Your Priority Score</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">
                {activeApp ? activeApp.eligibility.computed_priority_score : 'Draft'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Pending Allotment Offer Action Banner */}
      {activeApp?.status === 'ALLOTTED' && activeApp.allotment && (
        <section className="bg-[#FBE9A6] border-2 border-[#1F2A5A] shadow-ink p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="font-mono-code text-xs font-bold uppercase text-[#C2552D]">
              ACTION REQUIRED · ALLOTMENT OFFER ISSUED
            </p>
            <h2 className="font-display text-2xl text-[#1F2A5A] mt-0.5">
              Assigned {activeApp.allotment.room_label} — Bed {activeApp.allotment.bed_label} (Floor{' '}
              {activeApp.allotment.floor})
            </h2>
            <p className="text-xs text-[#1F2A5A] mt-1">{activeApp.allotment.explanation}</p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={responding}
              onClick={() => void handleRespondOffer('accept')}
              className="px-4 py-2.5 bg-[#5E8C6A] text-[#F8F2E4] font-bold text-sm border-2 border-[#1F2A5A] shadow-ink-sm hover:opacity-95"
            >
              Accept Offer
            </button>
            <button
              type="button"
              disabled={responding}
              onClick={() => void handleRespondOffer('decline')}
              className="px-4 py-2.5 bg-[#B3261E] text-[#F8F2E4] font-bold text-sm border-2 border-[#1F2A5A] shadow-ink-sm hover:opacity-95"
            >
              Decline &amp; Release Bed
            </button>
          </div>
        </section>
      )}

      {/* Waitlist Banner */}
      {activeApp?.status === 'WAITLISTED' && (
        <section className="bg-[#FBE9A6] border-2 border-[#C2552D] p-4">
          <p className="font-mono-code text-xs font-bold uppercase text-[#C2552D]">
            DETERMINISTIC WAITLIST RANK #{activeApp.waitlist_position}
          </p>
          <p className="text-sm text-[#1F2A5A] mt-1">{activeApp.waitlist_reason}</p>
        </section>
      )}

      {/* Official Allotment Slip (Printable) */}
      {slip && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b-2 border-[#1F2A5A] pb-3">
            <div className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-[#5E8C6A]" aria-hidden="true" />
              <div>
                <h2 className="font-display text-2xl text-[#1F2A5A]">Official Hostel Allotment Slip</h2>
                <p className="font-mono-code text-[11px] text-[#465078]">
                  Ref: {slip.slip_reference} · Checksum: {slip.checksum}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A] inline-flex items-center gap-1.5 print:hidden"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              Print Official Slip
            </button>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F1E6CF] border border-[#1F2A5A] p-4 font-mono-code text-xs">
            <div>
              <dt className="text-[#465078] text-[10px] uppercase">Student</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {slip.student.name} ({slip.student.student_code})
              </dd>
            </div>
            <div>
              <dt className="text-[#465078] text-[10px] uppercase">Assigned Room &amp; Bed</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {slip.assignment.room_label} · Bed {slip.assignment.bed_label}
              </dd>
            </div>
            <div>
              <dt className="text-[#465078] text-[10px] uppercase">Block &amp; Floor</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {slip.assignment.block_name} · Fl {slip.assignment.floor}
              </dd>
            </div>
            <div>
              <dt className="text-[#465078] text-[10px] uppercase">Policy / Status</dt>
              <dd className="font-bold text-[#1F2A5A] mt-0.5">
                {slip.cycle.policy_version} · {slip.application_status}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[#465078]">{slip.assignment.explanation}</p>
        </section>
      )}

      {/* Two-Column Main Desk: Application Form + Deterministic Eligibility Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#1F2A5A]/30 pb-2.5">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              <h2 className="font-display text-2xl text-[#1F2A5A]">
                Ranked Room Preferences &amp; Details
              </h2>
            </div>
            <span className="font-mono-code text-xs font-bold text-[#465078] tabular-nums">
              {preferredRoomIds.length}/5 selected
            </span>
          </div>

          {/* Ranked Preferences List */}
          <div>
            <p className="font-mono-code text-[11px] font-bold uppercase text-[#465078] mb-2">
              Selected Preference Order (Click rooms below to add/remove)
            </p>
            {preferredRoomIds.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-3">
                No specific rooms ranked yet. Pick up to 5 compatible rooms below.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {preferredRoomIds.map((rid, idx) => {
                  const rm = rooms.find((r) => r.id === rid);
                  const blk = rm ? blockMap.get(rm.block_id) : null;
                  return (
                    <li
                      key={rid}
                      className="flex items-center justify-between bg-[#FBE9A6] border border-[#1F2A5A] px-3 py-1.5 font-mono-code text-xs"
                    >
                      <span className="font-bold text-[#1F2A5A]">
                        #{idx + 1} · {blk ? `${blk.code}-${rm?.number}` : rid}{' '}
                        {rm ? `(Fl ${rm.floor}, ${rm.ac ? 'AC' : 'Non-AC'}, Cap ${rm.capacity})` : ''}
                      </span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => togglePreferredRoom(rid)}
                          className="text-[#B3261E] font-bold hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Compatible Rooms Quick Picker */}
          {!isLocked && (
            <div className="space-y-1.5">
              <p className="font-mono-code text-[11px] font-bold uppercase text-[#465078]">
                Gender-Compatible Campus Rooms ({compatibleRooms.length})
              </p>
              <div className="max-h-44 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 border border-[#1F2A5A] bg-[#F1E6CF] p-2">
                {compatibleRooms.slice(0, 45).map((rm) => {
                  const blk = blockMap.get(rm.block_id);
                  const chosen = preferredRoomIds.includes(rm.id);
                  return (
                    <button
                      key={rm.id}
                      type="button"
                      onClick={() => togglePreferredRoom(rm.id)}
                      className={[
                        'px-2 py-1.5 text-left font-mono-code text-[11px] border border-[#1F2A5A]',
                        chosen
                          ? 'bg-[#1F2A5A] text-[#F8F2E4] font-bold'
                          : 'bg-[#F8F2E4] text-[#1F2A5A] hover:bg-[#FBE9A6]',
                      ].join(' ')}
                    >
                      {blk?.code}-{rm.number} · {rm.ac ? 'AC' : 'STD'} · {rm.capacity}B
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Additional Criteria */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="pref-ac"
                className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
              >
                Fallback AC Preference
              </label>
              <select
                id="pref-ac"
                disabled={isLocked}
                value={preferredAc}
                onChange={(e) => setPreferredAc(e.target.value as 'any' | 'ac' | 'non_ac')}
                className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A]"
              >
                <option value="any">No Preference</option>
                <option value="ac">Air-Conditioned</option>
                <option value="non_ac">Non-AC</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="pref-cap"
                className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
              >
                Fallback Occupancy
              </label>
              <select
                id="pref-cap"
                disabled={isLocked}
                value={preferredCap}
                onChange={(e) => setPreferredCap(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A]"
              >
                <option value="any">Any Sharing</option>
                <option value="1">Single (1)</option>
                <option value="2">Double (2)</option>
                <option value="3">Triple (3)</option>
                <option value="4">Quad (4)</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="home-dist"
                className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
              >
                Home Distance (km)
              </label>
              <input
                id="home-dist"
                type="number"
                min={0}
                max={5000}
                disabled={isLocked}
                value={homeDistanceKm}
                onChange={(e) => setHomeDistanceKm(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A] tabular-nums"
              />
            </div>
          </div>

          {/* Accessibility Priority Request */}
          <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-[#1F2A5A]">
              <input
                type="checkbox"
                disabled={isLocked}
                checked={accessibilityRequested}
                onChange={(e) => setAccessibilityRequested(e.target.checked)}
              />
              <Accessibility className="w-4 h-4 text-[#C2552D]" aria-hidden="true" />
              Request Ground-Floor Accessible Bed Priority (Requires Warden/Admin Verification)
            </label>
            {accessibilityRequested && (
              <input
                type="text"
                disabled={isLocked}
                value={accessibilityNote}
                onChange={(e) => setAccessibilityNote(e.target.value)}
                placeholder="Brief medical/accessibility reference note (upload supporting proof in ID & Vault)"
                className="w-full px-2.5 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] text-xs text-[#1F2A5A]"
              />
            )}
          </div>

          {/* Declaration */}
          <label className="flex items-start gap-2 text-xs text-[#1F2A5A]">
            <input
              type="checkbox"
              disabled={isLocked}
              checked={declarationAccepted}
              onChange={(e) => setDeclarationAccepted(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I accept the VidyaVihar University Hostel Allotment Policy and understand that bed
              allotment is strictly determined by verified institutional records and policy rules.
            </span>
          </label>

          {/* Actions */}
          {!isLocked && (
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(false)}
                className="px-4 py-2 bg-[#F1E6CF] text-[#1F2A5A] font-bold text-xs border-2 border-[#1F2A5A] hover:bg-[#FBE9A6]"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(true)}
                className="px-5 py-2 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420] inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                {saving ? 'Submitting...' : 'Submit Application'}
              </button>
              {activeApp && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleWithdraw()}
                  className="px-3.5 py-2 bg-[#F8F2E4] text-[#B3261E] font-bold text-xs border border-[#B3261E] inline-flex items-center gap-1 ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Withdraw
                </button>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Deterministic Rule-Based Eligibility Breakdown */}
        <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
            Policy Eligibility &amp; Score Breakdown
          </h2>

          {!activeApp ? (
            <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
              Save a draft or submit your application to view your live rule-based eligibility
              evaluation and deterministic priority score breakdown.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {activeApp.eligibility.checks.map((chk) => (
                  <div
                    key={chk.rule_code}
                    className="border border-[#1F2A5A] bg-[#F1E6CF] p-2.5 flex items-start gap-2.5"
                  >
                    {chk.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-[#5E8C6A] shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <XCircle className="w-4 h-4 text-[#B3261E] shrink-0 mt-0.5" aria-hidden="true" />
                    )}
                    <div className="text-xs">
                      <p className="font-bold text-[#1F2A5A]">{chk.label}</p>
                      <p className="text-[#465078] mt-0.5">{chk.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3 font-mono-code text-xs space-y-1.5">
                <p className="font-bold uppercase text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-1">
                  Deterministic Score Components
                </p>
                <div className="flex justify-between">
                  <span className="text-[#465078]">Seniority (Year {activeApp.student_year})</span>
                  <span className="font-bold text-[#1F2A5A] tabular-nums">
                    +{activeApp.eligibility.score_breakdown.year_points}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#465078]">Academic Merit Band</span>
                  <span className="font-bold text-[#1F2A5A] tabular-nums">
                    +{activeApp.eligibility.score_breakdown.merit_points}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#465078]">Distance ({activeApp.home_distance_km} km)</span>
                  <span className="font-bold text-[#1F2A5A] tabular-nums">
                    +{activeApp.eligibility.score_breakdown.distance_points}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#465078]">Verified Accessibility Bonus</span>
                  <span className="font-bold text-[#1F2A5A] tabular-nums">
                    +{activeApp.eligibility.score_breakdown.accessibility_points}
                  </span>
                </div>
                <div className="flex justify-between border-t-2 border-[#1F2A5A] pt-1.5 text-sm font-bold text-[#1F2A5A]">
                  <span>Total Priority Score</span>
                  <span className="tabular-nums">
                    {activeApp.eligibility.computed_priority_score}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
