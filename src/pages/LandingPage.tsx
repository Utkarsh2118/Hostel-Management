import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  AiStatusInfo,
  AllotmentAssignment,
  Announcement,
  SessionUser,
} from '../../lib/types';
import { ROLE_DASHBOARD_PATH } from '../../lib/auth/roles';
import { Stamp } from '../components/ui/Stamp';

interface OverviewResponse {
  announcements: Announcement[];
  blocks: Array<{
    id: string;
    name: string;
    code: string;
    gender_type: 'boys' | 'girls';
    floors: number;
    has_mess_nearby: boolean;
    warden_name: string;
    room_count: number;
    capacity: number;
    occupied: number;
    available_rooms: number;
  }>;
  totals: {
    students: number;
    rooms: number;
    capacity: number;
    occupied: number;
    vacant_beds: number;
    open_swaps: number;
    pending_proposals: number;
  };
  active_run: {
    id: string;
    label: string;
    seed: string;
    created_at: string;
    stats: {
      allotted_count: number;
      total_students: number;
      first_choice_pct: number;
      top_three_pct: number;
      avg_preference_rank: number;
      runtime_ms: number;
    };
  } | null;
  sample_allotments: AllotmentAssignment[];
  sample_swaps: Array<{
    id: string;
    student_name: string;
    student_code: string;
    current_room: string;
    note: string;
    status: string;
    created_at: string;
  }>;
  ai_status: AiStatusInfo;
}

interface LandingPageProps {
  sessionUser: SessionUser | null;
  onNavigate: (path: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  sessionUser,
  onNavigate,
}) => {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<OverviewResponse>('/api/overview')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load notice board.');
      });
    return () => {
      active = false;
    };
  }, []);

  const leadAnnouncement = data?.announcements[0];
  const sampleSwap = data?.sample_swaps[0];

  return (
    <div className="space-y-8">
      {/* Editorial Notice-Board Masthead (Asymmetric, NOT a centered hero) */}
      <header className="border-b-2 border-[#1F2A5A] pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="max-w-2xl">
          <p className="font-mono-code text-xs text-[#465078] tracking-wider uppercase">
            VIDYAVIHAR UNIVERSITY · OFFICE OF THE CHIEF WARDEN · NOTICE BOARD
          </p>
          <h1 className="font-display text-4xl sm:text-5xl text-[#1F2A5A] leading-[1.08] mt-2">
            Hostel Room Allotment &amp; Exchange Register
          </h1>
          <p className="mt-3 text-base text-[#1F2A5A] leading-relaxed">
            Submit ranked room preferences, verify deterministic allotment results, explore live
            Bhavan floor blueprints, and execute multi-way room swaps only when every resident consents.
          </p>
        </div>

        {/* Handwritten Margin Instruction + Authenticated Entry Points */}
        <div className="flex flex-col items-start lg:items-end gap-3 shrink-0">
          <p className="font-hand text-2xl text-[#C2552D] leading-none">
            Apna room dhundo →
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {sessionUser ? (
              <button
                type="button"
                onClick={() => onNavigate(ROLE_DASHBOARD_PATH[sessionUser.role])}
                className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none inline-flex items-center gap-2 whitespace-nowrap"
              >
                Open {sessionUser.role} Dashboard
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate('/login')}
                  className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none inline-flex items-center gap-2 whitespace-nowrap"
                >
                  Sign In to Portal
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/register')}
                  className="px-4 py-2.5 text-sm font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] whitespace-nowrap"
                >
                  Student Registration
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-[#F8F2E4] border-2 border-[#B3261E] text-sm text-[#B3261E]">
          {error}
        </div>
      )}

      {/* Active Notice-Board Asymmetric Composition */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Main Board Column (7 cols): Pinned Official Announcement + Sample Allotment Slip */}
        <div className="lg:col-span-7 space-y-7">
          {/* Pinned Chief Warden Circular */}
          <article className="relative bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6">
            <div
              aria-hidden="true"
              className="tape-strip w-20 h-4 absolute -top-2 left-8"
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono-code text-xs text-[#B3261E] font-bold">
                  CIRCULAR NO. VV/HO/2026-14 ·{' '}
                  {leadAnnouncement?.date ?? '2026-11-20'}
                </p>
                <h2 className="text-xl sm:text-2xl font-bold text-[#1F2A5A] mt-1">
                  {leadAnnouncement?.title ?? 'Autumn 2026 Round 1 Allotment Published'}
                </h2>
              </div>
              <Stamp label="OFFICIAL" variant="red" size="sm" animate />
            </div>

            <p className="mt-3 text-sm sm:text-base text-[#1F2A5A] leading-relaxed">
              {leadAnnouncement?.body ??
                'Allotment results generated under a verifiable public seed are now posted in the register. Students may inspect rooms on the floor blueprint or pin a swap chit.'}
            </p>

            {data?.active_run && (
              <div className="mt-5 pt-4 border-t border-[#1F2A5A]/25 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono-code text-[#1F2A5A]">
                <span>
                  Seed: <strong>{data.active_run.seed}</strong>
                </span>
                <span>
                  Allotted:{' '}
                  <strong>
                    {data.active_run.stats.allotted_count}/{data.active_run.stats.total_students}
                  </strong>
                </span>
                <span>
                  Top-3 Choice: <strong>{data.active_run.stats.top_three_pct}%</strong>
                </span>
                <span>
                  Avg Rank: <strong>#{data.active_run.stats.avg_preference_rank}</strong>
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
              <button
                type="button"
                onClick={() => onNavigate('/rooms')}
                className="font-bold text-[#C2552D] hover:underline"
              >
                Inspect Floor Blueprints →
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/student/allotment')}
                className="font-semibold text-[#1F2A5A] hover:underline"
              >
                Check Allotment Slip →
              </button>
            </div>
          </article>

          {/* Sample Allotment Register Excerpt (Real Live Data) */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
            <div className="px-5 py-3.5 border-b-2 border-[#1F2A5A] bg-[#F1E6CF] flex items-center justify-between gap-3">
              <div>
                <p className="font-mono-code text-[11px] text-[#465078]">
                  LIVE REGISTER EXTRACT · ROUND 1
                </p>
                <h2 className="text-lg font-bold text-[#1F2A5A]">
                  Recent Verified Allotments
                </h2>
              </div>
              <Stamp label="ALLOTTED" variant="green" size="sm" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[#1F2A5A]/30 text-xs font-mono-code text-[#465078]">
                    <th className="py-2.5 px-4">Student</th>
                    <th className="py-2.5 px-4">Room</th>
                    <th className="py-2.5 px-4">Choice</th>
                    <th className="py-2.5 px-4">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.sample_allotments ?? []).map((row) => (
                    <tr key={row.student_id} className="border-b border-[#1F2A5A]/15">
                      <td className="py-2.5 px-4">
                        <span className="font-semibold text-[#1F2A5A] block">
                          {row.student_name}
                        </span>
                        <span className="font-mono-code text-xs text-[#465078]">
                          {row.student_code}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono-code font-bold text-[#1F2A5A]">
                        {row.block_name.split(' ')[0]} {row.room_number}
                      </td>
                      <td className="py-2.5 px-4 font-mono-code text-[#295234] font-bold">
                        {row.preference_rank ? `#${row.preference_rank}` : 'Paired'}
                      </td>
                      <td className="py-2.5 px-4 font-mono-code text-[#465078]">
                        {row.priority_score}
                      </td>
                    </tr>
                  ))}
                  {!data && (
                    <tr>
                      <td colSpan={4} className="py-6 px-4 text-center text-xs text-[#465078]">
                        Loading allotment register...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Pinned Column (5 cols): Sample Swap Notice Chit + 4-Bhavan Architectural Schematic */}
        <div className="lg:col-span-5 space-y-7">
          {/* Pinned Swap Chit */}
          <article
            style={{ transform: 'rotate(-0.8deg)' }}
            className="relative bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5"
          >
            <div
              aria-hidden="true"
              className="tape-strip w-16 h-3.5 absolute -top-2 right-10"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono-code text-xs font-bold text-[#1F2A5A]">
                PINNED SWAP CHIT · {data?.totals.open_swaps ?? 0} ACTIVE
              </p>
              <span className="font-hand text-sm text-[#B3261E]">
                2, 3 &amp; 4-way swaps
              </span>
            </div>

            {sampleSwap ? (
              <div className="mt-3 space-y-2">
                <p className="text-base font-bold text-[#1F2A5A]">
                  {sampleSwap.student_name}{' '}
                  <span className="font-mono-code text-xs font-normal text-[#465078]">
                    ({sampleSwap.current_room})
                  </span>
                </p>
                <p className="text-sm text-[#1F2A5A] leading-snug">
                  &ldquo;{sampleSwap.note}&rdquo;
                </p>
                <p className="font-mono-code text-xs text-[#465078]">
                  Status: {sampleSwap.status.toUpperCase()} ·{' '}
                  {data?.totals.pending_proposals ?? 0} cycle proposal(s) awaiting consent
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[#465078]">
                Loading live swap notices...
              </p>
            )}

            <div className="mt-4 pt-3 border-t border-[#1F2A5A]/30 flex items-center justify-between">
              <button
                type="button"
                onClick={() => onNavigate('/swaps')}
                className="text-sm font-bold text-[#1F2A5A] hover:text-[#C2552D] hover:underline"
              >
                Open Swap Notice Board →
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/roommates')}
                className="text-xs font-semibold text-[#465078] hover:text-[#1F2A5A] hover:underline"
              >
                Find Roommates
              </button>
            </div>
          </article>

          {/* Compact Campus Bhavan Schematic + Live Occupancy Ledger */}
          <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5">
            <div className="flex items-baseline justify-between gap-2 border-b border-[#1F2A5A]/30 pb-2.5">
              <h2 className="font-display text-xl text-[#1F2A5A]">
                Campus Bhavan Directory
              </h2>
              <span className="font-mono-code text-xs text-[#465078]">
                {data?.totals.rooms ?? 120} Rooms
              </span>
            </div>

            {/* Minimal Hand-Drawn Bhavan Block Illustration SVG */}
            <svg
              viewBox="0 0 360 110"
              className="w-full h-auto mt-3 border border-[#1F2A5A]/25 blueprint-grid rounded-[2px]"
              role="img"
              aria-label="Schematic of four VidyaVihar hostel blocks around the Central Mess"
            >
              <rect x="14" y="14" width="102" height="36" fill="#CFE0D2" stroke="#1F2A5A" strokeWidth="1.8" />
              <text x="65" y="30" textAnchor="middle" fill="#1F2A5A" fontFamily="'Courier Prime', monospace" fontSize="10" fontWeight="700">NILGIRI (NB)</text>
              <text x="65" y="43" textAnchor="middle" fill="#465078" fontFamily="'Mukta', sans-serif" fontSize="9">Boys · Near Mess</text>

              <rect x="244" y="14" width="102" height="36" fill="#FBE9A6" stroke="#1F2A5A" strokeWidth="1.8" />
              <text x="295" y="30" textAnchor="middle" fill="#1F2A5A" fontFamily="'Courier Prime', monospace" fontSize="10" fontWeight="700">KAVERI (KB)</text>
              <text x="295" y="43" textAnchor="middle" fill="#465078" fontFamily="'Mukta', sans-serif" fontSize="9">Girls · Near Mess</text>

              <rect x="132" y="36" width="96" height="36" fill="#F8F2E4" stroke="#C2552D" strokeWidth="1.6" strokeDasharray="3 2" />
              <text x="180" y="53" textAnchor="middle" fill="#C2552D" fontFamily="'Courier Prime', monospace" fontSize="10" fontWeight="700">CENTRAL MESS</text>
              <text x="180" y="65" textAnchor="middle" fill="#465078" fontFamily="'Mukta', sans-serif" fontSize="8.5">07:30 – 21:45</text>

              <rect x="14" y="64" width="102" height="34" fill="#F1E6CF" stroke="#1F2A5A" strokeWidth="1.8" />
              <text x="65" y="79" textAnchor="middle" fill="#1F2A5A" fontFamily="'Courier Prime', monospace" fontSize="10" fontWeight="700">VINDHYA (VB)</text>
              <text x="65" y="91" textAnchor="middle" fill="#465078" fontFamily="'Mukta', sans-serif" fontSize="9">Boys · Oval Wing</text>

              <rect x="244" y="64" width="102" height="34" fill="#F1E6CF" stroke="#1F2A5A" strokeWidth="1.8" />
              <text x="295" y="79" textAnchor="middle" fill="#1F2A5A" fontFamily="'Courier Prime', monospace" fontSize="10" fontWeight="700">NARMADA (NM)</text>
              <text x="295" y="91" textAnchor="middle" fill="#465078" fontFamily="'Mukta', sans-serif" fontSize="9">Girls · Library Wing</text>
            </svg>

            <ul className="mt-4 divide-y divide-[#1F2A5A]/20 text-sm">
              {(data?.blocks ?? []).map((b) => (
                <li key={b.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-[#1F2A5A]">{b.name}</span>
                    <span className="text-xs text-[#465078] block">
                      {b.gender_type === 'boys' ? 'Boys' : 'Girls'} · {b.floors} floors ·{' '}
                      {b.warden_name}
                    </span>
                  </div>
                  <div className="text-right font-mono-code shrink-0">
                    <span className="text-xs font-bold text-[#1F2A5A] block">
                      {b.occupied}/{b.capacity} beds
                    </span>
                    <span className="text-[11px] text-[#295234]">
                      {b.available_rooms} open rms
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Compact Policy Desk Note */}
          <div className="border-t-2 border-[#1F2A5A] pt-4 flex items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-bold text-[#1F2A5A]">Questions about mess, curfew, or visitors?</p>
              <p className="text-xs text-[#465078]">
                Grounded strictly in the official VidyaVihar Hostel Manual.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/assistant')}
              className="px-3.5 py-2 text-xs font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#FBE9A6] whitespace-nowrap shrink-0"
            >
              Ask Info Desk
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
