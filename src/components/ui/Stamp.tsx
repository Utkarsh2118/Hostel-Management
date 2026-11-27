import React from 'react';

export type StampVariant = 'red' | 'green' | 'ink' | 'brick';

interface StampProps {
  label: string;
  variant?: StampVariant;
  size?: 'sm' | 'md';
  animate?: boolean;
  className?: string;
}

const VARIANT_CLASSES: Record<StampVariant, string> = {
  red: 'border-[#B3261E] text-[#B3261E]',
  green: 'border-[#295234] text-[#295234]',
  ink: 'border-[#1F2A5A] text-[#1F2A5A]',
  brick: 'border-[#C2552D] text-[#9D3F1D]',
};

export const Stamp: React.FC<StampProps> = ({
  label,
  variant = 'red',
  size = 'md',
  animate = false,
  className = '',
}) => {
  return (
    <span
      className={[
        'inline-block font-mono-code font-bold tracking-[0.14em] uppercase border-2 rounded-[2px] select-none whitespace-nowrap shrink-0',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
        VARIANT_CLASSES[variant],
        animate ? 'animate-stamp' : '-rotate-2',
        className,
      ].join(' ')}
      style={{
        boxShadow: 'inset 0 0 0 1px currentColor',
      }}
    >
      {label}
    </span>
  );
};
