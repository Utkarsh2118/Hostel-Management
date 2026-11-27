import React, { useEffect, useState } from 'react';
import { Building2, ClipboardList, Megaphone, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  Announcement,
  Block,
  Dispute,
  DisputeStatus,
  Room,
  RoomTag,
  SwapProposal,
} from '../../lib/types';
import { Stamp } from '../components/ui/Stamp';

interface ScopedBlock extends Block {
  room_count: number;
  capacity: number;
  occupied: number;
  available_rooms: number;
}

interface ScopedRoom extends Room {
  block_name: string;
  block_code: string;
}

interface ScopedStudent {
  id: string;
  student_code: string;
  name: string;
  email: string;
  year: number;
  branch: string;
  gender: 'male' | 'female';
  allotted_room_id: string | null;
  allotted_room_label: string | null;
  block_id: string | null;
}

interface ScopedSwapRequest {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  current_room_label: string;
  status: string;
  created_at: string;
  wanted_criteria: {
    note?: string;
  };
}

interface WardenDashboardResponse {
  warden: {
    id: string;
    name: string;
    email: string;
    assigned_block_ids: string[];
  };
  blocks: ScopedBlock[];
  rooms: ScopedRoom[];
  students: ScopedStudent[];
  swap_requests: ScopedSwapRequest[];
  swap_proposals: SwapProposal[];
  disputes: Dispute[];
  announcements: Announcement[];
}

interface WardenDashboardPageProps {
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

type WardenTab = 'overview' | 'rooms' | 'students' | 'swaps' | 'complaints' | 'notices';

const ALL_ROOM_TAGS: RoomTag[] = ['quiet', 'near_mess', 'near_stairs', 'corner', 'balcony'];

export const WardenDashboardPage: React.FC<WardenDashboardPageProps> = ({ onToast }) => {
  const [data, setData] = useState<WardenDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<WardenTab>('overview');

  // Scoped room creation
  const [newBlockId, setNewBlockId] = useState('');
  const [newFloor, setNewFloor] = useState(1);
  const [newNumber, setNewNumber] = useState('');
  const [newCap, setNewCap] = useState<1 | 2 | 3 | 4>(2);
  const [newAc, setNewAc] = useState(false);
  const [newTags, setNewTags] = useState<RoomTag[]>(['quiet']);

  // Scoped dispute drafts
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});

  // Scoped notice composer
  const [noticeBlockId, setNoticeBlockId] = useState('');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [noticePriority, setNoticePriority] = useState<'urgent' | 'notice' | 'circular'>('notice');
  const [postingNotice, setPostingNotice] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<WardenDashboardResponse>('/api/warden/dashboard');
      setData(res);
      if (res.blocks.length > 0) {
        setNewBlockId((prev) => prev || res.blocks[0].id);
        setNoticeBlockId((prev) => prev || res.blocks[0].id);
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to load Warden dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlockId || !newNumber.trim()) return;
    try {
      await apiFetch('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          block_id: newBlockId,
          floor: newFloor,
          number: newNumber.trim(),
          capacity: newCap,
          ac: newAc,
          tags: newTags,
        }),
      });
      onToast('success', `Room ${newNumber.trim()} added to your assigned block.`);
      setNewNumber('');
      await loadDashboard();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to create room.');
    }
  };

  const handleToggleAc = async (room: ScopedRoom) => {
    try {
      await apiFetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ac: !room.ac }),
      });
      onToast('success', `Updated ${room.block_code}-${room.number} AC setting.`);
      await loadDashboard();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update room.');
    }
  };

  const handleResolveDispute = async (disputeId: string, status: DisputeStatus) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/disputes/${disputeId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          resolution_note: resolutionDrafts[disputeId] ?? '',
        }),
      });
      onToast('success', res.message);
      await loadDashboard();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to update complaint.');
    }
  };

  const handleCancelSwap = async (requestId: string) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/swaps/requests/${requestId}`, {
        method: 'DELETE',
      });
      onToast('info', res.message);
      await loadDashboard();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to moderate swap request.');
    }
  };

  const handlePostNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeBlockId) return;
    setPostingNotice(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/notices', {
        method: 'POST',
        body: JSON.stringify({
          block_id: noticeBlockId,
          title: noticeTitle.trim(),
          body: noticeBody.trim(),
          priority: noticePriority,
        }),
      });
      onToast('success', res.message);
      setNoticeTitle('');
      setNoticeBody('');
      await loadDashboard();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Unable to publish block notice.');
    } finally {
      setPostingNotice(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center font-mono-code text-sm text-[#465078]">
        Loading assigned Bhavan warden desk...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 bg-[#F8F2E4] border-2 border-[#B3261E] text-sm text-[#B3261E]">
        Unable to load Warden dashboard data.
      </div>
    );
  }

  const totalCap = data.blocks.reduce((s, b) => s + b.capacity, 0);
  const totalOcc = data.blocks.reduce((s, b) => s + b.occupied, 0);
  const occupancyPct = totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0;

  return (
    <div className="space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            BLOCK WARDEN OPERATIONS DESK · SCOPED TO ASSIGNED BHAVANS ONLY
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            {data.warden.name}
          </h1>
          <p className="text-xs text-[#465078] mt-1">
            Assigned Bhavans:{' '}
            <strong className="text-[#1F2A5A]">
              {data.blocks.map((b) => b.name).join(' · ') || 'None assigned'}
            </strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Stamp label="WARDEN SCOPE" variant="ink" size="sm" />
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="px-3 py-1.5 text-xs font-bold bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      {/* Warden Section Tabs */}
      <nav aria-label="Warden desk sections" className="flex flex-wrap gap-1.5 border-b-2 border-[#1F2A5A] pb-3">
        {(
          [
            ['overview', '01. Assigned Blocks'],
            ['rooms', `02. Block Rooms (${data.rooms.length})`],
            ['students', `03. Residents (${data.students.length})`],
            ['swaps', `04. Swap Requests (${data.swap_requests.length})`],
            ['complaints', `05. Complaints (${data.disputes.length})`],
            ['notices', '06. Block Notices'],
          ] as Array<[WardenTab, string]>
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

      {/* TAB 1: Assigned Blocks & Occupancy */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4">
              <p className="font-mono-code text-[11px] text-[#465078]">ASSIGNED BLOCKS</p>
              <p className="font-display text-3xl text-[#1F2A5A] mt-1">{data.blocks.length}</p>
            </div>
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4">
              <p className="font-mono-code text-[11px] text-[#465078]">OCCUPANCY RATE</p>
              <p className="font-display text-3xl text-[#295234] mt-1">{occupancyPct}%</p>
              <p className="font-mono-code text-[11px] text-[#465078]">
                {totalOcc}/{totalCap} beds
              </p>
            </div>
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4">
              <p className="font-mono-code text-[11px] text-[#465078]">OPEN COMPLAINTS</p>
              <p className="font-display text-3xl text-[#C2552D] mt-1">
                {data.disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length}
              </p>
            </div>
            <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4">
              <p className="font-mono-code text-[11px] text-[#465078]">ACTIVE SWAPS</p>
              <p className="font-display text-3xl text-[#1F2A5A] mt-1">
                {data.swap_requests.filter((r) => r.status === 'open' || r.status === 'matched').length}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {data.blocks.map((block) => {
              const pct = block.capacity > 0 ? Math.round((block.occupied / block.capacity) * 100) : 0;
              return (
                <article
                  key={block.id}
                  className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-code text-xs text-[#465078]">
                        {block.code} · {block.gender_type.toUpperCase()} BHAVAN · {block.floors} FLOORS
                      </p>
                      <h2 className="font-display text-2xl text-[#1F2A5A] flex items-center gap-2 mt-0.5">
                        <Building2 className="w-5 h-5" aria-hidden="true" />
                        {block.name}
                      </h2>
                    </div>
                    <Stamp label={`${pct}% FULL`} variant={pct > 90 ? 'brick' : 'green'} size="sm" />
                  </div>
                  <p className="text-xs text-[#465078]">{block.description}</p>
                  <div className="w-full h-3 bg-[#F1E6CF] border border-[#1F2A5A] rounded-[1px]">
                    <div
                      className="h-full bg-[#1F2A5A]"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <div className="flex justify-between font-mono-code text-xs text-[#1F2A5A]">
                    <span>
                      {block.occupied}/{block.capacity} beds occupied
                    </span>
                    <span>
                      {block.available_rooms} room(s) with openings
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: Manage Rooms strictly within assigned blocks */}
      {tab === 'rooms' && (
        <div className="space-y-6">
          <form
            onSubmit={handleAddRoom}
            className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4"
          >
            <h2 className="font-display text-xl text-[#1F2A5A]">
              Add Room in Assigned Block
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-sm">
              <label className="block lg:col-span-2">
                <span className="text-xs font-bold block mb-1">Assigned Block</span>
                <select
                  value={newBlockId}
                  onChange={(e) => setNewBlockId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                >
                  {data.blocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
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
                  value={newFloor}
                  onChange={(e) => setNewFloor(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold block mb-1">Room No.</span>
                <input
                  type="text"
                  required
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="109"
                  className="w-full px-3 py-2 font-mono-code bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold block mb-1">Capacity</span>
                <select
                  value={newCap}
                  onChange={(e) => setNewCap(Number(e.target.value) as 1 | 2 | 3 | 4)}
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
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5 font-bold">
                <input
                  type="checkbox"
                  checked={newAc}
                  onChange={(e) => setNewAc(e.target.checked)}
                  className="w-4 h-4 accent-[#C2552D]"
                />
                AC Equipped
              </label>
              {ALL_ROOM_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setNewTags((prev) =>
                      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                    )
                  }
                  className={`px-2 py-0.5 font-mono-code border border-[#1F2A5A] ${
                    newTags.includes(tag) ? 'bg-[#FBE9A6] font-bold' : 'bg-[#F1E6CF]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </form>

          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink overflow-x-auto">
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
                {data.rooms.slice(0, 40).map((rm) => (
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
                    <td className="py-2.5 px-4 font-mono-code">{rm.ac ? 'AC' : 'Non-AC'}</td>
                    <td className="py-2.5 px-4 text-xs text-[#465078]">
                      {rm.tags.join(' · ') || '—'}
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => void handleToggleAc(rm)}
                        className="text-xs font-bold text-[#C2552D] hover:underline"
                      >
                        Toggle AC
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* TAB 3: Scoped Student Allotment Roster */}
      {tab === 'students' && (
        <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink overflow-x-auto">
          <div className="px-4 py-3 border-b-2 border-[#1F2A5A] bg-[#F1E6CF] flex items-center justify-between">
            <h2 className="font-bold text-sm text-[#1F2A5A] flex items-center gap-2">
              <ClipboardList className="w-4 h-4" aria-hidden="true" />
              Residents Allotted in Your Assigned Blocks ({data.students.length})
            </h2>
            <span className="font-mono-code text-xs text-[#465078]">READ-ONLY SCOPE</span>
          </div>
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#1F2A5A]/30 text-xs font-mono-code bg-[#F1E6CF]/60">
                <th className="py-2.5 px-4">Student</th>
                <th className="py-2.5 px-4">Year / Branch</th>
                <th className="py-2.5 px-4">Room</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2A5A]/20">
              {data.students.slice(0, 60).map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 px-4">
                    <div className="font-bold text-[#1F2A5A]">{s.name}</div>
                    <div className="font-mono-code text-xs text-[#465078]">{s.student_code}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    Yr {s.year} · {s.branch}
                  </td>
                  <td className="py-2.5 px-4 font-mono-code font-bold text-[#295234]">
                    {s.allotted_room_label ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* TAB 4: Scoped Swap Requests */}
      {tab === 'swaps' && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl text-[#1F2A5A]">
            Room Exchange Requests Touching Your Assigned Blocks
          </h2>
          {data.swap_requests.length === 0 ? (
            <div className="p-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] text-sm text-[#465078]">
              No active swap requests currently involve rooms in your assigned blocks.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.swap_requests.map((req) => (
                <article
                  key={req.id}
                  className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                      {req.current_room_label} · {req.student_code}
                    </span>
                    <Stamp
                      label={req.status.toUpperCase()}
                      variant={req.status === 'executed' ? 'green' : 'brick'}
                      size="sm"
                    />
                  </div>
                  <p className="font-bold text-sm text-[#1F2A5A]">{req.student_name}</p>
                  <p className="text-xs text-[#465078]">
                    {req.wanted_criteria.note ?? 'Seeking swap matching specified room filters.'}
                  </p>
                  {(req.status === 'open' || req.status === 'matched') && (
                    <div className="pt-2 border-t border-[#1F2A5A]/20 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleCancelSwap(req.id)}
                        className="px-3 py-1 text-xs font-bold text-[#B3261E] bg-[#F1E6CF] border border-[#B3261E] rounded-[2px] hover:bg-[#FBE9A6]"
                      >
                        Cancel Notice
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 5: Scoped Student Complaints & Disputes */}
      {tab === 'complaints' && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl text-[#1F2A5A]">
            Student Complaints &amp; Maintenance Issues (Assigned Blocks)
          </h2>
          {data.disputes.length === 0 ? (
            <div className="p-6 bg-[#F8F2E4] border-2 border-[#1F2A5A] text-sm text-[#465078]">
              No complaints filed by residents of your assigned blocks.
            </div>
          ) : (
            data.disputes.map((d) => (
              <article
                key={d.id}
                className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono-code text-xs text-[#465078]">
                      {d.id} · {d.category.toUpperCase()} · {d.student_name}
                    </p>
                    <h3 className="font-bold text-base text-[#1F2A5A]">{d.subject}</h3>
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
                    placeholder="Add Warden resolution remarks..."
                    className="w-full px-3 py-2 text-xs bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
                  />
                  <div className="flex flex-wrap gap-2">
                    {(['under_review', 'resolved', 'dismissed'] as DisputeStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => void handleResolveDispute(d.id, st)}
                        className="px-3 py-1.5 text-xs font-bold bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] capitalize"
                      >
                        Mark {st.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      )}

      {/* TAB 6: Block Notices */}
      {tab === 'notices' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handlePostNotice}
            className="lg:col-span-5 bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 space-y-4"
          >
            <h2 className="font-display text-2xl text-[#1F2A5A] flex items-center gap-2">
              <Megaphone className="w-5 h-5" aria-hidden="true" />
              Issue Block Notice
            </h2>
            <label className="block">
              <span className="text-xs font-bold block mb-1">Target Assigned Block *</span>
              <select
                value={noticeBlockId}
                onChange={(e) => setNoticeBlockId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                {data.blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold block mb-1">Priority *</span>
              <select
                value={noticePriority}
                onChange={(e) =>
                  setNoticePriority(e.target.value as 'urgent' | 'notice' | 'circular')
                }
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              >
                <option value="notice">Notice</option>
                <option value="circular">Circular</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold block mb-1">Title *</span>
              <input
                type="text"
                required
                minLength={4}
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                placeholder="e.g., Water Cooler Maintenance — Floor 2"
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold block mb-1">Notice Body *</span>
              <textarea
                required
                minLength={10}
                rows={4}
                value={noticeBody}
                onChange={(e) => setNoticeBody(e.target.value)}
                placeholder="Write clear instructions and timings for residents..."
                className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px]"
              />
            </label>
            <button
              type="submit"
              disabled={postingNotice}
              className="w-full py-2.5 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm disabled:opacity-50"
            >
              {postingNotice ? 'Pinning Notice...' : 'Pin Notice to Bhavan Board'}
            </button>
          </form>

          <section className="lg:col-span-7 space-y-3">
            <h2 className="font-display text-2xl text-[#1F2A5A]">
              Active Circulars &amp; Block Notices ({data.announcements.length})
            </h2>
            {data.announcements.map((a) => (
              <article
                key={a.id}
                className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-code text-xs text-[#465078]">
                    {a.date ?? ''} · {a.issued_by}
                  </span>
                  <Stamp
                    label={a.priority.toUpperCase()}
                    variant={a.priority === 'urgent' ? 'red' : 'ink'}
                    size="sm"
                  />
                </div>
                <h3 className="font-bold text-base text-[#1F2A5A]">{a.title}</h3>
                <p className="text-sm text-[#1F2A5A] leading-relaxed">{a.body}</p>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
};
