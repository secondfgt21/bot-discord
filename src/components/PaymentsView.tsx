import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { apiFetch, downloadExportFile, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period } from '../types.ts';
import {
  EmptyState,
  PaginationBar,
  SortableTh,
  StatusBadge,
  TableSkeleton,
  useToast,
  type SortDirection,
} from './ui/DashboardUI.tsx';

interface PaymentRow {
  id: string;
  paid_at: string;
  recipient_name: string;
  discord_user_id: string;
  period_key: string;
  amount_idr: number;
  admin_name: string;
  method: string;
  transaction_ref: string;
  notes: string;
  payroll_status: string;
  is_reversal: boolean | number;
}

type SortKey = 'paid_at' | 'recipient_name' | 'amount_idr';

export function PaymentsView({ user, periods }: { user: AuthUser; periods: Period[] }) {
  const toast = useToast();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [search, setSearch] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'payment' | 'reversal'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('paid_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);

  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

  async function loadPayments(targetPage = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: '20' });
      if (periodId) params.set('periodId', periodId);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch<{
        payments: PaymentRow[];
        pagination: { totalPages: number; total?: number };
      }>(`/payments?${params.toString()}`);

      setPayments(res.payments);
      setTotalPages(res.pagination.totalPages);
      setTotalItems(res.pagination.total ?? res.payments.length);
    } catch (err) {
      toast.error('Gagal memuat riwayat pembayaran', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void loadPayments(page), 220);
    return () => window.clearTimeout(t);
  }, [page, periodId, search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'recipient_name' ? 'asc' : 'desc');
    }
  }

  const displayedPayments = useMemo(() => {
    const list = payments.filter((p) => {
      if (typeFilter === 'reversal') return Boolean(p.is_reversal);
      if (typeFilter === 'payment') return !p.is_reversal;
      return true;
    });
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'recipient_name') return a.recipient_name.localeCompare(b.recipient_name) * dir;
      if (sortKey === 'amount_idr') return (a.amount_idr - b.amount_idr) * dir;
      return (new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime()) * dir;
    });
    return list;
  }, [payments, typeFilter, sortKey, sortDir]);

  async function submitReversal(e: React.FormEvent) {
    e.preventDefault();
    if (!reversing) return;
    setReverseSubmitting(true);
    try {
      await apiFetch(`/payments/${reversing.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reverseReason }),
      });
      toast.success(
        'Transaksi reversal dicatat',
        `Pembayaran ${formatIdr(reversing.amount_idr)} untuk ${reversing.recipient_name} telah direversal.`
      );
      setReversing(null);
      setReverseReason('');
      await loadPayments(page);
    } catch (err) {
      toast.error('Gagal membuat reversal', err instanceof Error ? err.message : undefined);
    } finally {
      setReverseSubmitting(false);
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Riwayat Pembayaran
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Catatan pembayaran bersifat immutable · Koreksi dilakukan melalui entri reversal resmi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void downloadExportFile('payments', 'xlsx', periodId)}
            className="px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => void downloadExportFile('payments', 'csv', periodId)}
            className="px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter Periode"
            value={periodId}
            onChange={(e) => {
              setPeriodId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg font-mono text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Periode</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_key}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Tipe Transaksi"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'payment' | 'reversal')}
            className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="all">Semua Transaksi</option>
            <option value="payment">Pembayaran Normal</option>
            <option value="reversal">Reversal Saja</option>
          </select>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Cari penerima atau referensi..."
            className="pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg w-full sm:w-64 focus:outline-none focus:border-slate-900"
          />
        </div>
      </div>

      {/* Payments Table / Mobile Cards */}
      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : displayedPayments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-5 h-5" />}
          title="Belum ada transaksi pembayaran"
          description="Transaksi yang dicatat dari menu Payroll Bulanan akan tersimpan permanen di sini."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <SortableTh
                    label="Waktu (WIB)"
                    active={sortKey === 'paid_at'}
                    direction={sortDir}
                    onClick={() => toggleSort('paid_at')}
                  />
                  <SortableTh
                    label="Penerima"
                    active={sortKey === 'recipient_name'}
                    direction={sortDir}
                    onClick={() => toggleSort('recipient_name')}
                  />
                  <th className="py-3 px-4 font-medium">Periode</th>
                  <SortableTh
                    label="Nominal"
                    align="right"
                    active={sortKey === 'amount_idr'}
                    direction={sortDir}
                    onClick={() => toggleSort('amount_idr')}
                  />
                  <th className="py-3 px-4 font-medium">Admin</th>
                  <th className="py-3 px-4 font-medium">Metode &amp; Ref</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  {canEdit && <th className="py-3 px-4 font-medium text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedPayments.map((py) => (
                  <tr key={py.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 text-xs font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {formatJakartaDateTime(py.paid_at)}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {py.recipient_name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{py.period_key}</td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                        py.amount_idr < 0 ? 'text-rose-700' : 'text-slate-900'
                      }`}
                    >
                      {formatIdr(py.amount_idr)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">{py.admin_name}</td>
                    <td className="py-3 px-4 text-xs">
                      <div className="text-slate-800">{py.method}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {py.transaction_ref || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {py.is_reversal ? (
                        <StatusBadge status="REVERSAL" />
                      ) : (
                        <StatusBadge status={py.payroll_status} />
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {!py.is_reversal && py.amount_idr > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setReversing(py);
                              setReverseReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" /> Reversal
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {displayedPayments.map((py) => (
              <div key={py.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{py.recipient_name}</div>
                    <div className="text-xs font-mono text-slate-500 tabular-nums">
                      {formatJakartaDateTime(py.paid_at)} WIB · {py.period_key}
                    </div>
                  </div>
                  {py.is_reversal ? (
                    <StatusBadge status="REVERSAL" />
                  ) : (
                    <StatusBadge status={py.payroll_status} />
                  )}
                </div>
                <div className="flex items-center justify-between text-xs pt-1">
                  <div className="text-slate-600">
                    {py.method} <span className="font-mono text-slate-400">({py.transaction_ref || '-'})</span>
                  </div>
                  <div
                    className={`font-mono tabular-nums font-semibold text-sm ${
                      py.amount_idr < 0 ? 'text-rose-700' : 'text-slate-900'
                    }`}
                  >
                    {formatIdr(py.amount_idr)}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <span>Admin: {py.admin_name}</span>
                  {canEdit && !py.is_reversal && py.amount_idr > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setReversing(py);
                        setReverseReason('');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" /> Reversal
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && displayedPayments.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          onPageChange={(next) => setPage(next)}
        />
      )}

      {/* Reversal Confirmation Modal */}
      {reversing && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Konfirmasi Reversal Pembayaran</h2>
              <button
                type="button"
                onClick={() => setReversing(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 mb-4 leading-relaxed">
              Transaksi lama ({formatIdr(reversing.amount_idr)} untuk{' '}
              <span className="font-semibold">{reversing.recipient_name}</span>) tetap tersimpan. Sistem akan mencatat entri reversal negatif dan mengembalikan sisa tagihan.
            </div>
            <form onSubmit={submitReversal} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alasan Reversal (Wajib untuk Audit Log)
                </label>
                <input
                  type="text"
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Misal: Salah input nominal transfer"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReversing(null)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={reverseSubmitting}
                  className="px-4 py-2 text-sm font-medium bg-rose-700 hover:bg-rose-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {reverseSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Konfirmasi Reversal</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
