import React from 'react';
import { X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  tone: 'success' | 'error' | 'info';
  text: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 lg:bottom-6 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)]"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const bg =
          toast.tone === 'success'
            ? 'bg-[#F8F2E4] border-[#295234]'
            : toast.tone === 'error'
              ? 'bg-[#F8F2E4] border-[#B3261E]'
              : 'bg-[#FBE9A6] border-[#1F2A5A]';
        const labelColor =
          toast.tone === 'success'
            ? 'text-[#295234]'
            : toast.tone === 'error'
              ? 'text-[#B3261E]'
              : 'text-[#1F2A5A]';

        return (
          <div
            key={toast.id}
            className={`border-2 rounded-[2px] shadow-ink px-4 py-3 flex items-start justify-between gap-3 animate-chit ${bg}`}
          >
            <div>
              <p className={`font-mono-code text-[11px] font-bold uppercase ${labelColor}`}>
                {toast.tone === 'success'
                  ? 'Recorded'
                  : toast.tone === 'error'
                    ? 'Action Required'
                    : 'Notice'}
              </p>
              <p className="text-sm text-[#1F2A5A] leading-snug mt-0.5">{toast.text}</p>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="p-1 text-[#1F2A5A] hover:text-[#B3261E]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
