import React, { useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F2A5A]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md bg-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink p-6 animate-chit">
        <h2 id="confirm-dialog-title" className="text-xl font-bold text-[#1F2A5A]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[#465078] leading-relaxed">{description}</p>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-[#1F2A5A] bg-[#F1E6CF] border-2 border-[#1F2A5A] rounded-[2px] hover:bg-[#E6D7B8] disabled:opacity-50 whitespace-nowrap"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={[
              'px-4 py-2 text-sm font-semibold text-[#F8F2E4] border-2 border-[#1F2A5A] rounded-[2px] shadow-ink-sm active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50 whitespace-nowrap',
              tone === 'danger'
                ? 'bg-[#B3261E] hover:bg-[#931E17]'
                : 'bg-[#C2552D] hover:bg-[#A64420]',
            ].join(' ')}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
