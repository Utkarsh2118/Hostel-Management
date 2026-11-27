import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { AiStatusInfo, Block, NaturalLanguageRoomFilter, RoomTag } from '../../lib/types';
import { RoomMap, type MapRoomItem } from '../components/rooms/RoomMap';
import { RoomKeyTag } from '../components/rooms/RoomKeyTag';
import { AiStatusBadge } from '../components/ui/AiStatusBadge';

interface RoomsApiResponse {
  rooms: MapRoomItem[];
  blocks: Block[];
}

interface NlSearchResponse {
  query: string;
  extracted_filter: NaturalLanguageRoomFilter;
  provider: 'gemini' | 'groq' | 'offline';
  cached: boolean;
  ai_status: AiStatusInfo;
  matches: Array<{
    room: MapRoomItem;
    score: number;
    explanation: string;
  }>;
}

const ALL_TAGS: RoomTag[] = ['quiet', 'near_mess', 'near_stairs', 'corner', 'balcony'];

interface RoomsPageProps {
  onNavigate: (path: string) => void;
  onToast: (tone: 'success' | 'error' | 'info', text: string) => void;
  aiStatus: AiStatusInfo | null;
  onAiStatusUpdate: (status: AiStatusInfo) => void;
}

export const RoomsPage: React.FC<RoomsPageProps> = ({
  onNavigate,
  onToast,
  aiStatus,
  onAiStatusUpdate,
}) => {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [rooms, setRooms] = useState<MapRoomItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Structural filters
  const [selectedBlockId, setSelectedBlockId] = useState<string>('blk-nilgiri');
  const [selectedFloor, setSelectedFloor] = useState<number>(1);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [acFilter, setAcFilter] = useState<'all' | 'ac' | 'non_ac'>('all');
  const [capacityFilter, setCapacityFilter] = useState<'all' | '1' | '2' | '3' | '4'>('all');
  const [selectedTags, setSelectedTags] = useState<RoomTag[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  // Natural-language AI room search
  const [nlQuery, setNlQuery] = useState('');
  const [searchingNl, setSearchingNl] = useState(false);
  const [nlResult, setNlResult] = useState<NlSearchResponse | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<RoomsApiResponse>('/api/rooms')
      .then((res) => {
        if (!active) return;
        setBlocks(res.blocks);
        setRooms(res.rooms);
        if (res.rooms.length > 0 && !selectedRoomId) {
          const firstInBlock = res.rooms.find((r) => r.block_id === 'blk-nilgiri' && r.floor === 1);
          if (firstInBlock) setSelectedRoomId(firstInBlock.id);
        }
      })
      .catch((err) => {
        if (active) {
          onToast('error', err instanceof Error ? err.message : 'Unable to load room inventory.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? blocks[0] ?? null,
    [blocks, selectedBlockId]
  );

  const floorRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (r.block_id !== selectedBlockId) return false;
      if (r.floor !== selectedFloor) return false;
      if (availableOnly && r.occupants.length >= r.capacity) return false;
      if (acFilter === 'ac' && !r.ac) return false;
      if (acFilter === 'non_ac' && r.ac) return false;
      if (capacityFilter !== 'all' && r.capacity !== Number(capacityFilter)) return false;
      if (selectedTags.length > 0 && !selectedTags.every((t) => r.tags.includes(t))) {
        return false;
      }
      return true;
    });
  }, [rooms, selectedBlockId, selectedFloor, availableOnly, acFilter, capacityFilter, selectedTags]);

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? floorRooms[0] ?? null,
    [rooms, selectedRoomId, floorRooms]
  );

  const highlightedRoomIds = useMemo(() => {
    if (!nlResult) return undefined;
    return new Set(nlResult.matches.map((m) => m.room.id));
  }, [nlResult]);

  const toggleTag = (tag: RoomTag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleNlSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nlQuery.trim().length < 2) {
      onToast('error', 'Type a short description like "Quiet room on a high floor near the mess with AC".');
      return;
    }
    setSearchingNl(true);
    try {
      const res = await apiFetch<NlSearchResponse>('/api/rooms/search-nl', {
        method: 'POST',
        body: JSON.stringify({ query: nlQuery.trim() }),
      });
      setNlResult(res);
      onAiStatusUpdate(res.ai_status);
      if (res.matches.length > 0) {
        const first = res.matches[0].room;
        setSelectedBlockId(first.block_id);
        setSelectedFloor(first.floor);
        setSelectedRoomId(first.id);
      } else {
        onToast('info', 'No eligible rooms matched every criterion in that query.');
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Room search failed.');
    } finally {
      setSearchingNl(false);
    }
  };

  return (
    <div className="space-y-7">
      <header className="border-b-2 border-[#1F2A5A] pb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-code text-xs text-[#465078]">
            INTERACTIVE BHAVAN BLUEPRINTS · LIVE OCCUPANCY
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-[#1F2A5A] mt-1">
            Hostel Room Explorer
          </h1>
        </div>
        <AiStatusBadge status={aiStatus} compact />
      </header>

      {/* Natural-Language Room Search Bar */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-4 sm:p-5">
        <form onSubmit={handleNlSearch} className="flex flex-col sm:flex-row gap-3">
          <label className="flex-1">
            <span className="text-xs font-bold text-[#1F2A5A] block mb-1">
              Natural-Language Room Search (AI with deterministic keyword fallback)
            </span>
            <div className="relative">
              <Search
                className="w-4 h-4 text-[#465078] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                placeholder='Try: "Quiet room on a high floor near the mess with AC"'
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] text-[#1F2A5A] placeholder:text-[#465078]"
              />
            </div>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={searchingNl}
              className="px-5 py-2.5 text-sm font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm hover:bg-[#A64420] disabled:opacity-50 whitespace-nowrap"
            >
              {searchingNl ? 'Searching...' : 'Find Rooms'}
            </button>
            {nlResult && (
              <button
                type="button"
                onClick={() => {
                  setNlResult(null);
                  setNlQuery('');
                }}
                className="px-3 py-2.5 text-xs font-bold text-[#1F2A5A] bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {/* Quick example prompts */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#465078]">
          <span>Examples:</span>
          {[
            'Quiet room on a high floor near the mess with AC',
            'Single corner room on 4th floor',
            'Lower floor balcony double room',
          ].map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setNlQuery(ex)}
              className="underline hover:text-[#C2552D] text-left"
            >
              &ldquo;{ex}&rdquo;
            </button>
          ))}
        </div>

        {/* Natural-Language Search Results Strip */}
        {nlResult && (
          <div className="mt-4 pt-4 border-t border-[#1F2A5A]/25 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-code text-[#1F2A5A]">
              <span>
                Parsed filter: block={nlResult.extracted_filter.block ?? 'any'} · floor=
                {nlResult.extracted_filter.floor_min ?? 1}–{nlResult.extracted_filter.floor_max ?? 4}{' '}
                · ac={nlResult.extracted_filter.ac === null ? 'any' : String(nlResult.extracted_filter.ac)}{' '}
                · tags={nlResult.extracted_filter.tags.join(',') || 'any'}
              </span>
              <span className="text-[#465078]">
                {nlResult.matches.length} eligible match(es) via {nlResult.provider}
                {nlResult.cached ? ' (cached)' : ''}
              </span>
            </div>

            {nlResult.matches.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
                {nlResult.matches.slice(0, 9).map(({ room, explanation }) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => {
                      setSelectedBlockId(room.block_id);
                      setSelectedFloor(room.floor);
                      setSelectedRoomId(room.id);
                    }}
                    className={[
                      'text-left p-3 border-2 rounded-[2px] transition-colors',
                      selectedRoomId === room.id
                        ? 'bg-[#FBE9A6] border-[#C2552D]'
                        : 'bg-[#F1E6CF] border-[#1F2A5A] hover:bg-[#FBE9A6]/70',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between font-mono-code text-xs font-bold text-[#1F2A5A]">
                      <span>
                        {room.block_code}-{room.number}
                      </span>
                      <span
                        className={
                          room.occupants.length < room.capacity
                            ? 'text-[#295234]'
                            : 'text-[#B3261E]'
                        }
                      >
                        {room.occupants.length}/{room.capacity} beds
                      </span>
                    </div>
                    <p className="text-xs text-[#465078] mt-1 leading-snug">{explanation}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Block, Floor & Structural Filter Bar */}
      <section className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Block Selector Buttons */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Select Hostel Block">
            {blocks.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => {
                  setSelectedBlockId(block.id);
                  setSelectedFloor(1);
                }}
                className={[
                  'px-3 py-1.5 text-xs font-bold border-2 rounded-[2px] whitespace-nowrap transition-colors',
                  selectedBlockId === block.id
                    ? 'bg-[#1F2A5A] text-[#F8F2E4] border-[#1F2A5A]'
                    : 'bg-[#F1E6CF] text-[#1F2A5A] border-[#1F2A5A] hover:bg-[#FBE9A6]',
                ].join(' ')}
              >
                {block.name} ({block.gender_type === 'boys' ? 'Boys' : 'Girls'})
              </button>
            ))}
          </div>

          {/* Floor Selector */}
          <div className="flex items-center gap-1.5" role="group" aria-label="Select Floor">
            <span className="font-mono-code text-xs text-[#465078] mr-1">Floor:</span>
            {Array.from({ length: activeBlock?.floors ?? 4 }, (_, i) => i + 1).map((fl) => (
              <button
                key={fl}
                type="button"
                onClick={() => setSelectedFloor(fl)}
                className={[
                  'w-8 h-8 font-mono-code text-xs font-bold border-2 border-[#1F2A5A] rounded-[2px]',
                  selectedFloor === fl
                    ? 'bg-[#C2552D] text-[#F8F2E4]'
                    : 'bg-[#F1E6CF] text-[#1F2A5A] hover:bg-[#FBE9A6]',
                ].join(' ')}
              >
                {fl}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-[#1F2A5A]/20 flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-2 font-semibold text-[#1F2A5A] cursor-pointer">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
              className="w-4 h-4 accent-[#C2552D]"
            />
            Open beds only
          </label>

          <select
            aria-label="Filter by AC status"
            value={acFilter}
            onChange={(e) => setAcFilter(e.target.value as 'all' | 'ac' | 'non_ac')}
            className="px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
          >
            <option value="all">AC &amp; Non-AC</option>
            <option value="ac">AC Only</option>
            <option value="non_ac">Non-AC Only</option>
          </select>

          <select
            aria-label="Filter by room capacity"
            value={capacityFilter}
            onChange={(e) =>
              setCapacityFilter(e.target.value as 'all' | '1' | '2' | '3' | '4')
            }
            className="px-2.5 py-1.5 bg-[#F1E6CF] border border-[#1F2A5A] rounded-[2px]"
          >
            <option value="all">Any Capacity</option>
            <option value="1">1-Seater</option>
            <option value="2">2-Seater</option>
            <option value="3">3-Seater</option>
            <option value="4">4-Seater</option>
          </select>

          <div className="flex flex-wrap items-center gap-1.5">
            {ALL_TAGS.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={[
                    'px-2.5 py-1 font-mono-code border border-[#1F2A5A] rounded-[2px] whitespace-nowrap',
                    active
                      ? 'bg-[#FBE9A6] font-bold text-[#1F2A5A]'
                      : 'bg-[#F1E6CF]/70 text-[#465078] hover:text-[#1F2A5A]',
                  ].join(' ')}
                >
                  {tag.replace('_', ' ')}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main Blueprint + Brass Room Key Tag Split */}
      {loading ? (
        <div className="py-16 text-center font-mono-code text-sm text-[#465078]">
          Drawing hostel blueprint...
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-7 items-start">
          <div className="xl:col-span-8">
            <RoomMap
              rooms={floorRooms}
              blockName={activeBlock?.name ?? 'Hostel Block'}
              floor={selectedFloor}
              selectedRoomId={selectedRoom?.id ?? null}
              highlightedRoomIds={highlightedRoomIds}
              onSelectRoom={(room) => setSelectedRoomId(room.id)}
            />
          </div>

          <div className="xl:col-span-4 space-y-4">
            {selectedRoom ? (
              <RoomKeyTag
                roomNumber={selectedRoom.number}
                blockName={selectedRoom.block_name}
                blockCode={selectedRoom.block_code}
                floor={selectedRoom.floor}
                capacity={selectedRoom.capacity}
                occupied={selectedRoom.occupants.length}
                ac={selectedRoom.ac}
                tags={selectedRoom.tags}
                occupants={selectedRoom.occupant_details}
                actionSlot={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigate('/student/profile')}
                      className="flex-1 px-3 py-2 text-xs font-bold text-[#F8F2E4] bg-[#C2552D] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#A64420] whitespace-nowrap"
                    >
                      Rank in Preferences
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('/swaps')}
                      className="flex-1 px-3 py-2 text-xs font-bold text-[#1F2A5A] bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#F1E6CF] whitespace-nowrap"
                    >
                      Seek via Swap
                    </button>
                  </div>
                }
              />
            ) : (
              <div className="bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] p-6 text-sm text-[#465078]">
                Select any room box on the blueprint to inspect its brass key tag and occupants.
              </div>
            )}

            {activeBlock && (
              <div className="bg-[#F8F2E4] border border-[#1F2A5A] rounded-[2px] p-4 text-xs text-[#465078] space-y-1">
                <p className="font-bold text-[#1F2A5A]">{activeBlock.name} Notes</p>
                <p>{activeBlock.description}</p>
                <p className="font-mono-code pt-1">
                  Block Warden: {activeBlock.warden_name} · Mess Nearby:{' '}
                  {activeBlock.has_mess_nearby ? 'Yes' : 'Walkable (4 min)'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
