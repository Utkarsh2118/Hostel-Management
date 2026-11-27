import React from 'react';
import type { RoomTag } from '../../../lib/types';

interface RoomKeyTagProps {
  roomNumber: string;
  blockName: string;
  blockCode: string;
  floor: number;
  capacity: number;
  occupied: number;
  ac: boolean;
  tags: RoomTag[];
  occupants?: Array<{ id: string; name: string; year: number; branch: string }>;
  actionSlot?: React.ReactNode;
}

export const RoomKeyTag: React.FC<RoomKeyTagProps> = ({
  roomNumber,
  blockName,
  blockCode,
  floor,
  capacity,
  occupied,
  ac,
  tags,
  occupants,
  actionSlot,
}) => {
  const isFull = occupied >= capacity;
  const openSlots = Math.max(0, capacity - occupied);

  return (
    <div className="bg-[#FBE9A6] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-5 relative">
      {/* Brass Key Ring Eyelet & Stamp Header */}
      <div className="flex items-start justify-between gap-3 border-b-2 border-[#1F2A5A] pb-3">
        <div className="flex items-center gap-3">
          {/* Brass keyhole cutout */}
          <div
            aria-hidden="true"
            className="w-7 h-7 rounded-full bg-[#F1E6CF] border-2 border-[#1F2A5A] flex items-center justify-center shrink-0"
          >
            <div className="w-2.5 h-2.5 rounded-full border border-[#1F2A5A] bg-[#C2552D]/30" />
          </div>
          <div>
            <p className="font-mono-code text-[11px] text-[#465078] tracking-wider uppercase">
              HOSTEL KEY TAG · {blockCode}
            </p>
            <h3 className="font-mono-code text-2xl font-bold text-[#1F2A5A] leading-tight">
              {blockCode}-{roomNumber}
            </h3>
          </div>
        </div>

        <span
          className={[
            'font-mono-code text-xs font-bold px-2 py-0.5 border-2 rounded-[2px] whitespace-nowrap',
            isFull
              ? 'border-[#B3261E] text-[#B3261E] bg-[#F8F2E4]'
              : 'border-[#295234] text-[#295234] bg-[#F8F2E4]',
          ].join(' ')}
        >
          {isFull ? 'FULL' : `${openSlots} OPEN`}
        </span>
      </div>

      {/* Key Specs Definition List */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        <div>
          <dt className="text-xs text-[#465078]">Hostel Block</dt>
          <dd className="font-semibold text-[#1F2A5A]">{blockName}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#465078]">Floor</dt>
          <dd className="font-mono-code font-bold text-[#1F2A5A]">Floor {floor}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#465078]">Occupancy</dt>
          <dd className="font-mono-code font-bold text-[#1F2A5A]">
            {occupied} / {capacity} beds
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[#465078]">Cooling</dt>
          <dd className="font-semibold text-[#1F2A5A]">
            {ac ? 'Split AC Room' : 'Non-AC Ventilated'}
          </dd>
        </div>
      </dl>

      {/* Clean unboxed inline tags */}
      <div className="mt-4 pt-3 border-t border-[#1F2A5A]/25 text-xs text-[#1F2A5A]">
        <span className="text-[#465078]">Attributes: </span>
        {tags.length > 0 ? (
          <span className="font-mono-code">
            {tags.map((t) => t.replace('_', ' ')).join(' · ')}
          </span>
        ) : (
          <span className="text-[#465078]">Standard corridor room</span>
        )}
      </div>

      {/* Current Residents if provided */}
      {occupants && occupants.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#1F2A5A]/25">
          <p className="text-xs text-[#465078] mb-1">Current Residents</p>
          <ul className="space-y-1 text-xs text-[#1F2A5A]">
            {occupants.map((occ) => (
              <li key={occ.id} className="flex items-center justify-between gap-2">
                <span className="font-semibold">{occ.name}</span>
                <span className="font-mono-code text-[#465078]">
                  Yr {occ.year} · {occ.branch}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actionSlot && <div className="mt-4 pt-3 border-t-2 border-[#1F2A5A]">{actionSlot}</div>}
    </div>
  );
};
