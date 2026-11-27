import React, { useMemo, useState } from 'react';
import type { AllotmentAssignment } from '../../../lib/types';
import { Stamp } from '../ui/Stamp';

interface AllotmentRegisterProps {
  title: string;
  seed: string;
  entries: AllotmentAssignment[];
  highlightStudentId?: string | null;
  pageSize?: number;
}

export const AllotmentRegister: React.FC<AllotmentRegisterProps> = ({
  title,
  seed,
  entries,
  highlightStudentId = null,
  pageSize = 15,
}) => {
  const [search, setSearch] = useState('');
  const [blockFilter, setBlockFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'priority' | 'rank' | 'room'>('priority');
  const [page, setPage] = useState(1);

  const uniqueBlocks = useMemo(() => {
    const names = new Set(entries.map((e) => e.block_name));
    return Array.from(names).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (blockFilter !== 'all' && e.block_name !== blockFilter) return false;
      if (!q) return true;
      return (
        e.student_name.toLowerCase().includes(q) ||
        e.student_code.toLowerCase().includes(q) ||
        e.room_number.toLowerCase().includes(q) ||
        e.block_name.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      if (sortBy === 'rank') {
        return (a.preference_rank ?? 99) - (b.preference_rank ?? 99);
      }
      if (sortBy === 'room') {
        return a.block_name.localeCompare(b.block_name) || a.room_number.localeCompare(b.room_number);
      }
      return b.priority_score - a.priority_score;
    });

    return list;
  }, [entries, search, blockFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink">
      {/* Register Binding Header */}
      <div className="p-4 sm:p-5 border-b-2 border-[#1F2A5A] flex flex-wrap items-center justify-between gap-4 bg-[#F1E6CF]">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            WARDEN&apos;S OFFICIAL ALLOTMENT REGISTER · SEED: {seed}
          </p>
          <h3 className="font-display text-2xl text-[#1F2A5A] mt-0.5">{title}</h3>
        </div>
        <Stamp label="ALLOTTED" variant="green" size="sm" />
      </div>

      {/* Controls Strip */}
      <div className="p-4 border-b border-[#1F2A5A]/30 flex flex-wrap items-center gap-3 bg-[#F8F2E4]">
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">Search register by student, ID, or room</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search student name, ID, or room..."
            className="w-full px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A] placeholder:text-[#465078]"
          />
        </label>

        <select
          aria-label="Filter by hostel block"
          value={blockFilter}
          onChange={(e) => {
            setBlockFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A]"
        >
          <option value="all">All Blocks</option>
          {uniqueBlocks.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort register rows"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'priority' | 'rank' | 'room')}
          className="px-3 py-2 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A]"
        >
          <option value="priority">Sort: Priority Score</option>
          <option value="rank">Sort: Preference Rank</option>
          <option value="room">Sort: Block &amp; Room</option>
        </select>
      </div>

      {/* Ruled Ledger Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-[#1F2A5A] bg-[#F1E6CF] text-xs font-mono-code text-[#1F2A5A]">
              <th className="py-3 px-4 font-bold">Student ID &amp; Name</th>
              <th className="py-3 px-4 font-bold">Allotted Room</th>
              <th className="py-3 px-4 font-bold">Pref. Rank</th>
              <th className="py-3 px-4 font-bold">Priority</th>
              <th className="py-3 px-4 font-bold">Status &amp; Note</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 px-4 text-center text-[#465078]">
                  No allotment register entries match your filter.
                </td>
              </tr>
            ) : (
              pageItems.map((row) => {
                const isMe = row.student_id === highlightStudentId;
                return (
                  <tr
                    key={row.student_id}
                    className={[
                      'border-b border-[#1F2A5A]/20 transition-colors',
                      isMe ? 'bg-[#FBE9A6]' : 'hover:bg-[#F1E6CF]/60',
                    ].join(' ')}
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#1F2A5A]">
                        {row.student_name} {isMe ? '(You)' : ''}
                      </div>
                      <div className="font-mono-code text-xs text-[#465078]">
                        {row.student_code}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono-code font-bold text-[#1F2A5A]">
                        {row.room_number}
                      </div>
                      <div className="text-xs text-[#465078]">
                        {row.block_name} · Fl {row.floor}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono-code font-bold text-[#1F2A5A]">
                      {row.preference_rank ? `#${row.preference_rank}` : 'Paired'}
                    </td>
                    <td className="py-3 px-4 font-mono-code text-[#1F2A5A]">
                      {row.priority_score.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <span className="font-mono-code text-xs font-bold text-[#295234]">
                        ALLOTTED
                      </span>
                      <span className="text-xs text-[#465078] block leading-snug mt-0.5">
                        {row.explanation}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t-2 border-[#1F2A5A] bg-[#F1E6CF] flex flex-wrap items-center justify-between gap-2 text-xs font-mono-code text-[#1F2A5A]">
        <span>
          Showing {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
          {Math.min(safePage * pageSize, filtered.length)} of {filtered.length} entries
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
