import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  KeyRound,
  LogOut,
  ShieldAlert,
  UserPlus,
  Wrench,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  ComplaintCategory,
  GatePassRequest,
  GatePassType,
  HostelComplaint,
  OccupancyCheckRecord,
  VisitorEntry,
} from '../../lib/operations/service';
import type { MaintenancePriority } from '../../lib/types';
import type { ToastMessage } from '../components/layout/ToastContainer';

export interface StudentOperationsPageProps {
  onToast: (tone: ToastMessage['tone'], text: string) => void;
}

type OperationsTab = 'occupancy' | 'complaints' | 'gate-passes' | 'visitors';

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

const COMPLAINT_CATEGORIES: { value: ComplaintCategory; label: string }[] = [
  { value: 'electrical', label: 'Electrical & Lighting' },
  { value: 'plumbing', label: 'Plumbing & Water' },
  { value: 'furniture', label: 'Furniture & Bed' },
  { value: 'cleaning', label: 'Housekeeping & Cleaning' },
  { value: 'internet', label: 'LAN / Wi-Fi Network' },
  { value: 'safety', label: 'Safety & Locks' },
  { value: 'mess_dining', label: 'Mess & Dining' },
  { value: 'roommate', label: 'Roommate Matter' },
  { value: 'discipline', label: 'Hostel Conduct' },
  { value: 'other', label: 'Other Hostel Matter' },
];

const GATE_PASS_TYPES: { value: GatePassType; label: string }[] = [
  { value: 'DAY_OUT', label: 'Day Outing' },
  { value: 'OVERNIGHT', label: 'Overnight Leave' },
  { value: 'HOME_LEAVE', label: 'Home / Semester Leave' },
  { value: 'MEDICAL_EMERGENCY', label: 'Medical / Urgent Visit' },
];

function defaultDateOffset(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function defaultDateTimeOffset(hours: number): string {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

export const StudentOperationsPage: React.FC<StudentOperationsPageProps> = ({ onToast }) => {
  const [activeTab, setActiveTab] = useState<OperationsTab>('occupancy');
  const [loading, setLoading] = useState(true);
  const [occupancyRecords, setOccupancyRecords] = useState<OccupancyCheckRecord[]>([]);
  const [complaints, setComplaints] = useState<HostelComplaint[]>([]);
  const [gatePasses, setGatePasses] = useState<GatePassRequest[]>([]);
  const [visitors, setVisitors] = useState<VisitorEntry[]>([]);

  // Checkout request form
  const [plannedCheckoutDate, setPlannedCheckoutDate] = useState(defaultDateOffset(7));
  const [checkoutReason, setCheckoutReason] = useState('');
  const [submittingCheckout, setSubmittingCheckout] = useState(false);

  // Complaint form
  const [cmpCategory, setCmpCategory] = useState<ComplaintCategory>('electrical');
  const [cmpPriority, setCmpPriority] = useState<MaintenancePriority>('medium');
  const [cmpSubject, setCmpSubject] = useState('');
  const [cmpDescription, setCmpDescription] = useState('');
  const [submittingCmp, setSubmittingCmp] = useState(false);

  // Gate pass form
  const [gpType, setGpType] = useState<GatePassType>('DAY_OUT');
  const [gpDestination, setGpDestination] = useState('');
  const [gpDeparture, setGpDeparture] = useState(defaultDateTimeOffset(2));
  const [gpReturn, setGpReturn] = useState(defaultDateTimeOffset(10));
  const [gpPhone, setGpPhone] = useState('');
  const [gpReason, setGpReason] = useState('');
  const [submittingGp, setSubmittingGp] = useState(false);
  const [cancellingPassId, setCancellingPassId] = useState<string | null>(null);

  // Visitor form
  const [visName, setVisName] = useState('');
  const [visRelation, setVisRelation] = useState('Parent');
  const [visIdType, setVisIdType] = useState<VisitorEntry['id_type']>('GOVT_ID');
  const [visIdLastFour, setVisIdLastFour] = useState('');
  const [visPurpose, setVisPurpose] = useState('');
  const [visDate, setVisDate] = useState(defaultDateOffset(1));
  const [submittingVis, setSubmittingVis] = useState(false);

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
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to load hostel operations register.'
      );
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const myOccupancy = occupancyRecords[0] ?? null;

  const handleRequestCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCheckout(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/operations/occupancy/checkout-request', {
        method: 'POST',
        body: JSON.stringify({
          planned_date: plannedCheckoutDate,
          reason: checkoutReason,
        }),
      });
      onToast('success', res.message);
      setCheckoutReason('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Check-out request failed.');
    } finally {
      setSubmittingCheckout(false);
    }
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCmp(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/operations/complaints', {
        method: 'POST',
        body: JSON.stringify({
          category: cmpCategory,
          priority: cmpPriority,
          subject: cmpSubject,
          description: cmpDescription,
        }),
      });
      onToast('success', res.message);
      setCmpSubject('');
      setCmpDescription('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to file complaint.');
    } finally {
      setSubmittingCmp(false);
    }
  };

  const handleSubmitGatePass = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingGp(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/operations/gate-passes', {
        method: 'POST',
        body: JSON.stringify({
          pass_type: gpType,
          destination: gpDestination,
          reason: gpReason,
          departure_at: new Date(gpDeparture).toISOString(),
          expected_return_at: new Date(gpReturn).toISOString(),
          emergency_contact_phone: gpPhone,
        }),
      });
      onToast('success', res.message);
      setGpDestination('');
      setGpReason('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to submit gate pass.');
    } finally {
      setSubmittingGp(false);
    }
  };

  const handleCancelGatePass = async (passId: string) => {
    setCancellingPassId(passId);
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/operations/gate-passes/${encodeURIComponent(passId)}/cancel`,
        { method: 'POST' }
      );
      onToast('info', res.message);
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to cancel gate pass.');
    } finally {
      setCancellingPassId(null);
    }
  };

  const handleRegisterVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingVis(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/operations/visitors', {
        method: 'POST',
        body: JSON.stringify({
          visitor_name: visName,
          relation: visRelation,
          id_type: visIdType,
          id_last_four: visIdLastFour,
          purpose: visPurpose,
          scheduled_date: visDate,
        }),
      });
      onToast('success', res.message);
      setVisName('');
      setVisIdLastFour('');
      setVisPurpose('');
      await loadAll();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to register visitor.');
    } finally {
      setSubmittingVis(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading Student Hostel Operations Register...
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
              PHASE 4 · RESIDENT OPERATIONS REGISTER
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] leading-tight mt-1">
              Check-In, Complaints, Gate Pass &amp; Visitors
            </h1>
            <p className="text-sm text-[#465078] mt-1">
              Every request is strictly bound to your verified room allotment and routed only to your
              assigned block warden. Maintenance dispatches strip all student personal identifiers.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono-code text-xs shrink-0">
            <div className="bg-[#F1E6CF] border border-[#1F2A5A] px-3 py-2">
              <span className="block text-[10px] uppercase text-[#465078]">Room Status</span>
              <span className="font-bold text-[#1F2A5A]">
                {myOccupancy ? myOccupancy.status.replace('_', ' ') : 'UNALLOTTED'}
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

        {/* Folder Tab Strip */}
        <div
          role="tablist"
          aria-label="Resident operations registers"
          className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4"
        >
          {(
            [
              { id: 'occupancy', label: '01 · Check-In / Check-Out', icon: KeyRound },
              { id: 'complaints', label: '02 · Complaints & Repairs', icon: Wrench },
              { id: 'gate-passes', label: '03 · Gate Passes', icon: DoorOpen },
              { id: 'visitors', label: '04 · Visitor Register', icon: UserPlus },
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

      {/* TAB 1: OCCUPANCY CHECK-IN / CHECK-OUT */}
      {activeTab === 'occupancy' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1F2A5A]/30 pb-2.5">
              <h2 className="font-display text-2xl text-[#1F2A5A] inline-flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#C2552D]" aria-hidden="true" />
                Room Key &amp; Handover Ledger
              </h2>
              {myOccupancy && (
                <span
                  className={`px-2.5 py-1 font-mono-code text-xs font-bold border border-[#1F2A5A] ${
                    STATUS_BADGE[myOccupancy.status] ?? 'bg-[#F1E6CF]'
                  }`}
                >
                  {myOccupancy.status}
                </span>
              )}
            </div>

            {!myOccupancy ? (
              <div className="bg-[#F1E6CF] border border-[#1F2A5A] p-4 text-sm text-[#465078]">
                No active room allotment found on your student record. Complete hostel allotment
                before room check-in can be logged by your block warden.
              </div>
            ) : (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-[#F1E6CF] border border-[#1F2A5A] p-4 font-mono-code text-xs">
                  <div>
                    <dt className="text-[10px] uppercase text-[#465078]">Assigned Room</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5">{myOccupancy.room_label}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-[#465078]">Hostel Block</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5">{myOccupancy.block_name}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-[#465078]">Issued Key Serial</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5 tabular-nums">
                      {myOccupancy.key_serial ?? 'Pending Desk Handover'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-[#465078]">Checked-In At</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5 tabular-nums">
                      {myOccupancy.checked_in_at
                        ? new Date(myOccupancy.checked_in_at).toLocaleString()
                        : 'Not yet recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-[#465078]">Key Return Verified</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5">
                      {myOccupancy.key_returned ? 'YES — RETURNED' : 'HELD BY RESIDENT'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-[#465078]">Check-Out Cleared</dt>
                    <dd className="font-bold text-[#1F2A5A] mt-0.5 tabular-nums">
                      {myOccupancy.checked_out_at
                        ? new Date(myOccupancy.checked_out_at).toLocaleString()
                        : 'Active Occupancy'}
                    </dd>
                  </div>
                </dl>

                {myOccupancy.room_condition_checkin && (
                  <div className="bg-[#F1E6CF] border-l-4 border-[#1F2A5A] p-3 text-xs">
                    <p className="font-mono-code font-bold uppercase text-[#465078]">
                      Check-In Inventory Condition Note
                    </p>
                    <p className="text-[#1F2A5A] mt-1">{myOccupancy.room_condition_checkin}</p>
                  </div>
                )}

                {myOccupancy.checkout_reason && (
                  <div className="bg-[#FBE9A6] border border-[#1F2A5A] p-3 text-xs">
                    <p className="font-mono-code font-bold uppercase text-[#C2552D]">
                      Check-Out Request Logged (Planned: {myOccupancy.checkout_planned_date})
                    </p>
                    <p className="text-[#1F2A5A] mt-1">{myOccupancy.checkout_reason}</p>
                    {myOccupancy.clearance_note && (
                      <p className="text-[#465078] mt-1.5 font-mono-code">
                        Clearance Note: {myOccupancy.clearance_note}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5 inline-flex items-center gap-2">
              <LogOut className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              Request Hostel Check-Out
            </h2>
            <p className="text-xs text-[#465078]">
              Notify your block warden ahead of vacating your room. Final check-out requires physical
              key handover and inventory clearance at the warden desk.
            </p>
            <form onSubmit={(e) => void handleRequestCheckout(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="co-date"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Planned Vacating Date
                </label>
                <input
                  id="co-date"
                  type="date"
                  required
                  disabled={!myOccupancy || myOccupancy.status === 'CHECKED_OUT'}
                  value={plannedCheckoutDate}
                  onChange={(e) => setPlannedCheckoutDate(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                />
              </div>
              <div>
                <label
                  htmlFor="co-reason"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Check-Out Reason
                </label>
                <textarea
                  id="co-reason"
                  required
                  minLength={6}
                  rows={3}
                  disabled={!myOccupancy || myOccupancy.status === 'CHECKED_OUT'}
                  value={checkoutReason}
                  onChange={(e) => setCheckoutReason(e.target.value)}
                  placeholder="e.g., Semester completion, graduating batch clearance, or off-campus shift"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <button
                type="submit"
                disabled={submittingCheckout || !myOccupancy || myOccupancy.status === 'CHECKED_OUT'}
                className="w-full py-2.5 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
              >
                {submittingCheckout ? 'Submitting Request...' : 'Submit Check-Out Notice'}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* TAB 2: COMPLAINTS & REPAIRS */}
      {activeTab === 'complaints' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              File Hostel Complaint
            </h2>
            <form onSubmit={(e) => void handleSubmitComplaint(e)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="cmp-cat"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="cmp-cat"
                    value={cmpCategory}
                    onChange={(e) => setCmpCategory(e.target.value as ComplaintCategory)}
                    className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                  >
                    {COMPLAINT_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="cmp-pri"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    Urgency
                  </label>
                  <select
                    id="cmp-pri"
                    value={cmpPriority}
                    onChange={(e) => setCmpPriority(e.target.value as MaintenancePriority)}
                    className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  htmlFor="cmp-sub"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Subject
                </label>
                <input
                  id="cmp-sub"
                  type="text"
                  required
                  minLength={5}
                  value={cmpSubject}
                  onChange={(e) => setCmpSubject(e.target.value)}
                  placeholder="e.g., Ceiling fan regulator sparking in room"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <div>
                <label
                  htmlFor="cmp-desc"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Description
                </label>
                <textarea
                  id="cmp-desc"
                  required
                  minLength={10}
                  rows={4}
                  value={cmpDescription}
                  onChange={(e) => setCmpDescription(e.target.value)}
                  placeholder="Describe the issue clearly. Your warden will sanitize details before dispatching maintenance technicians."
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <button
                type="submit"
                disabled={submittingCmp}
                className="w-full py-2.5 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
              >
                {submittingCmp ? 'Logging Complaint...' : 'Register Complaint with Warden'}
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              Your Filed Complaints ({complaints.length})
            </h2>
            {complaints.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
                You have not filed any hostel complaints yet.
              </p>
            ) : (
              <div className="space-y-3">
                {complaints.map((cmp) => (
                  <article
                    key={cmp.id}
                    className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                        {cmp.complaint_code} · {cmp.category.toUpperCase()} · {cmp.priority.toUpperCase()}
                      </div>
                      <span
                        className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                          STATUS_BADGE[cmp.status] ?? 'bg-[#F8F2E4]'
                        }`}
                      >
                        {cmp.status}
                      </span>
                    </div>
                    <h3 className="font-bold text-sm text-[#1F2A5A]">{cmp.subject}</h3>
                    <p className="text-xs text-[#465078]">{cmp.description}</p>
                    {cmp.escalated_ticket_code && (
                      <div className="bg-[#FBE9A6] border border-[#1F2A5A] px-2.5 py-1.5 font-mono-code text-[11px] text-[#1F2A5A] inline-flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5 text-[#C2552D]" aria-hidden="true" />
                        Escalated to Maintenance Work Order {cmp.escalated_ticket_code} (PII Stripped)
                      </div>
                    )}
                    {cmp.resolution_note && (
                      <p className="text-xs text-[#1F2A5A] border-t border-[#1F2A5A]/20 pt-1.5">
                        <span className="font-mono-code font-bold">Warden Note:</span>{' '}
                        {cmp.resolution_note}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: GATE PASSES */}
      {activeTab === 'gate-passes' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5 inline-flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-[#1F2A5A]" aria-hidden="true" />
              Apply for Gate Pass
            </h2>
            <form onSubmit={(e) => void handleSubmitGatePass(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="gp-type"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Pass Category
                </label>
                <select
                  id="gp-type"
                  value={gpType}
                  onChange={(e) => setGpType(e.target.value as GatePassType)}
                  className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                >
                  {GATE_PASS_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="gp-dest"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Destination
                </label>
                <input
                  id="gp-dest"
                  type="text"
                  required
                  minLength={3}
                  value={gpDestination}
                  onChange={(e) => setGpDestination(e.target.value)}
                  placeholder="e.g., Local Guardian Residence, Pune"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="gp-dep"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    Departure
                  </label>
                  <input
                    id="gp-dep"
                    type="datetime-local"
                    required
                    value={gpDeparture}
                    onChange={(e) => setGpDeparture(e.target.value)}
                    className="w-full px-2 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="gp-ret"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    Expected Return
                  </label>
                  <input
                    id="gp-ret"
                    type="datetime-local"
                    required
                    value={gpReturn}
                    onChange={(e) => setGpReturn(e.target.value)}
                    className="w-full px-2 py-1.5 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="gp-phone"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Emergency Contact Phone
                </label>
                <input
                  id="gp-phone"
                  type="tel"
                  required
                  value={gpPhone}
                  onChange={(e) => setGpPhone(e.target.value)}
                  placeholder="+91 98200 11223"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                />
              </div>
              <div>
                <label
                  htmlFor="gp-reason"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Purpose / Reason
                </label>
                <textarea
                  id="gp-reason"
                  required
                  minLength={6}
                  rows={3}
                  value={gpReason}
                  onChange={(e) => setGpReason(e.target.value)}
                  placeholder="Provide reason for leave or off-campus visit"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <button
                type="submit"
                disabled={submittingGp}
                className="w-full py-2.5 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
              >
                {submittingGp ? 'Submitting Application...' : 'Submit Gate Pass Request'}
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              Your Gate Passes ({gatePasses.length})
            </h2>
            {gatePasses.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
                No gate pass applications recorded yet.
              </p>
            ) : (
              <div className="space-y-3">
                {gatePasses.map((gp) => (
                  <article
                    key={gp.id}
                    className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                        {gp.pass_code ? `PASS ${gp.pass_code}` : 'AWAITING APPROVAL'} ·{' '}
                        {gp.pass_type.replace('_', ' ')}
                      </span>
                      <span
                        className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                          STATUS_BADGE[gp.status] ?? 'bg-[#F8F2E4]'
                        }`}
                      >
                        {gp.status}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[#1F2A5A]">{gp.destination}</p>
                    <p className="text-xs text-[#465078]">{gp.reason}</p>
                    <div className="grid grid-cols-2 gap-2 font-mono-code text-[11px] text-[#465078] tabular-nums">
                      <span>Out: {new Date(gp.departure_at).toLocaleString()}</span>
                      <span>In: {new Date(gp.expected_return_at).toLocaleString()}</span>
                    </div>
                    {gp.review_note && (
                      <p className="text-xs text-[#1F2A5A] border-t border-[#1F2A5A]/20 pt-1.5">
                        <span className="font-mono-code font-bold">Warden Note:</span>{' '}
                        {gp.review_note}
                      </p>
                    )}
                    {(gp.status === 'PENDING' || gp.status === 'APPROVED') && (
                      <div className="pt-1">
                        <button
                          type="button"
                          disabled={cancellingPassId === gp.id}
                          onClick={() => void handleCancelGatePass(gp.id)}
                          className="px-3 py-1 bg-[#F8F2E4] text-[#B3261E] font-mono-code text-xs font-bold border border-[#B3261E] hover:bg-[#B3261E] hover:text-[#F8F2E4]"
                        >
                          {cancellingPassId === gp.id ? 'Cancelling...' : 'Cancel Gate Pass'}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: VISITOR REGISTER */}
      {activeTab === 'visitors' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              Pre-Register Hostel Visitor
            </h2>
            <div className="bg-[#FBE9A6] border-2 border-[#B3261E] p-3 text-xs text-[#1F2A5A] flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-[#B3261E] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong>Data Minimization Policy:</strong> Enter <strong>ONLY the last 4 characters</strong>{' '}
                of the visitor&apos;s ID. Never enter full Aadhaar, PAN, or Passport numbers.
              </span>
            </div>
            <form onSubmit={(e) => void handleRegisterVisitor(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="vis-name"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Visitor Full Name
                </label>
                <input
                  id="vis-name"
                  type="text"
                  required
                  minLength={2}
                  value={visName}
                  onChange={(e) => setVisName(e.target.value)}
                  placeholder="e.g., Rajesh Kulkarni"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="vis-rel"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    Relation
                  </label>
                  <input
                    id="vis-rel"
                    type="text"
                    required
                    value={visRelation}
                    onChange={(e) => setVisRelation(e.target.value)}
                    placeholder="Parent / Guardian"
                    className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="vis-date"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    Visit Date
                  </label>
                  <input
                    id="vis-date"
                    type="date"
                    required
                    value={visDate}
                    onChange={(e) => setVisDate(e.target.value)}
                    className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="vis-id-type"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    ID Type
                  </label>
                  <select
                    id="vis-id-type"
                    value={visIdType}
                    onChange={(e) => setVisIdType(e.target.value as VisitorEntry['id_type'])}
                    className="w-full px-2.5 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A]"
                  >
                    <option value="GOVT_ID">Govt Photo ID</option>
                    <option value="PARENT_ID">Parent Pass</option>
                    <option value="UNIVERSITY_ID">University ID</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="vis-id-last4"
                    className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                  >
                    ID Last 4 Chars Only
                  </label>
                  <input
                    id="vis-id-last4"
                    type="text"
                    required
                    minLength={4}
                    maxLength={4}
                    pattern="[A-Za-z0-9]{4}"
                    value={visIdLastFour}
                    onChange={(e) => setVisIdLastFour(e.target.value.slice(0, 4))}
                    placeholder="4821"
                    className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] font-mono-code text-xs text-[#1F2A5A] uppercase tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="vis-purpose"
                  className="block font-mono-code text-[11px] font-bold uppercase text-[#1F2A5A] mb-1"
                >
                  Purpose of Visit
                </label>
                <input
                  id="vis-purpose"
                  type="text"
                  required
                  minLength={4}
                  value={visPurpose}
                  onChange={(e) => setVisPurpose(e.target.value)}
                  placeholder="e.g., Dropping off winter luggage & books"
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] text-xs text-[#1F2A5A]"
                />
              </div>
              <button
                type="submit"
                disabled={submittingVis}
                className="w-full py-2.5 bg-[#C2552D] text-[#F8F2E4] font-bold text-xs border-2 border-[#1F2A5A] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50"
              >
                {submittingVis ? 'Registering Visitor...' : 'Register Visitor at Hostel Gate'}
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 bg-[#F8F2E4] border-2 border-[#1F2A5A] shadow-ink-sm p-5 space-y-4">
            <h2 className="font-display text-2xl text-[#1F2A5A] border-b border-[#1F2A5A]/30 pb-2.5">
              Your Visitor Log ({visitors.length})
            </h2>
            {visitors.length === 0 ? (
              <p className="text-xs text-[#465078] bg-[#F1E6CF] border border-[#1F2A5A]/30 p-4">
                No visitors pre-registered under your room yet.
              </p>
            ) : (
              <div className="space-y-2.5">
                {visitors.map((v) => (
                  <article
                    key={v.id}
                    className="bg-[#F1E6CF] border-2 border-[#1F2A5A] p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                        {v.visitor_code} · {v.scheduled_date}
                      </span>
                      <span
                        className={`px-2 py-0.5 font-mono-code text-[11px] font-bold border border-[#1F2A5A] ${
                          STATUS_BADGE[v.status] ?? 'bg-[#F8F2E4]'
                        }`}
                      >
                        {v.status}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[#1F2A5A]">
                      {v.visitor_name}{' '}
                      <span className="font-normal text-xs text-[#465078]">({v.relation})</span>
                    </p>
                    <p className="text-xs text-[#465078]">{v.purpose}</p>
                    <div className="font-mono-code text-[11px] text-[#465078] flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        ID: {v.id_type} · ****{v.id_last_four}
                      </span>
                      {v.checked_in_at && (
                        <span className="inline-flex items-center gap-1 text-[#5E8C6A] font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          In: {new Date(v.checked_in_at).toLocaleTimeString()}
                        </span>
                      )}
                      {v.checked_out_at && (
                        <span className="inline-flex items-center gap-1 text-[#1F2A5A] font-bold">
                          <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          Out: {new Date(v.checked_out_at).toLocaleTimeString()}
                        </span>
                      )}
                      {v.status === 'DENIED' && (
                        <span className="inline-flex items-center gap-1 text-[#B3261E] font-bold">
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          Entry Denied at Gate
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
