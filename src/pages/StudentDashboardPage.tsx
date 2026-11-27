import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AllotmentAssignment,
  Announcement,
  Dispute,
  Room,
  RoommateMatch,
  Student,
  SwapProposal,
  SwapRequest,
  UnallottedRecord,
} from '../../lib/types';
import { RoomKeyTag } from '../components/rooms/RoomKeyTag';
import { Stamp } from '../components/ui/Stamp';

export interface StudentWorkspaceResponse {
  student: Student;
  allotted_room: (Room & { block_name: string; block_code: string; warden_name: string }) | null;
  roommates: Array<{
    id: string;
    name: string;
    student_code: string;
    year: number;
    branch: string;
    sleep_schedule: string;
    study_style: string;
    cleanliness: number;
  }>;
  active_run: {
    id: string;
    label: string;
    seed: string;
    created_at: string;
  } | null;
  allotment_record: AllotmentAssignment | null;
  unallotted_record: UnallottedRecord | null;
  swap_requests: SwapRequest[];
  swap_proposals: SwapProposal[];
  top_roommates: RoommateMatch[];
  announcements: Announcement[];
  disputes: Dispute[];
  eligible_rooms: Array<Room & { block_name: string; block_code: string }>;
}

interface StudentDashboardPageProps {
  activeStudentId: string;
  onNavigate: (path: string) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
}

export const StudentDashboardPage: React.FC<StudentDashboardPageProps> = ({
  activeStudentId,
  onNavigate,
  onToast,
}) => {
  const [data, setData] = useState<StudentWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState<Dispute['category']>('allotment');
  const [disputeSubject, setDisputeSubject] = useState('');
  const [disputeDesc, setDisputeDesc] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);

  const loadWorkspace = () => {
    setLoading(true);
    setError(null);
    apiFetch<StudentWorkspaceResponse>('/api/students/me')
      .then((res) => setData(res))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Unable to load student workspace.')
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWorkspace();
  }, [activeStudentId]);

  const handleSubmitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disputeSubject.trim().length < 4 || disputeDesc.trim().length < 10) {
      onToast('error', 'Please enter a subject (4+ chars) and full explanation (10+ chars).');
      return;
    }
    setSubmittingDispute(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/disputes', {
        method: 'POST',
        body: JSON.stringify({
          category: disputeCategory,
          subject: disputeSubject.trim(),
          description: disputeDesc.trim(),
        }),
      });
      onToast('success', res.message);
      setDisputeSubject('');
      setDisputeDesc('');
      setDisputeOpen(false);
      loadWorkspace();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not submit dispute.');
    } finally {
      setSubmittingDispute(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
        Loading personal hostel folder...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-5 bg-[#F8F2E4] border-2 border-[#B3261E] text-sm text-[#B3261E]">
        {error ?? 'Student record unavailable.'}
      </div>
    );
  }

  const { student, allotted_room, allotment_record, unallotted_record } = data;
  const pendingProposals = data.swap_proposals.filter((p) => p.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Personal Folio Header */}
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            STUDENT HOSTEL FOLIO · {student.student_code} · YEAR {student.year} ·{' '}
            {student.branch.toUpperCase()}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            {student.name}
          </h1>
          <p className="text-sm text-[#465078] mt-1">
            Sleep: {student.sleep_schedule} · Study: {student.study_style} · Cleanliness:{' '}
            {student.cleanliness}/5 · CGPA Band: {student.cgpa_band}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('/student/profile')}
            className="px-4 py-2 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] whitespace-nowrap"
          >
            Edit Profile &amp; Preferences ({student.preferences.length}/5)
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/rooms')}
            className="px-4 py-2 text-sm font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] whitespace-nowrap"
          >
            Explore Floor Map
          </button>
        </div>
      </header>

      {/* Main Asymmetric Split: Allotment + Room Key Tag (left) vs Swaps + Announcements + Roommates (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        <div className="lg:col-span-7 space-y-6">
          {/* Allotment Status Slip */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#1F2A5A]/25 pb-4">
              <div>
                <p className="font-mono-code text-xs text-[#465078]">
                  CURRENT ALLOTMENT STATUS · {data.active_run?.label ?? 'Official Run'}
                </p>
                <h2 className="text-2xl font-bold text-[#1F2A5A] mt-0.5">
                  {allotted_room
                    ? `Room mil gaya! ${allotted_room.block_name}, Room ${allotted_room.number}`
                    : 'Not Yet Allotted'}
                </h2>
              </div>
              <Stamp
                label={allotted_room ? 'ALLOTTED' : 'UNALLOTTED'}
                variant={allotted_room ? 'green' : 'red'}
                animate
              />
            </div>

            {allotted_room ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-[#1F2A5A] leading-relaxed">
                  {allotment_record?.explanation ??
                    `Assigned to ${allotted_room.block_name}, Floor ${allotted_room.floor}, Room ${allotted_room.number}.`}
                </p>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono-code text-[#1F2A5A] bg-[#F1E6CF] px-3.5 py-2.5 border border-[#1F2A5A]/30">
                  <span>
                    Choice Received:{' '}
                    <strong>
                      {allotment_record?.preference_rank
                        ? `#${allotment_record.preference_rank}`
                        : 'Room Swap / Paired'}
                    </strong>
                  </span>
                  <span>
                    Priority Score:{' '}
                    <strong>{allotment_record?.priority_score ?? '—'}</strong>
                  </span>
                  <span>
                    Block Warden: <strong>{allotted_room.warden_name}</strong>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigate('/student/allotment')}
                    className="font-bold text-[#C2552D] hover:underline inline-flex items-center gap-1"
                  >
                    Open Full Allotment Slip <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('/swaps')}
                    className="font-semibold text-[#1F2A5A] hover:underline"
                  >
                    Post a Room Swap Chit →
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-[#B3261E] font-medium">
                  {unallotted_record?.reason ??
                    'Your ranked room choices filled before your priority slot. Update your 5 preferences to include open rooms or contact the Block Warden.'}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('/student/profile')}
                  className="text-sm font-bold text-[#C2552D] hover:underline"
                >
                  Update Ranked Room Preferences →
                </button>
              </div>
            )}
          </section>

          {/* Pending Swap Action Alert if participating in a cycle */}
          {pendingProposals.length > 0 && (
            <section className="bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono-code text-xs font-bold text-[#B3261E]">
                    ACTION NEEDED · {pendingProposals.length} SWAP PROPOSAL(S)
                  </p>
                  <h3 className="text-lg font-bold text-[#1F2A5A] mt-0.5">
                    You are part of an active {pendingProposals[0].cycle_length}-way room swap cycle
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('/swaps')}
                  className="px-4 py-2 text-xs font-bold text-[#F8F2E4] bg-[#295234] border-2 border-[#1F2A5A] rounded-[2px] whitespace-nowrap"
                >
                  Review &amp; Accept / Reject
                </button>
              </div>
              <p className="mt-2 text-sm text-[#1F2A5A]">
                {pendingProposals[0].feasibility_summary}
              </p>
            </section>
          )}

          {/* Top Roommate Suggestions Preview */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5">
            <div className="flex items-baseline justify-between gap-2 border-b border-[#1F2A5A]/25 pb-2.5">
              <h2 className="font-display text-xl text-[#1F2A5A]">
                Compatible Roommate Picks
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('/roommates')}
                className="text-xs font-bold text-[#C2552D] hover:underline"
              >
                See Top 5 Breakdown →
              </button>
            </div>

            <ul className="mt-3 divide-y divide-[#1F2A5A]/15">
              {data.top_roommates.slice(0, 3).map((match) => (
                <li
                  key={match.student.id}
                  className="py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-sm text-[#1F2A5A]">
                      {match.student.name}{' '}
                      <span className="font-mono-code text-xs font-normal text-[#465078]">
                        · Yr {match.student.year} · {match.student.branch}
                      </span>
                    </p>
                    <p className="text-xs text-[#465078] mt-0.5">{match.explanation}</p>
                  </div>
                  <span className="font-mono-code text-base font-bold text-[#295234] shrink-0">
                    {match.score}% est.
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Right Column (5 cols): Brass Room Key Tag + Warden Announcements + Dispute Filing */}
        <div className="lg:col-span-5 space-y-6">
          {allotted_room && (
            <RoomKeyTag
              roomNumber={allotted_room.number}
              blockName={allotted_room.block_name}
              blockCode={allotted_room.block_code}
              floor={allotted_room.floor}
              capacity={allotted_room.capacity}
              occupied={allotted_room.occupants.length}
              ac={allotted_room.ac}
              tags={allotted_room.tags}
              occupants={data.roommates.map((rm) => ({
                id: rm.id,
                name: rm.name,
                year: rm.year,
                branch: rm.branch,
              }))}
            />
          )}

          {/* Warden Announcements */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5">
            <h2 className="font-display text-xl text-[#1F2A5A] border-b border-[#1F2A5A]/25 pb-2">
              Hostel Office Announcements
            </h2>
            <ul className="mt-3 space-y-4">
              {data.announcements.map((ann) => (
                <li key={ann.id} className="pb-3 border-b last:border-b-0 border-[#1F2A5A]/15">
                  <p className="font-mono-code text-[11px] text-[#465078]">
                    {ann.date} · {ann.issued_by}
                  </p>
                  <p className="font-bold text-sm text-[#1F2A5A] mt-0.5">{ann.title}</p>
                  <p className="text-xs text-[#465078] mt-1 leading-relaxed">{ann.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Warden Desk Issue / Dispute Log */}
          <section className="bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-[#1F2A5A]">
                  Warden Office Requests &amp; Disputes
                </h3>
                <p className="text-xs text-[#465078]">
                  {data.disputes.length} logged ticket(s) on your folio.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDisputeOpen((v) => !v)}
                className="px-3 py-1.5 text-xs font-bold bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] whitespace-nowrap"
              >
                {disputeOpen ? 'Close Form' : 'Log an Issue'}
              </button>
            </div>

            {disputeOpen && (
              <form onSubmit={handleSubmitDispute} className="mt-4 space-y-3 border-t border-[#1F2A5A]/25 pt-3">
                <label className="block">
                  <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Category *</span>
                  <select
                    value={disputeCategory}
                    onChange={(e) => setDisputeCategory(e.target.value as Dispute['category'])}
                    className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                  >
                    <option value="allotment">Allotment Review</option>
                    <option value="swap">Room Swap Issue</option>
                    <option value="room_condition">Room Maintenance / AC</option>
                    <option value="policy">Hostel Policy Query</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Subject *</span>
                  <input
                    type="text"
                    required
                    value={disputeSubject}
                    onChange={(e) => setDisputeSubject(e.target.value)}
                    placeholder="e.g., Medical ground floor request"
                    className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-[#1F2A5A] block mb-1">Details *</span>
                  <textarea
                    required
                    rows={3}
                    value={disputeDesc}
                    onChange={(e) => setDisputeDesc(e.target.value)}
                    placeholder="Describe your request clearly for the Block Warden..."
                    className="w-full px-3 py-2 text-sm bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submittingDispute}
                  className="px-4 py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] disabled:opacity-50"
                >
                  {submittingDispute ? 'Logging...' : 'Submit to Warden Register'}
                </button>
              </form>
            )}

            {data.disputes.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-[#1F2A5A]/20 pt-3">
                {data.disputes.map((d) => (
                  <li key={d.id} className="text-xs bg-[#F8F2E4] border border-[#1F2A5A]/40 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#1F2A5A]">{d.subject}</span>
                      <span className="font-mono-code uppercase text-[#465078]">
                        {d.status.replace('_', ' ')}
                      </span>
                    </div>
                    {d.resolution_note && (
                      <p className="mt-1 text-[#295234]">Warden Note: {d.resolution_note}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
