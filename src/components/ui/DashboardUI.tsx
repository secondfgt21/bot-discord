import React, { createContext, useCallback, useContext, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  Unlock,
  X,
  XCircle,
} from 'lucide-react';

// ============================================================================
// Toast Notification System
// ============================================================================

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: { variant?: ToastVariant; title: string; description?: string }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (opts: { variant?: ToastVariant; title: string; description?: string }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const variant = opts.variant ?? 'info';
      setToasts((prev) => [...prev.slice(-3), { id, variant, title: opts.title, description: opts.description }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4800);
    },
    []
  );

  const value: ToastContextValue = {
    toast: push,
    success: (title, description) => push({ variant: 'success', title, description }),
    error: (title, description) => push({ variant: 'error', title, description }),
    warning: (title, description) => push({ variant: 'warning', title, description }),
    info: (title, description) => push({ variant: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 sm:top-5 sm:bottom-auto sm:right-5 z-[70] flex flex-col gap-2.5 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
      >
        {toasts.map((item) => {
          const styles: Record<ToastVariant, { border: string; icon: React.ReactNode }> = {
            success: {
              border: 'border-emerald-200 bg-white text-slate-900',
              icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
            },
            error: {
              border: 'border-rose-200 bg-white text-slate-900',
              icon: <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
            },
            warning: {
              border: 'border-amber-200 bg-white text-slate-900',
              icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
            },
            info: {
              border: 'border-slate-200 bg-white text-slate-900',
              icon: <Info className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />,
            },
          };
          const s = styles[item.variant];
          return (
            <div
              key={item.id}
              className={`pointer-events-auto border ${s.border} rounded-xl px-4 py-3 shadow-lg shadow-slate-900/5 flex items-start gap-3 transition-all`}
            >
              {s.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 leading-snug">{item.title}</div>
                {item.description && (
                  <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.description}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer shrink-0"
                aria-label="Tutup notifikasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

// ============================================================================
// Unified Semantic Status Badges (Rectangular, High-Contrast, Icon + Text)
// ============================================================================

export type StatusKind =
  | 'auto_approved'
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'void'
  | 'OPEN'
  | 'CLOSING'
  | 'CLOSED'
  | 'REOPENED'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'UNPAID'
  | 'REVERSAL'
  | 'ACTIVE'
  | 'INACTIVE';

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const normalized = status.trim();

  const configs: Record<
    string,
    { text: string; classes: string; icon: React.ReactNode }
  > = {
    auto_approved: {
      text: label || 'Sukses Tercatat',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    },
    approved: {
      text: label || 'Approved',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    },
    pending: {
      text: label || 'Pending',
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" />,
    },
    rejected: {
      text: label || 'Rejected',
      classes: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
    },
    void: {
      text: label || 'Void',
      classes: 'bg-slate-100 text-slate-600 border-slate-200',
      icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
    },
    OPEN: {
      text: label || 'OPEN',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <Unlock className="w-3 h-3 shrink-0" />,
    },
    CLOSING: {
      text: label || 'CLOSING',
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <Clock className="w-3 h-3 shrink-0" />,
    },
    CLOSED: {
      text: label || 'CLOSED',
      classes: 'bg-slate-100 text-slate-700 border-slate-300',
      icon: <Lock className="w-3 h-3 shrink-0" />,
    },
    REOPENED: {
      text: label || 'REOPENED',
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <Unlock className="w-3 h-3 shrink-0" />,
    },
    PAID: {
      text: label || 'Lunas',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
    },
    PARTIALLY_PAID: {
      text: label || 'Sebagian',
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <Clock className="w-3.5 h-3.5 shrink-0" />,
    },
    UNPAID: {
      text: label || 'Belum Bayar',
      classes: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />,
    },
    REVERSAL: {
      text: label || 'Reversal',
      classes: 'bg-rose-50 text-rose-700 border-rose-200',
      icon: <RotateCcw className="w-3 h-3 shrink-0" />,
    },
    ACTIVE: {
      text: label || 'Aktif',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <CheckCircle2 className="w-3 h-3 shrink-0" />,
    },
    INACTIVE: {
      text: label || 'Nonaktif',
      classes: 'bg-slate-100 text-slate-600 border-slate-200',
      icon: <XCircle className="w-3 h-3 shrink-0" />,
    },
  };

  const cfg = configs[normalized] ?? {
    text: label || normalized,
    classes: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: null,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-md border whitespace-nowrap ${cfg.classes}`}
    >
      {cfg.icon}
      <span>{cfg.text}</span>
    </span>
  );
}

// ============================================================================
// Confirmation Modal (No window.confirm!)
// ============================================================================

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger' | 'warning';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  const confirmBtnClasses =
    variant === 'danger'
      ? 'bg-rose-700 hover:bg-rose-800 text-white'
      : variant === 'warning'
        ? 'bg-amber-700 hover:bg-amber-800 text-white'
        : 'bg-slate-900 hover:bg-slate-800 text-white';

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/45 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl shadow-slate-900/10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                variant === 'danger'
                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                  : variant === 'warning'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-slate-100 text-slate-800 border border-slate-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 leading-snug">{title}</h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">{description}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-6 pt-4 border-t border-slate-100">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm()}
            className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap ${confirmBtnClasses}`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Loading Skeletons & Empty States
// ============================================================================

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, idx) => (
          <div key={idx} className="h-3.5 bg-slate-200 rounded flex-1 animate-pulse" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="px-4 py-3.5 flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, cIdx) => (
              <div
                key={cIdx}
                className={`h-4 bg-slate-100 rounded flex-1 animate-pulse ${cIdx === 0 ? 'max-w-[180px]' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="h-5 w-1/2 bg-slate-200 rounded animate-pulse" />
          <div className="h-3.5 w-1/3 bg-slate-100 rounded animate-pulse" />
          <div className="h-16 w-full bg-slate-100 rounded-lg animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-12 text-center flex flex-col items-center">
      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ============================================================================
// Pagination & Sortable Table Headers
// ============================================================================

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems?: number;
  onPageChange: (next: number) => void;
}) {
  const safeTotal = Math.max(1, totalPages);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1 text-xs text-slate-600">
      <div className="font-mono tabular-nums">
        Halaman <span className="font-semibold text-slate-900">{page}</span> dari{' '}
        <span className="font-semibold text-slate-900">{safeTotal}</span>
        {typeof totalItems === 'number' && (
          <span className="text-slate-500"> · {totalItems} total data</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Sebelumnya</span>
        </button>
        <button
          type="button"
          disabled={page >= safeTotal}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>Berikutnya</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export type SortDirection = 'asc' | 'desc';

export function SortableTh({
  label,
  active,
  direction,
  align = 'left',
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  align?: 'left' | 'right';
  onClick: () => void;
}) {
  return (
    <th className={`py-3 px-4 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap ${
          active ? 'text-slate-900 font-semibold' : 'text-slate-500'
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        <span>{label}</span>
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5 text-slate-900" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
        )}
      </button>
    </th>
  );
}
