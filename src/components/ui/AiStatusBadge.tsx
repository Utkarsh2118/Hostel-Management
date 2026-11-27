import React from 'react';
import type { AiStatusInfo } from '../../../lib/types';

interface AiStatusBadgeProps {
  status: AiStatusInfo | null;
  compact?: boolean;
}

export const AiStatusBadge: React.FC<AiStatusBadgeProps> = ({ status, compact = false }) => {
  if (!status) return null;

  const stateTone =
    status.provider === 'gemini'
      ? 'border-[#295234] text-[#295234] bg-[#5E8C6A]/15'
      : status.provider === 'groq'
        ? 'border-[#1F2A5A] text-[#1F2A5A] bg-[#FBE9A6]'
        : 'border-[#1F2A5A] text-[#465078] bg-[#E6D7B8]';

  return (
    <div
      className={[
        'inline-flex flex-col border border-[#1F2A5A] rounded-[2px]',
        compact ? 'px-2.5 py-1' : 'px-3 py-2',
        stateTone,
      ].join(' ')}
      title={status.detail}
    >
      <span className="font-mono-code text-xs font-bold whitespace-nowrap">
        AI Desk: {status.label}
      </span>
      {!compact && (
        <span className="text-xs text-[#465078] mt-0.5 leading-snug">{status.detail}</span>
      )}
    </div>
  );
};
