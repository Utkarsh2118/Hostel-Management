import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  DoorOpen,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  ComplaintStatus,
  GatePassRequest,
  HostelComplaint,
  OccupancyCheckRecord,
  VisitorEntry,
  VisitorStatus,
} from '../../lib/operations/service';
import type { SessionUser } from '../../lib/types';
import type { ToastMessage } from '../components/layout/ToastContainer';

export interface StaffOperationsPageProps {
  sessionUser: SessionUser;
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

type StaffOpsTab = 'occupancy' | 'complaints' | 'gate-passes' | 'visitors';

interface MaintenanceStaffOption {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING_CHECKIN: 'bg-[#FBE9A6] text-[#1F2A5A]',
  CHECKED_IN: 'bg-[#5E8C6A] text-[#F8F2E4]',
  CHECKOUT_REQUESTED: 'bg-[#C2552D] text-[#F8F2E4]',
  CHECKED_OUT: 'bg-[#465078] text-[#F8F2E4]',
  OPEN: 'bg-[#FBE9A6] text-[#1F2A5A]',
  ACKNOWLEDGED: 'bg-[#F2C94C] text-[#1F2A5A]',
  IN_PROGRESS: 'bg-[#C2552D] text-[#F8F2E4]',
  RESOLVED: 'bg-[#5E8C6A] text-[#F8F2E4]',
  CLOSED: 'bg-[#1F2A5A] text-[#F8F2E4]',
  REJECTED: 'bg-[#B3261E] text-[#F8F2E4]',
  PENDING: 'bg-[#FBE9A6] text-[#1F2A5A]',
  APPROVED: 'bg-[#5E8C6A] text-[#F8F2E4]',
  CHECKED_OUT_GATE: 'bg-[#C2552D] text-[#F8F2E4]',
  RETURNED: 'bg-[#1F2A5A] text-[#F8F2E4]',
  CANCELLED: 'bg-[#465078] text-[#F8F2E4]',
  SCHEDULED: 'bg-[#FBE9A6] text-[#1F2A5A]',
  DENIED: 'bg-[#B3261E] text-[#F8F2E4]',
};

export const StaffOperationsPage: React.FC<StaffOperationsPageProps> = ({
  sessionUser,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<StaffOpsTab>('occupancy');
  const [loading, setLoading] = useState(true);
  const [occupancyRecords, setOccupancyRecords] = useState<OccupancyCheckRecord[]>([]);
  const [complaints, setComplaints] = useState<HostelComplaint[]>([]);
  const [gatePasses, setGatePasses] = useState<GatePassRequest[]>([]);
  const [visitors, setVisitors] = useState<VisitorEntry[]>([]);
  const [maintenanceStaff, setMaintenanceStaff] = useState<MaintenanceStaffOption[]>([]);

  // Check-in modal/inline state
  const [checkInTargetId, setCheckInTargetId] = useState<string | null>(null);
  const [keySerial, setKeySerial] = useState('');
  const [roomCondition, setRoomCondition] = useState(
    'Bed frame, study desk, wardrobe, and electrical fittings inspected and intact.'
  );

  // Check-out inline state
  const [checkOutTargetId, setCheckOutTargetId] = useState<string | null>(null);
  const [keyReturned, setKeyReturned] = useState(false);
  const [vacateRoom, setVacateRoom] = useState(true);
  const [clearanceNote, setClearanceNote] = useState(
    'Room fixtures verified intact; room key surrendered to hostel desk.'
  );

  // Complaint status update state
  const [editComplaintId, setEditComplaintId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<ComplaintStatus>('IN_PROGRESS');
  const [editResolutionNote, setEditResolutionNote] = useState('');

  // Complaint PII-stripped escalation state
  const [escalateComplaintId, setEscalateComplaintId] = useState<string | null>(null);
  const [sanitizedSummary, setSanitizedSummary] = useState('');
  const [locationDetail, setLocationDetail] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');

  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [occRes, cmpRes, gpRes, visRes] = await Promise.all([
        apiFetch<{ records: OccupancyCheckRecord[] }>('/api/operations/occupancy'),
        apiFetch<{ complaints: HostelComplaint[] }>('/api/operations/complaints'),
        apiFetch<{ gate_passes: GatePassRequest[] }>('/api/operations/gate-passes'),
        apiFetch<{ visitors: VisitorEntry[] }>('/api/operations/visitors'),
      ]);
      setOccupancyRecords(occRes.records);
      setComplaints(cmpRes.complaints);
      setGatePasses(gpRes.gate_passes);
      setVisitors(visRes.visitors);

      if (sessionUser.role === 'ADMIN') {
        try {
          const acctRes = await apiFetch<{ accounts: MaintenanceStaffOption[] }>(
            '/api/admin/accounts'
          );
          setMaintenanceStaff(
            acctRes.accounts.filter((a) => a.role === 'MAINTENANCE_STAFF' && a.status === 'active')
          );
        } catch {
          setMaintenanceStaff([]);
        }
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load hostel operations register.'
      );
    } finally {
      setLoading(false);
    }
  }, [onToast, sessionUser.role]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRecordCheckIn = async (studentId: string) => {
    setBusyKey(`checkin-${studentId}`);
    try {
      const res = await apiFetch<{ message: string }>('/api/operations/occupancy/checkin', {
        method: 'POST',
        body: JSON.stringify({
          student_id: studentId,
          key_serial: keySerial,
          room_condition_checkin: roomCondition,
        }),
      });
      onToast('success', res.message);
      setCheckInTargetId(null);
      setKeySerial('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to record check-in.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCompleteCheckOut = async (studentId: string) => {
    setBusyKey(`checkout-${studentId}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/operations/occupancy/${encodeURIComponent(studentId)}/checkout`,
        {
          method: 'POST',
          body: JSON.stringify({
            key_returned: keyReturned,
            clearance_note: clearanceNote,
            vacate_room: vacateRoom,
          }),
        }
      );
      onToast('success', res.message);
      setCheckOutTargetId(null);
      setKeyReturned(false);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to complete check-out.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUpdateComplaint = async (complaintId: string) => {
    setBusyKey(`cmp-upd-${complaintId}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/operations/complaints/${encodeURIComponent(complaintId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: editStatus,
            resolution_note: editResolutionNote,
          }),
        }
      );
      onToast('success', res.message);
      setEditComplaintId(null);
      setEditResolutionNote('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update complaint.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleEscalateComplaint = async (complaintId: string) => {
    setBusyKey(`cmp-esc-${complaintId}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/operations/complaints/${encodeURIComponent(complaintId)}/escalate`,
        {
          method: 'POST',
          body: JSON.stringify({
            sanitized_summary: sanitizedSummary,
            location_detail: locationDetail,
            assigned_to_id: assigneeId || null,
          }),
        }
      );
      onToast('success', res.message);
      setEscalateComplaintId(null);
      setSanitizedSummary('');
      setLocationDetail('');
      setAssigneeId('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to escalate complaint.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleReviewGatePass = async (
    passId: string,
    action: 'APPROVE' | 'REJECT' | 'MARK_EXITED' | 'MARK_RETURNED'
  ) => {
    setBusyKey(`gp-${passId}-${action}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/operations/gate-passes/${encodeURIComponent(passId)}/review`,
        {
          method: 'PATCH',
          body: JSON.stringify({ action }),
        }
      );
      onToast('success', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update gate pass.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUpdateVisitor = async (visitorId: string, status: VisitorStatus) => {
    setBusyKey(`vis-${visitorId}-${status}`);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/operations/visitors/${encodeURIComponent(visitorId)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }
      );
      onToast('success', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update visitor status.');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Scoped Hostel Operations Desk...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 border-b-2 border-[#1F2A5A] pb-4">
          <div>
            <p className="font-mono-code text-xs font-bold tracking-[0.16em] text-[#C2552D] uppercase">
              PHASE 4 · {sessionUser.role === 'ADMIN' ? 'INSTITUTIONAL' : 'BLOCK-SCOPED'} HOSTEL
              OPERATIONS DESK
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              Occupancy, Complaints, Gate Pass &amp; Visitor Control
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              {sessionUser.role === 'WARDEN'
                ? 'Server-enforced block scope: you only view and authorize actions for residents inside your assigned hostel blocks.'
                : 'Institution-wide oversight across all hostel blocks with immutable audit logging and PII-stripped maintenance dispatch.'}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-code text-xs shrink-0">
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Occupancy</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">
                {occupancyRecords.length}
              </span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Complaints</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">{complaints.length}</span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Gate Passes</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">{gatePasses.length}</span>
            </div>
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Visitors</span>
              <span className="font-bold text-[#1F2A5A] tabular-nums">{visitors.length}</span>
            </div>
          </div>
        </div>

        {/* Folder Tabs */}
        <div
          role="tablist"
          aria-label="Staff operations registers"
          className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4"
        >
          {(
            [
              { id: 'occupancy', label: '01 · Check-In / Check-Out', icon: KeyRound },
              { id: 'complaints', label: '02 · Complaints & Dispatch', icon: Wrench },
              { id: 'gate-passes', label: '03 · Gate Passes', icon: DoorOpen },
              { id: 'visitors', label: '04 · Visitor Register', icon: UserCheck },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'px-3 py-2.5 border-2 border-[#1F2A5A] font-mono-code text-xs font-bold text-left inline-flex items-center gap-2 transition-colors',
                  active
                    ? 'bg-[#FBE9A6] text-[#1F2A5A] shadow-ink-sm'
                    : 'bg-[#F1E6CF] text-[#465078] hover:bg-[#F8F2E4] hover:text-[#1F2A5A]',
                ].join(' ')}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* TAB 1: OCCUPANCY CHECK-IN & CHECK-OUT */}
      {activeTab === 'occupancy' && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2A5A]/30 pb-2.5">
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Resident Check-In &amp; Key Clearance Register
            </h2>
            <span className="font-mono-code text-xs text-[#465078] tabular-nums">
              {occupancyRecords.length} residents in scope
            </span>
          </div>

          <div className="space-y-3">
            {occupancyRecords.map((rec) => (
              <article
                key={rec.student_id}
                className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-[#1F2A5A]">
                      {rec.student_name}{' '}
                      <span className="font-mono-code text-xs text-[#465078]">
                        ({rec.student_code}) · {rec.room_label} ({rec.block_name})
                      </span>
                    </p>
                    <p className="font-mono-code text-[11px] text-[#465078] mt-0.5">
                      Key: {rec.key_serial ?? 'Not issued'} · Returned:{' '}
                      {rec.key_returned ? 'YES' : 'NO'}
                      {rec.checkout_planned_date
                        ? ` · Planned Check-Out: ${rec.checkout_planned_date}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                        STATUS_BADGE[rec.status] ?? 'bg-[#F8F2E4]'
                      }`}
                    >
                      {rec.status}
                    </span>
                    {rec.status === 'PENDING_CHECKIN' && (
                      <button
                        type="button"
                        onClick={() => {
                          setCheckInTargetId(
                            checkInTargetId === rec.student_id ? null : rec.student_id
                          );
                          setCheckOutTargetId(null);
                          setKeySerial(`KEY-${rec.room_label}`);
                        }}
                        className="px-3 py-1 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                      >
                        Record Check-In
                      </button>
                    )}
                    {(rec.status === 'CHECKED_IN' || rec.status === 'CHECKOUT_REQUESTED') && (
                      <button
                        type="button"
                        onClick={() => {
                          setCheckOutTargetId(
                            checkOutTargetId === rec.student_id ? null : rec.student_id
                          );
                          setCheckInTargetId(null);
                          setKeyReturned(false);
                        }}
                        className="px-3 py-1 bg-[#C2552D] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                      >
                        Complete Check-Out
                      </button>
                    )}
                  </div>
                </div>

                {rec.checkout_reason && (
                  <p className="text-xs bg-[#FBE9A6] border border-[#1F2A5A] px-3 py-1.5 text-[#1F2A5A]">
                    <span className="font-mono-code font-bold">Student Check-Out Reason:</span>{' '}
                    {rec.checkout_reason}
                  </p>
                )}

                {/* Inline Check-In Form */}
                {checkInTargetId === rec.student_id && (
                  <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] p-3.5 space-y-2.5">
                    <p className="font-mono-code text-xs font-bold uppercase text-[#1F2A5A]">
                      Confirm Physical Arrival &amp; Key Handover
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                          Room Key Serial
                        </label>
                        <input
                          type="text"
                          value={keySerial}
                          onChange={(e) => setKeySerial(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] font-mono-code text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                          Room Handover Condition Note
                        </label>
                        <input
                          type="text"
                          value={roomCondition}
                          onChange={(e) => setRoomCondition(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyKey === `checkin-${rec.student_id}`}
                        onClick={() => void handleRecordCheckIn(rec.student_id)}
                        className="px-4 py-1.5 bg-[#5E8C6A] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A]"
                      >
                        {busyKey === `checkin-${rec.student_id}`
                          ? 'Saving...'
                          : 'Confirm Check-In'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheckInTargetId(null)}
                        className="px-3 py-1.5 bg-[#F1E6CF] text-[#1F2A5A] font-bold text-xs border border-[#1F2A5A]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Check-Out Form */}
                {checkOutTargetId === rec.student_id && (
                  <div className="bg-[#F8F2E4] border-2 border-[#B3261E] p-3.5 space-y-2.5">
                    <p className="font-mono-code text-xs font-bold uppercase text-[#B3261E]">
                      Final Hostel Check-Out &amp; Key Return Verification
                    </p>
                    <div className="flex flex-wrap gap-4 text-xs font-bold text-[#1F2A5A]">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={keyReturned}
                          onChange={(e) => setKeyReturned(e.target.checked)}
                        />
                        Room key physically returned (Mandatory)
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={vacateRoom}
                          onChange={(e) => setVacateRoom(e.target.checked)}
                        />
                        Vacate room &amp; release bed in hostel register
                      </label>
                    </div>
                    <div>
                      <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                        Clearance Note
                      </label>
                      <input
                        type="text"
                        value={clearanceNote}
                        onChange={(e) => setClearanceNote(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyKey === `checkout-${rec.student_id}`}
                        onClick={() => void handleCompleteCheckOut(rec.student_id)}
                        className="px-4 py-1.5 bg-[#B3261E] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A]"
                      >
                        {busyKey === `checkout-${rec.student_id}`
                          ? 'Processing...'
                          : 'Finalize Check-Out'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheckOutTargetId(null)}
                        className="px-3 py-1.5 bg-[#F1E6CF] text-[#1F2A5A] font-bold text-xs border border-[#1F2A5A]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* TAB 2: COMPLAINTS & PII-STRIPPED MAINTENANCE ESCALATION */}
      {activeTab === 'complaints' && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2A5A]/30 pb-2.5">
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Student Complaints &amp; Maintenance Dispatch ({complaints.length})
            </h2>
            <span className="font-mono-code text-[11px] bg-[#FBE9A6] border border-[#1F2A5A] px-2.5 py-1 text-[#1F2A5A] inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#5E8C6A]" aria-hidden="true" />
              Escalations strip all student PII before Maintenance Staff handoff
            </span>
          </div>

          {complaints.length === 0 ? (
            <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
              No student complaints currently logged inside your authorized block scope.
            </p>
          ) : (
            <div className="space-y-3">
              {complaints.map((cmp) => (
                <article
                  key={cmp.id}
                  className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                      {cmp.complaint_code} · {cmp.block_name} Rm {cmp.room_number} (Fl {cmp.floor})
                      · {cmp.student_name} ({cmp.student_code})
                    </div>
                    <span
                      className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                        STATUS_BADGE[cmp.status] ?? 'bg-[#F8F2E4]'
                      }`}
                    >
                      {cmp.status}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-[#1F2A5A]">
                    [{cmp.category.toUpperCase()} / {cmp.priority.toUpperCase()}] {cmp.subject}
                  </h3>
                  <p className="text-xs text-[#465078]">{cmp.description}</p>

                  {cmp.escalated_ticket_code && (
                    <div className="bg-[#FBE9A6] border border-[#1F2A5A] px-2.5 py-1.5 font-mono-code text-[11px] text-[#1F2A5A] inline-flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-[#C2552D]" aria-hidden="true" />
                      Dispatched Work Order: {cmp.escalated_ticket_code} (Zero Student PII)
                    </div>
                  )}

                  {cmp.resolution_note && (
                    <p className="text-xs text-[#1F2A5A]">
                      <span className="font-mono-code font-bold">Resolution Note:</span>{' '}
                      {cmp.resolution_note}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditComplaintId(editComplaintId === cmp.id ? null : cmp.id);
                        setEscalateComplaintId(null);
                        setEditStatus(cmp.status === 'OPEN' ? 'IN_PROGRESS' : 'RESOLVED');
                        setEditResolutionNote(cmp.resolution_note ?? '');
                      }}
                      className="px-3 py-1 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                    >
                      Update Status
                    </button>
                    {!cmp.escalated_maintenance_task_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setEscalateComplaintId(escalateComplaintId === cmp.id ? null : cmp.id);
                          setEditComplaintId(null);
                          setSanitizedSummary(
                            `${cmp.category.toUpperCase()} repair required in Room ${cmp.room_number}`
                          );
                          setLocationDetail(
                            `${cmp.block_name}, Floor ${cmp.floor}, Room ${cmp.room_number}`
                          );
                        }}
                        className="px-3 py-1 bg-[#C2552D] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A] inline-flex items-center gap-1"
                      >
                        <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                        Escalate to Maintenance (PII-Stripped)
                      </button>
                    )}
                  </div>

                  {/* Inline Status Update */}
                  {editComplaintId === cmp.id && (
                    <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] p-3 space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as ComplaintStatus)}
                          className="px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] font-mono-code text-xs"
                        >
                          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="RESOLVED">RESOLVED</option>
                          <option value="CLOSED">CLOSED</option>
                          <option value="REJECTED">REJECTED</option>
                        </select>
                        <input
                          type="text"
                          value={editResolutionNote}
                          onChange={(e) => setEditResolutionNote(e.target.value)}
                          placeholder="Official warden action or resolution note"
                          className="sm:col-span-2 px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] text-xs"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={busyKey === `cmp-upd-${cmp.id}`}
                        onClick={() => void handleUpdateComplaint(cmp.id)}
                        className="px-4 py-1.5 bg-[#5E8C6A] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A]"
                      >
                        Save Complaint Update
                      </button>
                    </div>
                  )}

                  {/* Inline PII-Stripped Escalation Panel */}
                  {escalateComplaintId === cmp.id && (
                    <div className="bg-[#F8F2E4] border-2 border-[#C2552D] p-3.5 space-y-2.5">
                      <div className="bg-[#FBE9A6] border border-[#B3261E] p-2.5 text-xs text-[#1F2A5A] flex items-start gap-2">
                        <ShieldAlert
                          className="w-4 h-4 text-[#B3261E] shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span>
                          <strong>Strict Data Minimization:</strong> Do NOT include the student&apos;s
                          name, roll number, email, or phone below. Maintenance staff only receive
                          block, floor, room number, and technical scope.
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                            Sanitized Technical Summary (No Student PII)
                          </label>
                          <input
                            type="text"
                            value={sanitizedSummary}
                            onChange={(e) => setSanitizedSummary(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] text-xs"
                          />
                        </div>
                        <div>
                          <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                            Location Detail
                          </label>
                          <input
                            type="text"
                            value={locationDetail}
                            onChange={(e) => setLocationDetail(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] text-xs"
                          />
                        </div>
                      </div>
                      {maintenanceStaff.length > 0 && (
                        <div>
                          <label className="block font-mono-code text-[10px] uppercase text-[#465078] mb-1">
                            Assign Active Maintenance Staff (Optional)
                          </label>
                          <select
                            value={assigneeId}
                            onChange={(e) => setAssigneeId(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] font-mono-code text-xs"
                          >
                            <option value="">Unassigned (Block Queue)</option>
                            {maintenanceStaff.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.full_name} ({m.email})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyKey === `cmp-esc-${cmp.id}`}
                          onClick={() => void handleEscalateComplaint(cmp.id)}
                          className="px-4 py-1.5 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A]"
                        >
                          {busyKey === `cmp-esc-${cmp.id}`
                            ? 'Dispatching...'
                            : 'Dispatch Sanitized Work Order'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEscalateComplaintId(null)}
                          className="px-3 py-1.5 bg-[#F1E6CF] text-[#1F2A5A] font-bold text-xs border border-[#1F2A5A]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: GATE PASSES */}
      {activeTab === 'gate-passes' && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
            Gate Pass Approvals &amp; Entry/Exit Control ({gatePasses.length})
          </h2>
          {gatePasses.length === 0 ? (
            <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
              No gate pass applications inside your block scope.
            </p>
          ) : (
            <div className="space-y-3">
              {gatePasses.map((gp) => (
                <article
                  key={gp.id}
                  className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                      {gp.pass_code ? `PASS ${gp.pass_code}` : 'PENDING PASS'} ·{' '}
                      {gp.student_name} ({gp.student_code}) · {gp.room_label}
                    </span>
                    <span
                      className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                        STATUS_BADGE[gp.status] ?? 'bg-[#F8F2E4]'
                      }`}
                    >
                      {gp.status}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-[#1F2A5A]">
                    [{gp.pass_type.replace('_', ' ')}] {gp.destination}
                  </p>
                  <p className="text-xs text-[#465078]">
                    {gp.reason} · Emergency Phone: {gp.emergency_contact_phone}
                  </p>
                  <div className="font-mono-code text-[11px] text-[#465078] tabular-nums flex flex-wrap gap-x-4">
                    <span>Out: {new Date(gp.departure_at).toLocaleString()}</span>
                    <span>Expected In: {new Date(gp.expected_return_at).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1.5">
                    {gp.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          disabled={busyKey === `gp-${gp.id}-APPROVE`}
                          onClick={() => void handleReviewGatePass(gp.id, 'APPROVE')}
                          className="px-3 py-1 bg-[#5E8C6A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A] inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Approve &amp; Issue Code
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `gp-${gp.id}-REJECT`}
                          onClick={() => void handleReviewGatePass(gp.id, 'REJECT')}
                          className="px-3 py-1 bg-[#B3261E] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A] inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          Reject
                        </button>
                      </>
                    )}
                    {gp.status === 'APPROVED' && (
                      <button
                        type="button"
                        disabled={busyKey === `gp-${gp.id}-MARK_EXITED`}
                        onClick={() => void handleReviewGatePass(gp.id, 'MARK_EXITED')}
                        className="px-3 py-1 bg-[#C2552D] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                      >
                        Log Gate Exit
                      </button>
                    )}
                    {(gp.status === 'CHECKED_OUT_GATE' || gp.status === 'APPROVED') && (
                      <button
                        type="button"
                        disabled={busyKey === `gp-${gp.id}-MARK_RETURNED`}
                        onClick={() => void handleReviewGatePass(gp.id, 'MARK_RETURNED')}
                        className="px-3 py-1 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                      >
                        Log Gate Return
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: VISITOR REGISTER */}
      {activeTab === 'visitors' && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
          <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
            Institutional Visitor Gate Register ({visitors.length})
          </h2>
          {visitors.length === 0 ? (
            <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
              No scheduled or active visitors inside your block scope.
            </p>
          ) : (
            <div className="space-y-3">
              {visitors.map((v) => (
                <article
                  key={v.id}
                  className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                      {v.visitor_code} · Host: {v.student_name} ({v.room_label}) · Date:{' '}
                      {v.scheduled_date}
                    </div>
                    <p className="text-sm font-bold text-[#1F2A5A]">
                      {v.visitor_name}{' '}
                      <span className="font-normal text-xs text-[#465078]">
                        ({v.relation}) — {v.id_type} ****{v.id_last_four}
                      </span>
                    </p>
                    <p className="text-xs text-[#465078]">{v.purpose}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                        STATUS_BADGE[v.status] ?? 'bg-[#F8F2E4]'
                      }`}
                    >
                      {v.status}
                    </span>
                    {v.status === 'SCHEDULED' && (
                      <>
                        <button
                          type="button"
                          disabled={busyKey === `vis-${v.id}-CHECKED_IN`}
                          onClick={() => void handleUpdateVisitor(v.id, 'CHECKED_IN')}
                          className="px-3 py-1 bg-[#5E8C6A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                        >
                          Check In
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `vis-${v.id}-DENIED`}
                          onClick={() => void handleUpdateVisitor(v.id, 'DENIED')}
                          className="px-3 py-1 bg-[#B3261E] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                        >
                          Deny Entry
                        </button>
                      </>
                    )}
                    {v.status === 'CHECKED_IN' && (
                      <button
                        type="button"
                        disabled={busyKey === `vis-${v.id}-CHECKED_OUT`}
                        onClick={() => void handleUpdateVisitor(v.id, 'CHECKED_OUT')}
                        className="px-3 py-1 bg-[#1F2A5A] text-[#F8F2E4] font-mono-code text-xs font-bold border border-[#1F2A5A]"
                      >
                        Check Out
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
