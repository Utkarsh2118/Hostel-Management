import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accessibility,
  BedDouble,
  Building2,
  CheckCircle2,
  FileCheck2,
  Layers,
  Lock,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { SessionUser } from '../../lib/types';
import type { ToastMessage } from '../components/layout/ToastContainer';
import type {
  BedOverrideStatus,
  BedRecord,
  InstitutionalHierarchyResponse,
  InventoryRoomSummary,
  RoomOverrideStatus,
  RoomStatusHistoryEntry,
} from '../../lib/inventory/service';
import type { StudentVerificationRecord } from '../../lib/integrations/university/student-verification';
import type { StudentDocumentRecord } from '../../lib/documents/service';

interface RoomBedsResponse {
  room: InventoryRoomSummary;
  block: { id: string; name: string; code: string; warden_name: string };
  can_manage: boolean;
  beds: BedRecord[];
  status_history: RoomStatusHistoryEntry[];
}

interface VerificationRecordsResponse {
  records: StudentVerificationRecord[];
  provider: {
    environment: string;
    active_provider_kind: string;
    active_provider_name: string;
    is_mock_development_provider: boolean;
    official_api_configured: boolean;
    imported_roster_count: number;
  };
}

export interface InventoryExplorerPageProps {
  sessionUser: SessionUser;
  initialTab?: 'inventory' | 'verification';
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

const ROOM_STATUS_STYLE: Record<string, string> = {
  AVAILABLE: 'bg-[#5E8C6A] text-[#F8F2E4]',
  PARTIALLY_OCCUPIED: 'bg-[#FBE9A6] text-[#1F2A5A]',
  FULL: 'bg-[#1F2A5A] text-[#F8F2E4]',
  UNDER_MAINTENANCE: 'bg-[#C2552D] text-[#F8F2E4]',
  BLOCKED: 'bg-[#B3261E] text-[#F8F2E4]',
  RESERVED: 'bg-[#F2C94C] text-[#1F2A5A]',
};

const BED_STATUS_STYLE: Record<string, string> = {
  AVAILABLE: 'bg-[#5E8C6A] text-[#F8F2E4]',
  OCCUPIED: 'bg-[#1F2A5A] text-[#F8F2E4]',
  RESERVED: 'bg-[#F2C94C] text-[#1F2A5A]',
  MAINTENANCE: 'bg-[#C2552D] text-[#F8F2E4]',
};

export const InventoryExplorerPage: React.FC<InventoryExplorerPageProps> = ({
  sessionUser,
  initialTab = 'inventory',
  onToast,
}) => {
  const canVerify = sessionUser.role === 'ADMIN' || sessionUser.role === 'WARDEN';
  const [activeTab, setActiveTab] = useState<'inventory' | 'verification'>(
    initialTab === 'verification' && canVerify ? 'verification' : 'inventory'
  );

  // Inventory state
  const [hierarchy, setHierarchy] = useState<InstitutionalHierarchyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [roomDetail, setRoomDetail] = useState<RoomBedsResponse | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);

  // Room & bed override forms
  const [roomOverrideStatus, setRoomOverrideStatus] = useState<RoomOverrideStatus>('AVAILABLE');
  const [roomOverrideReason, setRoomOverrideReason] = useState('');
  const [savingRoomStatus, setSavingRoomStatus] = useState(false);

  const [bedReasonById, setBedReasonById] = useState<Record<string, string>>({});
  const [savingBedId, setSavingBedId] = useState<string | null>(null);

  // Verification & Documents review state (Admin / Warden)
  const [verData, setVerData] = useState<VerificationRecordsResponse | null>(null);
  const [vaultDocs, setVaultDocs] = useState<StudentDocumentRecord[]>([]);
  const [rosterSourceLabel, setRosterSourceLabel] = useState('Registrar Monsoon 2026 Verified Roster');
  const [rosterJson, setRosterJson] = useState(
    JSON.stringify(
      [
        {
          university_student_id: 'VV2024CO101',
          official_full_name: 'Rohan Kulkarni',
          official_email: 'student.demo@hostelhub.local',
          course_branch: 'Computer Science',
          academic_year: 3,
          enrollment_status: 'enrolled',
          campus_code: 'CAMPUS-NORTH',
        },
      ],
      null,
      2
    )
  );
  const [importingRoster, setImportingRoster] = useState(false);

  const loadHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<InstitutionalHierarchyResponse>('/api/hostels/hierarchy');
      setHierarchy(data);
      const firstCampus = data.campuses[0];
      if (firstCampus && !selectedCampusId) {
        setSelectedCampusId(firstCampus.id);
        const firstBlock = firstCampus.hostels[0]?.blocks[0];
        if (firstBlock && !selectedBlockId) {
          setSelectedBlockId(firstBlock.id);
        }
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load hostel inventory hierarchy.'
      );
    } finally {
      setLoading(false);
    }
  }, [onToast, selectedBlockId, selectedCampusId]);

  const loadRoomBeds = useCallback(
    async (roomId: string) => {
      setSelectedRoomId(roomId);
      setLoadingRoom(true);
      try {
        const detail = await apiFetch<RoomBedsResponse>(
          `/api/hostels/rooms/${encodeURIComponent(roomId)}/beds`
        );
        setRoomDetail(detail);
        setRoomOverrideStatus(detail.room.operational_override ?? 'AVAILABLE');
        setRoomOverrideReason('');
      } catch (err) {
        onToast(
          'error',
          err instanceof Error ? err.message : 'Unable to load room bed register.'
        );
      } finally {
        setLoadingRoom(false);
      }
    },
    [onToast]
  );

  const loadVerificationAndDocs = useCallback(async () => {
    if (!canVerify) return;
    try {
      const [vRes, dRes] = await Promise.all([
        apiFetch<VerificationRecordsResponse>('/api/verification/records'),
        apiFetch<{ documents: StudentDocumentRecord[] }>('/api/documents'),
      ]);
      setVerData(vRes);
      setVaultDocs(dRes.documents);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load verification register.'
      );
    }
  }, [canVerify, onToast]);

  useEffect(() => {
    void loadHierarchy();
  }, [loadHierarchy]);

  useEffect(() => {
    if (activeTab === 'verification' && canVerify) {
      void loadVerificationAndDocs();
    }
  }, [activeTab, canVerify, loadVerificationAndDocs]);

  const activeCampus = useMemo(() => {
    if (!hierarchy) return null;
    return hierarchy.campuses.find((c) => c.id === selectedCampusId) ?? hierarchy.campuses[0] ?? null;
  }, [hierarchy, selectedCampusId]);

  const activeBlock = useMemo(() => {
    if (!activeCampus) return null;
    for (const hostel of activeCampus.hostels) {
      const match = hostel.blocks.find((b) => b.id === selectedBlockId);
      if (match) return match;
    }
    return activeCampus.hostels[0]?.blocks[0] ?? null;
  }, [activeCampus, selectedBlockId]);

  const handleRoomStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomDetail) return;
    if (roomOverrideReason.trim().length < 5) {
      onToast('error', 'Enter an audit reason (minimum 5 characters).');
      return;
    }
    setSavingRoomStatus(true);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/hostels/rooms/${encodeURIComponent(roomDetail.room.id)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: roomOverrideStatus,
            reason: roomOverrideReason.trim(),
          }),
        }
      );
      onToast('success', res.message);
      await Promise.all([loadHierarchy(), loadRoomBeds(roomDetail.room.id)]);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update room status.');
    } finally {
      setSavingRoomStatus(false);
    }
  };

  const handleBedStatusChange = async (bed: BedRecord, nextStatus: BedOverrideStatus) => {
    const reason = (bedReasonById[bed.id] ?? '').trim() || `Marked ${nextStatus} via inventory register`;
    if (reason.length < 5) {
      onToast('error', 'Reason must be at least 5 characters.');
      return;
    }
    setSavingBedId(bed.id);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/hostels/beds/${encodeURIComponent(bed.id)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: nextStatus,
            reason,
          }),
        }
      );
      onToast('success', res.message);
      await Promise.all([loadHierarchy(), loadRoomBeds(bed.room_id)]);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update bed status.');
    } finally {
      setSavingBedId(null);
    }
  };

  const handleImportRoster = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportingRoster(true);
    try {
      const entries = JSON.parse(rosterJson) as unknown;
      const res = await apiFetch<{ message: string }>('/api/admin/verification/import', {
        method: 'POST',
        body: JSON.stringify({
          source_label: rosterSourceLabel.trim(),
          entries,
        }),
      });
      onToast('success', res.message);
      await loadVerificationAndDocs();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Roster import failed.');
    } finally {
      setImportingRoster(false);
    }
  };

  const handleReviewDocument = async (
    doc: StudentDocumentRecord,
    status: 'VERIFIED' | 'REJECTED'
  ) => {
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/documents/${encodeURIComponent(doc.id)}/review`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            note:
              status === 'VERIFIED'
                ? 'Verified against institutional checklist by authorized staff.'
                : 'Rejected: document illegible or mismatched; please re-upload.',
          }),
        }
      );
      onToast('success', res.message);
      await loadVerificationAndDocs();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Document review failed.');
    }
  };

  if (loading || !hierarchy) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Institutional Hostel &amp; Bed Inventory...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              {hierarchy.university.code} · INSTITUTIONAL INVENTORY REGISTER
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              {hierarchy.university.name} — Bed-Level Hostel Register
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              Campus → Hostel → Block → Floor → Room → Bed hierarchy. Availability is derived live
              from active occupancy and operational status overrides.
            </p>
          </div>

          {canVerify && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('inventory')}
                className={[
                  'px-3.5 py-2 text-xs font-mono-code font-bold border-2 border-[#1F2A5A]',
                  activeTab === 'inventory'
                    ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                    : 'bg-[#F1E6CF] text-[#1F2A5A] hover:bg-[#FBE9A6]',
                ].join(' ')}
              >
                01 · Hostel &amp; Bed Inventory
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('verification')}
                className={[
                  'px-3.5 py-2 text-xs font-mono-code font-bold border-2 border-[#1F2A5A]',
                  activeTab === 'verification'
                    ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                    : 'bg-[#F1E6CF] text-[#1F2A5A] hover:bg-[#FBE9A6]',
                ].join(' ')}
              >
                02 · Verification &amp; Vault Review
              </button>
            </div>
          )}
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-4 font-mono-code">
          {[
            { label: 'Campuses', value: hierarchy.totals.campuses },
            { label: 'Hostels', value: hierarchy.totals.hostels },
            { label: 'Blocks', value: hierarchy.totals.blocks },
            { label: 'Rooms', value: hierarchy.totals.rooms },
            { label: 'Occupied Beds', value: `${hierarchy.totals.occupied_beds}/${hierarchy.totals.beds}` },
            { label: 'Available Beds', value: hierarchy.totals.available_beds },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2"
            >
              <span className="block text-[10px] uppercase text-[#465078]">{stat.label}</span>
              <span className="block text-lg font-bold text-[#1F2A5A] tabular-nums mt-0.5">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {activeTab === 'inventory' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Rail: Campus -> Hostel -> Block Selector */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-4 space-y-3">
              <div className="flex items-center gap-2 border-b border-[#1F2A5A]/30 pb-2">
                <Layers className="w-4 h-4 text-[#1F2A5A]" aria-hidden="true" />
                <h2 className="font-display text-xl text-[#1F2A5A]">Campus &amp; Hostel Tree</h2>
              </div>

              {hierarchy.campuses.map((campus) => (
                <div key={campus.id} className="border-2 border-[#1F2A5A] bg-[#F1E6CF]">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCampusId(campus.id);
                      const firstBlk = campus.hostels[0]?.blocks[0];
                      if (firstBlk) setSelectedBlockId(firstBlk.id);
                    }}
                    className={[
                      'w-full px-3 py-2 text-left flex items-center justify-between border-b border-[#1F2A5A]/40',
                      activeCampus?.id === campus.id
                        ? 'bg-[#1F2A5A] text-[#F8F2E4]'
                        : 'bg-[#F1E6CF] text-[#1F2A5A] hover:bg-[#FBE9A6]',
                    ].join(' ')}
                  >
                    <span className="text-xs font-bold">{campus.name}</span>
                    <span className="font-mono-code text-[11px] tabular-nums">
                      {campus.available_beds} free
                    </span>
                  </button>

                  <div className="p-2.5 space-y-2">
                    {campus.hostels.map((hostel) => (
                      <div key={hostel.id} className="space-y-1">
                        <p className="font-mono-code text-[10px] font-bold uppercase text-[#465078]">
                          {hostel.code} · {hostel.name}
                        </p>
                        {hostel.blocks.map((block) => {
                          const isSelected = activeBlock?.id === block.id;
                          return (
                            <button
                              key={block.id}
                              type="button"
                              onClick={() => {
                                setSelectedCampusId(campus.id);
                                setSelectedBlockId(block.id);
                                setRoomDetail(null);
                                setSelectedRoomId('');
                              }}
                              className={[
                                'w-full px-2.5 py-2 text-left border border-[#1F2A5A] flex items-center justify-between text-xs',
                                isSelected
                                  ? 'bg-[#FBE9A6] font-bold text-[#1F2A5A] shadow-ink-sm'
                                  : 'bg-[#F8F2E4] text-[#1F2A5A] hover:bg-[#FBE9A6]/50',
                              ].join(' ')}
                            >
                              <span>
                                {block.name} ({block.code})
                                {block.can_manage && (
                                  <span className="block font-mono-code text-[10px] text-[#5E8C6A]">
                                    MANAGED SCOPE
                                  </span>
                                )}
                              </span>
                              <span className="font-mono-code text-[11px] tabular-nums text-right">
                                {block.occupied_beds}/{block.total_beds}
                                <span className="block text-[10px] text-[#465078]">beds</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Selected Room Bed-Level Register Drawer */}
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-4 space-y-4">
              <div className="flex items-center gap-2 border-b border-[#1F2A5A]/30 pb-2">
                <BedDouble className="w-4 h-4 text-[#C2552D]" aria-hidden="true" />
                <h2 className="font-display text-xl text-[#1F2A5A]">Bed-Level Register</h2>
              </div>

              {loadingRoom ? (
                <p className="font-mono-code text-xs text-[#465078]">Loading beds...</p>
              ) : !roomDetail ? (
                <p className="text-xs text-[#465078]">
                  Select any room tile from the floor grid on the right to inspect individual beds,
                  accessibility flags, and operational status controls.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2 bg-[#F1E6CF] border border-[#1F2A5A] p-3">
                    <div>
                      <p className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                        {roomDetail.block.code}-{roomDetail.room.number} · Floor{' '}
                        {roomDetail.room.floor}
                      </p>
                      <p className="text-[11px] text-[#465078]">
                        {roomDetail.room.ac ? 'Air-Conditioned' : 'Non-AC'} · Capacity{' '}
                        {roomDetail.room.capacity}
                        {roomDetail.room.is_accessible ? ' · Ground Accessible' : ''}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 font-mono-code text-[10px] font-bold border border-[#1F2A5A] ${
                        ROOM_STATUS_STYLE[roomDetail.room.derived_status] ?? 'bg-[#F8F2E4]'
                      }`}
                    >
                      {roomDetail.room.derived_status}
                    </span>
                  </div>

                  {/* Individual Beds */}
                  <div className="space-y-2">
                    {roomDetail.beds.map((bed) => (
                      <div
                        key={bed.id}
                        className="border border-[#1F2A5A] bg-[#F8F2E4] p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                              BED {bed.bed_label}
                            </span>
                            {bed.is_accessible && (
                              <span
                                title="Accessible Ground-Floor Bed"
                                className="inline-flex items-center gap-1 font-mono-code text-[10px] text-[#1F2A5A] bg-[#FBE9A6] px-1 border border-[#1F2A5A]"
                              >
                                <Accessibility className="w-3 h-3" aria-hidden="true" />
                                ADA
                              </span>
                            )}
                          </div>
                          <span
                            className={`px-2 py-0.5 font-mono-code text-[10px] font-bold border border-[#1F2A5A] ${
                              BED_STATUS_STYLE[bed.status] ?? 'bg-[#F1E6CF]'
                            }`}
                          >
                            {bed.status}
                          </span>
                        </div>

                        <p className="font-mono-code text-[11px] text-[#465078]">
                          {bed.is_occupied
                            ? bed.occupant_student_code
                              ? `Occupant: ${bed.occupant_student_code}`
                              : 'Occupant: Active Resident (ID redacted for privacy)'
                            : bed.notes || 'Ready for allotment'}
                        </p>

                        {roomDetail.can_manage && !bed.is_occupied && (
                          <div className="pt-1.5 border-t border-[#1F2A5A]/20 space-y-1.5">
                            <input
                              type="text"
                              value={bedReasonById[bed.id] ?? ''}
                              onChange={(e) =>
                                setBedReasonById((prev) => ({
                                  ...prev,
                                  [bed.id]: e.target.value,
                                }))
                              }
                              placeholder="Audit reason (e.g. broken frame / reserved)"
                              className="w-full px-2 py-1 text-[11px] bg-[#F1E6CF] border border-[#1F2A5A] text-[#1F2A5A]"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {(['AVAILABLE', 'RESERVED', 'MAINTENANCE'] as BedOverrideStatus[]).map(
                                (st) => (
                                  <button
                                    key={st}
                                    type="button"
                                    disabled={savingBedId === bed.id || bed.status === st}
                                    onClick={() => void handleBedStatusChange(bed, st)}
                                    className="px-2 py-1 font-mono-code text-[10px] font-bold border border-[#1F2A5A] bg-[#F1E6CF] hover:bg-[#FBE9A6] disabled:opacity-45"
                                  >
                                    Set {st}
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Room-Level Operational Status Override (Admin / Scoped Warden Only) */}
                  {roomDetail.can_manage && (
                    <form
                      onSubmit={handleRoomStatusSubmit}
                      className="border-t-2 border-[#1F2A5A] pt-3 space-y-2.5"
                    >
                      <p className="font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A]">
                        Room Operational Status Override
                      </p>
                      <select
                        value={roomOverrideStatus}
                        onChange={(e) =>
                          setRoomOverrideStatus(e.target.value as RoomOverrideStatus)
                        }
                        className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                      >
                        <option value="AVAILABLE">AVAILABLE (Normal Operations)</option>
                        <option value="UNDER_MAINTENANCE">UNDER_MAINTENANCE</option>
                        <option value="RESERVED">RESERVED</option>
                        <option value="BLOCKED">BLOCKED (Vacant Rooms Only)</option>
                      </select>
                      <input
                        type="text"
                        value={roomOverrideReason}
                        onChange={(e) => setRoomOverrideReason(e.target.value)}
                        placeholder="Mandatory audit reason (min 5 chars)"
                        className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] text-xs text-[#1F2A5A]"
                      />
                      <button
                        type="submit"
                        disabled={savingRoomStatus}
                        className="w-full py-2 bg-[#1F2A5A] text-[#F8F2E4] font-bold text-xs border border-[#1F2A5A] hover:bg-[#273570]"
                      >
                        {savingRoomStatus ? 'Recording...' : 'Update Room Status'}
                      </button>
                    </form>
                  )}

                  {roomDetail.status_history.length > 0 && (
                    <div className="border-t border-[#1F2A5A]/30 pt-2.5 space-y-1.5">
                      <p className="font-mono-code text-[10px] font-bold uppercase text-[#465078]">
                        Recent Status History
                      </p>
                      {roomDetail.status_history.slice(0, 4).map((h) => (
                        <div
                          key={h.id}
                          className="text-[11px] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-2"
                        >
                          <p className="font-mono-code font-bold text-[#1F2A5A]">
                            {h.previous_status} → {h.new_status}
                          </p>
                          <p className="text-[#465078]">{h.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>

          {/* Right Main Grid: Floor -> Rooms Matrix */}
          <section className="lg:col-span-8 space-y-4">
            {activeBlock && (
              <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b-2 border-[#1F2A5A] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
                      <h2 className="font-display text-2xl text-[#1F2A5A]">
                        {activeBlock.name} ({activeBlock.code})
                      </h2>
                    </div>
                    <p className="text-xs text-[#465078] mt-0.5">
                      Warden: {activeBlock.warden_name} · {activeBlock.gender_type.toUpperCase()}{' '}
                      WING · {activeBlock.total_rooms} rooms / {activeBlock.total_beds} beds
                    </p>
                  </div>
                  <span className="font-mono-code text-xs font-bold text-[#1F2A5A] bg-[#F1E6CF] border border-[#1F2A5A] px-2.5 py-1 tabular-nums">
                    {activeBlock.available_beds} beds available
                  </span>
                </div>

                {activeBlock.floors_detail.map((floor) => (
                  <div key={floor.floor_number} className="space-y-2">
                    <div className="flex items-center justify-between border-b border-[#1F2A5A]/30 pb-1">
                      <h3 className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
                        Floor {floor.floor_number}
                        {floor.floor_number === 1 ? ' · Ground Accessible' : ''}
                      </h3>
                      <span className="font-mono-code text-[11px] text-[#465078] tabular-nums">
                        {floor.occupied_beds}/{floor.total_beds} occupied · {floor.available_beds}{' '}
                        free
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                      {floor.rooms.map((rm) => {
                        const isSelected = selectedRoomId === rm.id;
                        return (
                          <button
                            key={rm.id}
                            type="button"
                            onClick={() => void loadRoomBeds(rm.id)}
                            className={[
                              'p-2.5 text-left border-2 border-[#1F2A5A] transition-colors',
                              isSelected
                                ? 'bg-[#FBE9A6] shadow-ink-sm'
                                : 'bg-[#F1E6CF] hover:bg-[#FBE9A6]/70',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                                {rm.number}
                              </span>
                              <span className="font-mono-code text-[10px] text-[#465078]">
                                {rm.ac ? 'AC' : 'STD'}
                              </span>
                            </div>
                            <p className="font-mono-code text-[11px] font-bold text-[#1F2A5A] mt-1 tabular-nums">
                              {rm.occupied_beds}/{rm.total_beds} beds
                            </p>
                            <span
                              className={`inline-block mt-1.5 px-1.5 py-0.5 font-mono-code text-[9px] font-bold border border-[#1F2A5A] ${
                                ROOM_STATUS_STYLE[rm.derived_status] ?? 'bg-[#F8F2E4]'
                              }`}
                            >
                              {rm.derived_status.replace('_', ' ')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* Verification, Roster Import & Private Document Review Tab (Admin / Warden) */
        <div className="space-y-6">
          {/* Provider Status & Admin Roster Import */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b-2 border-[#1F2A5A] pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-[#C2552D]" aria-hidden="true" />
                <h2 className="font-display text-2xl text-[#1F2A5A]">
                  University Verification Provider &amp; Roster Control
                </h2>
              </div>
              {verData && (
                <span className="font-mono-code text-xs font-bold text-[#1F2A5A] bg-[#FBE9A6] border border-[#1F2A5A] px-2.5 py-1">
                  Active: {verData.provider.active_provider_name} ({verData.provider.imported_roster_count}{' '}
                  imported)
                </span>
              )}
            </div>

            {sessionUser.role === 'ADMIN' && (
              <form onSubmit={handleImportRoster} className="space-y-3 bg-[#F1E6CF] border border-[#1F2A5A] p-4">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-[#1F2A5A]" aria-hidden="true" />
                  <h3 className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
                    Authorized University Roster Import (SHA-256 Audited, Admin Only)
                  </h3>
                </div>
                <input
                  type="text"
                  value={rosterSourceLabel}
                  onChange={(e) => setRosterSourceLabel(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[#F8F2E4] border border-[#1F2A5A] text-xs font-mono-code text-[#1F2A5A]"
                  placeholder="Official Registrar Batch Label"
                />
                <textarea
                  rows={6}
                  value={rosterJson}
                  onChange={(e) => setRosterJson(e.target.value)}
                  className="w-full p-2.5 bg-[#F8F2E4] border border-[#1F2A5A] font-mono-code text-[11px] text-[#1F2A5A]"
                />
                <button
                  type="submit"
                  disabled={importingRoster}
                  className="px-4 py-2 bg-[#1F2A5A] text-[#F8F2E4] font-bold text-xs border border-[#1F2A5A] hover:bg-[#273570]"
                >
                  {importingRoster ? 'Importing Roster...' : 'Import Authorized Registrar Roster'}
                </button>
              </form>
            )}

            {/* Verification Records Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-[#1F2A5A] font-mono-code uppercase text-[#465078]">
                    <th className="py-2 pr-3">Student ID</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Provider</th>
                    <th className="py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2A5A]/20">
                  {(verData?.records ?? []).map((rec) => (
                    <tr key={rec.student_id}>
                      <td className="py-2.5 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                        {rec.university_student_id}
                        <span className="block text-[10px] text-[#465078]">{rec.student_id}</span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                        {rec.status}
                        {rec.is_mock_development_record && (
                          <span className="block text-[10px] text-[#B3261E]">DEV MOCK</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-[#1F2A5A]">{rec.provider_name}</td>
                      <td className="py-2.5 text-[#465078]">{rec.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Private Document Review Queue */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <div className="flex items-center gap-2 border-b-2 border-[#1F2A5A] pb-3">
              <Lock className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              <h2 className="font-display text-2xl text-[#1F2A5A]">
                Private Student Documents Review Queue
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-[#1F2A5A] font-mono-code uppercase text-[#465078]">
                    <th className="py-2 pr-3">Student</th>
                    <th className="py-2 pr-3">File &amp; Category</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">Review Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2A5A]/20">
                  {vaultDocs.map((doc) => (
                    <tr key={doc.id}>
                      <td className="py-2.5 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                        {doc.student_code}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <FileCheck2 className="w-4 h-4 text-[#1F2A5A]" aria-hidden="true" />
                          <span className="font-bold text-[#1F2A5A]">{doc.sanitized_filename}</span>
                        </div>
                        <span className="font-mono-code text-[10px] text-[#465078]">
                          {doc.category} · {doc.mime_type}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono-code font-bold text-[#1F2A5A]">
                        {doc.review_status}
                      </td>
                      <td className="py-2.5 text-right space-x-1.5">
                        <button
                          type="button"
                          onClick={() => void handleReviewDocument(doc, 'VERIFIED')}
                          className="px-2.5 py-1 bg-[#5E8C6A] text-[#F8F2E4] font-mono-code text-[11px] font-bold border border-[#1F2A5A] inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                          Verify
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReviewDocument(doc, 'REJECTED')}
                          className="px-2.5 py-1 bg-[#B3261E] text-[#F8F2E4] font-mono-code text-[11px] font-bold border border-[#1F2A5A]"
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
