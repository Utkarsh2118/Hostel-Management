import React, { useState } from 'react';
import type { RoomTag } from '../../../lib/types';

export interface MapRoomItem {
  id: string;
  block_id: string;
  block_name: string;
  block_code: string;
  floor: number;
  number: string;
  capacity: 1 | 2 | 3 | 4;
  ac: boolean;
  tags: RoomTag[];
  occupants: string[];
  occupant_details?: Array<{ id: string; name: string; year: number; branch: string }>;
}

interface RoomMapProps {
  rooms: MapRoomItem[];
  blockName: string;
  floor: number;
  selectedRoomId: string | null;
  highlightedRoomIds?: Set<string>;
  onSelectRoom: (room: MapRoomItem) => void;
}

export const RoomMap: React.FC<RoomMapProps> = ({
  rooms,
  blockName,
  floor,
  selectedRoomId,
  highlightedRoomIds,
  onSelectRoom,
}) => {
  const [hoveredRoom, setHoveredRoom] = useState<MapRoomItem | null>(null);

  // Split floor rooms across North Wing (top row) and South Wing (bottom row) flanking the corridor
  const sorted = [...rooms].sort((a, b) => a.number.localeCompare(b.number));
  const splitIdx = Math.ceil(sorted.length / 2);
  const topWing = sorted.slice(0, splitIdx);
  const bottomWing = sorted.slice(splitIdx);

  const cols = Math.max(topWing.length, bottomWing.length, 4);
  const roomW = 136;
  const roomH = 92;
  const gapX = 16;
  const padX = 28;
  const corridorH = 54;
  const topY = 58;
  const bottomY = topY + roomH + corridorH;
  const svgWidth = Math.max(660, padX * 2 + cols * roomW + (cols - 1) * gapX);
  const svgHeight = bottomY + roomH + 46;

  const renderRoomBox = (room: MapRoomItem, x: number, y: number) => {
    const occCount = room.occupants.length;
    const isFull = occCount >= room.capacity;
    const isVacant = occCount === 0;
    const isSelected = room.id === selectedRoomId;
    const isHighlighted = highlightedRoomIds?.has(room.id) ?? false;

    const fillColor = isSelected
      ? '#FBE9A6'
      : isFull
        ? '#E9DEC7'
        : isVacant
          ? '#CFE0D2'
          : '#DFECE1';

    const statusText = isFull
      ? 'FULL'
      : isVacant
        ? 'OPEN'
        : `${room.capacity - occCount} LEFT`;

    return (
      <g
        key={room.id}
        transform={`translate(${x}, ${y})`}
        role="button"
        tabIndex={0}
        aria-label={`Room ${room.block_code}-${room.number}, Floor ${room.floor}, ${occCount} of ${room.capacity} occupied, ${room.ac ? 'AC' : 'Non-AC'}, ${statusText}`}
        onClick={() => onSelectRoom(room)}
        onMouseEnter={() => setHoveredRoom(room)}
        onMouseLeave={() => setHoveredRoom((prev) => (prev?.id === room.id ? null : prev))}
        onFocus={() => setHoveredRoom(room)}
        onBlur={() => setHoveredRoom((prev) => (prev?.id === room.id ? null : prev))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectRoom(room);
          }
        }}
        className="cursor-pointer focus:outline-none group"
      >
        {/* Subtle hard offset shadow for selected room */}
        {isSelected && (
          <rect
            x={4}
            y={4}
            width={roomW}
            height={roomH}
            fill="#1F2A5A"
            rx={2}
          />
        )}

        {/* Base room rectangle */}
        <rect
          x={0}
          y={0}
          width={roomW}
          height={roomH}
          fill={fillColor}
          stroke={isSelected ? '#C2552D' : isHighlighted ? '#C2552D' : '#1F2A5A'}
          strokeWidth={isSelected ? 3.5 : isHighlighted ? 2.5 : 2}
          rx={2}
        />

        {/* Diagonal architectural hatching for occupied rooms */}
        {occCount > 0 && (
          <rect
            x={2}
            y={2}
            width={roomW - 4}
            height={roomH - 4}
            fill={isFull ? 'url(#hatch-full)' : 'url(#hatch-partial)'}
            pointerEvents="none"
          />
        )}

        {/* Door swing notch facing corridor */}
        <path
          d={
            y === topY
              ? `M ${roomW / 2 - 12} ${roomH} Q ${roomW / 2 - 12} ${roomH - 12} ${roomW / 2} ${roomH - 12}`
              : `M ${roomW / 2 - 12} 0 Q ${roomW / 2 - 12} 12 ${roomW / 2} 12`
          }
          fill="none"
          stroke="#1F2A5A"
          strokeWidth={1.2}
          strokeDasharray="2 2"
        />

        {/* Room number in Courier Prime */}
        <text
          x={10}
          y={24}
          fill="#1F2A5A"
          fontFamily="'Courier Prime', monospace"
          fontWeight={700}
          fontSize={16}
        >
          {room.number}
        </text>

        {/* AC indicator (clear text, never color-only) */}
        <text
          x={roomW - 10}
          y={23}
          textAnchor="end"
          fill={room.ac ? '#1F2A5A' : '#465078'}
          fontFamily="'Courier Prime', monospace"
          fontWeight={700}
          fontSize={11}
        >
          {room.ac ? 'AC' : 'NON-AC'}
        </text>

        {/* Occupancy ratio */}
        <text
          x={10}
          y={46}
          fill="#1F2A5A"
          fontFamily="'Courier Prime', monospace"
          fontSize={12}
        >
          Beds: {occCount}/{room.capacity}
        </text>

        {/* Primary tag shorthand if present */}
        {room.tags.length > 0 && (
          <text
            x={10}
            y={64}
            fill="#465078"
            fontFamily="'Mukta', sans-serif"
            fontSize={11}
          >
            {room.tags.slice(0, 2).map((t) => t.replace('_', ' ')).join(' · ')}
          </text>
        )}

        {/* FULL red rubber stamp or OPEN green tag */}
        {isFull ? (
          <g transform={`translate(${roomW - 56}, ${roomH - 28}) rotate(-6)`}>
            <rect
              x={0}
              y={0}
              width={46}
              height={18}
              fill="#F8F2E4"
              stroke="#B3261E"
              strokeWidth={1.6}
              rx={1}
            />
            <text
              x={23}
              y={13}
              textAnchor="middle"
              fill="#B3261E"
              fontFamily="'Courier Prime', monospace"
              fontWeight={700}
              fontSize={11}
            >
              FULL
            </text>
          </g>
        ) : (
          <text
            x={roomW - 10}
            y={roomH - 11}
            textAnchor="end"
            fill="#295234"
            fontFamily="'Courier Prime', monospace"
            fontWeight={700}
            fontSize={11}
          >
            {statusText}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="border-2 border-[#1F2A5A] rounded-[2px] blueprint-grid shadow-ink">
      {/* Blueprint Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b-2 border-[#1F2A5A] bg-[#F8F2E4]">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            ARCHITECTURAL FLOOR SHEET · SCALE 1:100
          </p>
          <h3 className="text-lg font-bold text-[#1F2A5A]">
            {blockName} — Floor {floor}
          </h3>
        </div>

        {/* Accessible Non-Color-Only Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono-code text-[#1F2A5A]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 bg-[#CFE0D2] border border-[#1F2A5A]" />
            Open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-3 border border-[#1F2A5A]"
              style={{
                background:
                  'repeating-linear-gradient(45deg, #DFECE1, #DFECE1 3px, rgba(31,42,90,0.22) 3px, rgba(31,42,90,0.22) 4px)',
              }}
            />
            Partial
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block px-1 border border-[#B3261E] text-[#B3261E] font-bold text-[10px]">
              FULL
            </span>
            Occupied
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 bg-[#FBE9A6] border-2 border-[#C2552D]" />
            Selected
          </span>
        </div>
      </div>

      {/* Scrollable Blueprint Canvas */}
      <div className="overflow-x-auto p-4">
        {sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#465078]">
            No rooms match the active filters on Floor {floor} of {blockName}.
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full min-w-[620px] h-auto block"
            role="img"
            aria-label={`Interactive floor plan for ${blockName} Floor ${floor}`}
          >
            <defs>
              <pattern
                id="hatch-partial"
                width="8"
                height="8"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <line x1="0" y1="0" x2="0" y2="8" stroke="#1F2A5A" strokeOpacity="0.16" strokeWidth="1" />
              </pattern>
              <pattern
                id="hatch-full"
                width="7"
                height="7"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <line x1="0" y1="0" x2="0" y2="7" stroke="#1F2A5A" strokeOpacity="0.28" strokeWidth="1.2" />
              </pattern>
            </defs>

            {/* Outer Building Perimeter */}
            <rect
              x={12}
              y={20}
              width={svgWidth - 24}
              height={svgHeight - 36}
              fill="none"
              stroke="#1F2A5A"
              strokeWidth={2}
              strokeDasharray="6 3"
            />

            {/* North Wing Label */}
            <text
              x={padX}
              y={42}
              fill="#465078"
              fontFamily="'Courier Prime', monospace"
              fontSize={11}
              fontWeight={700}
            >
              NORTH WING CORRIDOR ↑
            </text>

            {/* Top Wing Rooms */}
            {topWing.map((room, idx) =>
              renderRoomBox(room, padX + idx * (roomW + gapX), topY)
            )}

            {/* Central Hallway & Stairwell */}
            <line
              x1={padX}
              y1={topY + roomH + 14}
              x2={svgWidth - padX}
              y2={topY + roomH + 14}
              stroke="#1F2A5A"
              strokeOpacity={0.3}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text
              x={svgWidth / 2}
              y={topY + roomH + 31}
              textAnchor="middle"
              fill="#465078"
              fontFamily="'Courier Prime', monospace"
              fontSize={12}
              letterSpacing={2}
            >
              CENTRAL WALKWAY · STAIRCASE &amp; WATER COOLER
            </text>
            <line
              x1={padX}
              y1={bottomY - 14}
              x2={svgWidth - padX}
              y2={bottomY - 14}
              stroke="#1F2A5A"
              strokeOpacity={0.3}
              strokeWidth={1}
              strokeDasharray="4 4"
            />

            {/* Bottom Wing Rooms */}
            {bottomWing.map((room, idx) =>
              renderRoomBox(room, padX + idx * (roomW + gapX), bottomY)
            )}

            {/* South Wing Label */}
            <text
              x={padX}
              y={svgHeight - 24}
              fill="#465078"
              fontFamily="'Courier Prime', monospace"
              fontSize={11}
              fontWeight={700}
            >
              SOUTH COURTYARD SIDE ↓
            </text>
          </svg>
        )}
      </div>

      {/* Accessible Hover / Keyboard Focus Inspector Bar */}
      <div
        className="px-4 py-2.5 border-t border-[#1F2A5A]/30 bg-[#F8F2E4] text-xs font-mono-code text-[#1F2A5A] flex flex-wrap items-center justify-between gap-2"
        aria-live="polite"
      >
        {hoveredRoom ? (
          <>
            <span>
              <strong>
                {hoveredRoom.block_code}-{hoveredRoom.number}
              </strong>{' '}
              · Floor {hoveredRoom.floor} · {hoveredRoom.occupants.length}/{hoveredRoom.capacity}{' '}
              occupied · {hoveredRoom.ac ? 'AC' : 'Non-AC'}
              {hoveredRoom.tags.length > 0 ? ` · ${hoveredRoom.tags.join(', ')}` : ''}
            </span>
            <span className="text-[#465078]">Press Enter or click to inspect key tag</span>
          </>
        ) : (
          <span className="text-[#465078]">
            Hover or Tab onto any room box to inspect capacity, AC, and tags. Click to open its brass key tag.
          </span>
        )}
      </div>
    </div>
  );
};
