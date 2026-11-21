import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Download,
  FileSpreadsheet,
  Loader2,
  Receipt,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { apiFetch, downloadExportFile, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period } from '../types.ts';
import {
  ConfirmModal,
  EmptyState,
  SortableTh,
  StatusBadge,
  TableSkeleton,
  useToast,
  type SortDirection,
} from './ui/DashboardUI.tsx';

interface PayrollRecordRow {
  id: string;
  period_id: string;
  period_key: string;
  period_status: string;
  member_id: string;
  employee_name: string;
  discord_user_id: string;
  translator_chapters: number;
  editor_chapters: number;
  solo_chapters: number;
  total_chapters: number;
  gross_amount_idr: number;
  adjustment_amount_idr: number;
  net_amount_idr: number;
  paid_amount_idr: number;
  remaining_amount_idr: number;
  payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
}

interface PayrollBreakdown {
  record: PayrollRecordRow;
  items: Array<{
    id: string;
    project_title: string | null;
    chapter_number: number;
    role: string;
    unit_rate_idr: number;
    amount_idr: number;
  }>;
  adjustments: Array<{
    id: string;
    amount_idr: number;
    reason: string;
    authorized_by: string;
    created_at: string;
  }>;
  payments: Array<{
    id: string;
    amount_idr: number;
    paid_at: string;
    method: string;
    transaction_ref: string;
    admin_name: string;
  }>;
}

type SortKey = 'employee_name' | 'total_chapters' | 'net_amount_idr' | 'paid_amount_idr' | 'remaining_amount_idr';

export function PayrollView({ user, periods }: { user: AuthUser; periods: Period[] }) {
  const toast = useToast();
  const [periodId, setPeriodId] = useState(periods[0]?.id || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('remaining_amount_idr');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const [records, setRecords] = useState<PayrollRecordRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<PayrollBreakdown | null>(null);
  const [payTarget, setPayTarget] = useState<PayrollRecordRow | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState('BCA Transfer');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);

  const [confirmBulkPay, setConfirmBulkPay] = useState(false);
  const [bulkPaying, setBulkPaying] = useState(false);

  const [adjTarget, setAdjTarget] = useState<PayrollRecordRow | null>(null);
  const [adjAmount, setAdjAmount] = useState<number>(0);
  const [adjReason, setAdjReason] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);

  useEffect(() => {
    if (!periodId && periods.length > 0) {
      const openP = periods.find((p) => p.status !== 'CLOSED') || periods[0];
      setPeriodId(openP.id);
    }
  }, [periods, periodId]);

  async function loadPayroll() {
    if (!periodId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ periodId });
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch<{ records: PayrollRecordRow[] }>(`/payroll?${params.toString()}`);
      setRecords(res.records);
    } catch (err) {
      toast.error('Gagal memuat data payroll', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayroll();
  }, [periodId, statusFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'employee_name' ? 'asc' : 'desc');
    }
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? records.filter(
          (r) =>
            r.employee_name.toLowerCase().includes(q) ||
            r.discord_user_id.toLowerCase().includes(q)
        )
      : [...records];

    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'employee_name') {
        return a.employee_name.localeCompare(b.employee_name) * dir;
      }
      return (a[sortKey] - b[sortKey]) * dir;
    });
    return list;
  }, [records, search, sortKey, sortDir]);

  const summary = useMemo(() => {
    return filteredRecords.reduce(
      (acc, r) => {
        acc.chapters += r.total_chapters;
        acc.net += r.net_amount_idr;
        acc.paid += r.paid_amount_idr;
        acc.remaining += r.remaining_amount_idr;
        return acc;
      },
      { chapters: 0, net: 0, paid: 0, remaining: 0 }
    );
  }, [filteredRecords]);

  const eligibleForBulkPay = filteredRecords.filter(
    (r) => r.remaining_amount_idr > 0 && r.period_status !== 'CLOSED'
  );
  const allEligibleSelected =
    eligibleForBulkPay.length > 0 &&
    eligibleForBulkPay.every((r) => selectedIds.includes(r.id));

  const selectedBulkTotal = records
    .filter((r) => selectedIds.includes(r.id))
    .reduce((sum, r) => sum + r.remaining_amount_idr, 0);

  async function openBreakdown(id: string) {
    try {
      const res = await apiFetch<PayrollBreakdown>(`/payroll/${id}/items`);
      setDetail(res);
    } catch (err) {
      toast.error('Gagal memuat rincian payroll', err instanceof Error ? err.message : undefined);
    }
  }

  function openPayModal(rec: PayrollRecordRow) {
    setPayTarget(rec);
    setPayAmount(rec.remaining_amount_idr);
    setPayMethod('BCA Transfer');
    setPayRef(`TRF-${Date.now().toString().slice(-6)}`);
    setPayNotes('');
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    setPaySubmitting(true);
    try {
      await apiFetch('/payroll/pay', {
        method: 'POST',
        body: JSON.stringify({
          payrollRecordId: payTarget.id,
          amountIdr: Number(payAmount),
          method: payMethod,
          transactionRef: payRef,
          notes: payNotes,
        }),
      });
      toast.success(
        'Pembayaran berhasil dicatat',
        `${formatIdr(Number(payAmount))} untuk ${payTarget.employee_name}.`
      );
      setPayTarget(null);
      await loadPayroll();
    } catch (err) {
      toast.error('Gagal mencatat pembayaran', err instanceof Error ? err.message : undefined);
    } finally {
      setPaySubmitting(false);
    }
  }

  async function executeBulkPay() {
    if (selectedIds.length === 0) return;
    setBulkPaying(true);
    try {
      const res = await apiFetch<{ processedCount: number }>('/payroll/bulk-pay', {
        method: 'POST',
        body: JSON.stringify({
          payrollRecordIds: selectedIds,
          method: 'BCA Transfer',
        }),
      });
      setSelectedIds([]);
      setConfirmBulkPay(false);
      toast.success(
        `${res.processedCount} payroll berhasil dilunasi`,
        `Total transfer: ${formatIdr(selectedBulkTotal)}.`
      );
      await loadPayroll();
    } catch (err) {
      toast.error('Gagal memproses pembayaran massal', err instanceof Error ? err.message : undefined);
    } finally {
      setBulkPaying(false);
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjTarget) return;
    setAdjSubmitting(true);
    try {
      await apiFetch('/payroll/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          payrollRecordId: adjTarget.id,
          amountIdr: Number(adjAmount),
          reason: adjReason,
        }),
      });
      toast.success(
        'Adjustment payroll dicatat',
        `${formatIdr(Number(adjAmount))} untuk ${adjTarget.employee_name}.`
      );
      setAdjTarget(null);
      await loadPayroll();
    } catch (err) {
      toast.error('Gagal membuat adjustment', err instanceof Error ? err.message : undefined);
    } finally {
      setAdjSubmitting(false);
    }
  }

  const currentPeriod = periods.find((p) => p.id === periodId);
  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Manajemen Payroll
            </h1>
            {currentPeriod && <StatusBadge status={currentPeriod.status} />}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Kalkulasi berasal dari snapshot chapter berstatus approved / sukses tercatat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmBulkPay(true)}
              className="px-3.5 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
            >
              Lunasi Massal ({selectedIds.length} · {formatIdr(selectedBulkTotal)})
            </button>
          )}

          <button
            type="button"
            onClick={() => void downloadExportFile('payroll', 'xlsx', periodId)}
            className="px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={() => void downloadExportFile('payroll', 'csv', periodId)}
            className="px-3 py-2 text-xs sm:text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Period Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs text-slate-500">Total Chapter</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {summary.chapters}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs text-slate-500">Total Payroll Netto</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-1">
            {formatIdr(summary.net)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs text-slate-500">Sudah Dibayar</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-emerald-700 mt-1">
            {formatIdr(summary.paid)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs text-slate-500">Sisa Belum Dibayar</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-amber-700 mt-1">
            {formatIdr(summary.remaining)}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Pilih Periode"
            value={periodId}
            onChange={(e) => {
              setPeriodId(e.target.value);
              setSelectedIds([]);
            }}
            className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg font-mono text-slate-800 focus:outline-none focus:border-slate-900"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_key} ({p.status})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Status Pembayaran"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Status</option>
            <option value="UNPAID">Belum Bayar</option>
            <option value="PARTIALLY_PAID">Dibayar Sebagian</option>
            <option value="PAID">Lunas</option>
          </select>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari pekerja atau Discord ID..."
            className="pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg w-full sm:w-64 focus:outline-none focus:border-slate-900"
          />
        </div>
      </div>

      {/* Payroll Data */}
      {loading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : filteredRecords.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-5 h-5" />}
          title="Belum ada catatan payroll"
          description="Data payroll muncul otomatis setelah laporan chapter pekerja disetujui pada periode terpilih."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  {canEdit && (
                    <th className="py-3 px-4 w-8">
                      <input
                        type="checkbox"
                        disabled={eligibleForBulkPay.length === 0}
                        checked={allEligibleSelected}
                        onChange={(e) =>
                          setSelectedIds(
                            e.target.checked ? eligibleForBulkPay.map((r) => r.id) : []
                          )
                        }
                        className="rounded border-slate-300 cursor-pointer"
                        aria-label="Pilih semua yang belum lunas"
                      />
                    </th>
                  )}
                  <SortableTh
                    label="Nama Pekerja"
                    active={sortKey === 'employee_name'}
                    direction={sortDir}
                    onClick={() => toggleSort('employee_name')}
                  />
                  <th className="py-3 px-3 font-medium text-right">TL</th>
                  <th className="py-3 px-3 font-medium text-right">ED</th>
                  <th className="py-3 px-3 font-medium text-right">Solo</th>
                  <SortableTh
                    label="Total Ch"
                    align="right"
                    active={sortKey === 'total_chapters'}
                    direction={sortDir}
                    onClick={() => toggleSort('total_chapters')}
                  />
                  <SortableTh
                    label="Total Gaji"
                    align="right"
                    active={sortKey === 'net_amount_idr'}
                    direction={sortDir}
                    onClick={() => toggleSort('net_amount_idr')}
                  />
                  <SortableTh
                    label="Dibayar"
                    align="right"
                    active={sortKey === 'paid_amount_idr'}
                    direction={sortDir}
                    onClick={() => toggleSort('paid_amount_idr')}
                  />
                  <SortableTh
                    label="Sisa"
                    align="right"
                    active={sortKey === 'remaining_amount_idr'}
                    direction={sortDir}
                    onClick={() => toggleSort('remaining_amount_idr')}
                  />
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    {canEdit && (
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          disabled={rec.remaining_amount_idr <= 0 || rec.period_status === 'CLOSED'}
                          checked={selectedIds.includes(rec.id)}
                          onChange={() =>
                            setSelectedIds((prev) =>
                              prev.includes(rec.id)
                                ? prev.filter((x) => x !== rec.id)
                                : [...prev, rec.id]
                            )
                          }
                          className="rounded border-slate-300 cursor-pointer disabled:opacity-40"
                        />
                      </td>
                    )}
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      <div>{rec.employee_name}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {rec.discord_user_id}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {rec.translator_chapters}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {rec.editor_chapters}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                      {rec.solo_chapters}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {rec.total_chapters}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                      {formatIdr(rec.net_amount_idr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">
                      {formatIdr(rec.paid_amount_idr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700 font-semibold">
                      {formatIdr(rec.remaining_amount_idr)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <StatusBadge status={rec.payment_status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => void openBreakdown(rec.id)}
                          className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          Rincian
                        </button>
                        {canEdit && rec.remaining_amount_idr > 0 && rec.period_status !== 'CLOSED' && (
                          <button
                            type="button"
                            onClick={() => openPayModal(rec)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
                          >
                            <CreditCard className="w-3.5 h-3.5" /> Bayar
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setAdjTarget(rec);
                              setAdjAmount(0);
                              setAdjReason('');
                            }}
                            className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-md cursor-pointer"
                            title="Adjustment"
                            aria-label="Adjustment"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / Tablet Card View */}
          <div className="lg:hidden divide-y divide-slate-100">
            {filteredRecords.map((rec) => (
              <div key={rec.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    {canEdit && (
                      <input
                        type="checkbox"
                        disabled={rec.remaining_amount_idr <= 0 || rec.period_status === 'CLOSED'}
                        checked={selectedIds.includes(rec.id)}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(rec.id)
                              ? prev.filter((x) => x !== rec.id)
                              : [...prev, rec.id]
                          )
                        }
                        className="mt-1 rounded border-slate-300"
                      />
                    )}
                    <div>
                      <div className="font-semibold text-slate-900">{rec.employee_name}</div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        TL {rec.translator_chapters} · ED {rec.editor_chapters} · Solo{' '}
                        {rec.solo_chapters} ({rec.total_chapters} ch)
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={rec.payment_status} />
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-xs">
                  <div>
                    <div className="text-slate-500 text-[11px]">Netto</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                      {formatIdr(rec.net_amount_idr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Dibayar</div>
                    <div className="font-mono tabular-nums font-medium text-emerald-700 mt-0.5">
                      {formatIdr(rec.paid_amount_idr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Sisa</div>
                    <div className="font-mono tabular-nums font-semibold text-amber-700 mt-0.5">
                      {formatIdr(rec.remaining_amount_idr)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => void openBreakdown(rec.id)}
                    className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  >
                    Rincian
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdjTarget(rec);
                        setAdjAmount(0);
                        setAdjReason('');
                      }}
                      className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                    >
                      Adjustment
                    </button>
                  )}
                  {canEdit && rec.remaining_amount_idr > 0 && rec.period_status !== 'CLOSED' && (
                    <button
                      type="button"
                      onClick={() => openPayModal(rec)}
                      className="px-3 py-1.5 font-medium text-white bg-slate-900 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <CreditCard className="w-3.5 h-3.5" /> Bayar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bulk Pay Confirmation Modal */}
      <ConfirmModal
        open={confirmBulkPay}
        title={`Lunasi ${selectedIds.length} Payroll Sekaligus?`}
        description={`Sistem akan mencatat pembayaran penuh via BCA Transfer sebesar ${formatIdr(selectedBulkTotal)} untuk ${selectedIds.length} karyawan terpilih.`}
        confirmLabel="Ya, Lunasi Semua"
        loading={bulkPaying}
        onConfirm={executeBulkPay}
        onCancel={() => setConfirmBulkPay(false)}
      />

      {/* Breakdown Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="flex-1" onClick={() => setDetail(null)} />
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-5 shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Rincian Payroll — {detail.record.employee_name}
                </h2>
                <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                  Periode {detail.record.period_key} · Bruto {formatIdr(detail.record.gross_amount_idr)} ·
                  Adjustment {formatIdr(detail.record.adjustment_amount_idr)} · Netto{' '}
                  {formatIdr(detail.record.net_amount_idr)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                Daftar Chapter Terhitung ({detail.items.length})
              </h3>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Komik</th>
                      <th className="py-2 px-3">Ch</th>
                      <th className="py-2 px-3">Role</th>
                      <th className="py-2 px-3 text-right">Tarif Snapshot</th>
                      <th className="py-2 px-3 text-right">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.items.map((it) => (
                      <tr key={it.id}>
                        <td className="py-2 px-3 font-medium text-slate-800">{it.project_title || '-'}</td>
                        <td className="py-2 px-3 font-mono tabular-nums">Ch. {it.chapter_number}</td>
                        <td className="py-2 px-3">{it.role}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">
                          {formatIdr(it.unit_rate_idr)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {formatIdr(it.amount_idr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {detail.adjustments.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Transaksi Adjustment</h3>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {detail.adjustments.map((adj) => (
                    <div key={adj.id} className="px-3 py-2.5 flex justify-between text-xs gap-3">
                      <div>
                        <div className="font-medium text-slate-800">{adj.reason}</div>
                        <div className="text-slate-400 font-mono">
                          Oleh {adj.authorized_by} · {formatJakartaDateTime(adj.created_at)} WIB
                        </div>
                      </div>
                      <div className="font-mono tabular-nums font-semibold shrink-0">
                        {formatIdr(adj.amount_idr)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Konfirmasi &amp; Catat Pembayaran</h2>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 mb-4 space-y-1">
              <div className="flex justify-between">
                <span>Penerima</span>
                <span className="font-semibold text-slate-900">{payTarget.employee_name}</span>
              </div>
              <div className="flex justify-between">
                <span>Sisa Tagihan</span>
                <span className="font-mono tabular-nums font-semibold text-amber-700">
                  {formatIdr(payTarget.remaining_amount_idr)}
                </span>
              </div>
            </div>
            <form onSubmit={submitPayment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nominal Pembayaran (IDR)
                </label>
                <input
                  type="number"
                  min={1}
                  max={payTarget.remaining_amount_idr}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
                <div className="flex gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setPayAmount(Math.floor(payTarget.remaining_amount_idr / 2))}
                    className="px-2 py-0.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                  >
                    50% Sebagian
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayAmount(payTarget.remaining_amount_idr)}
                    className="px-2 py-0.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                  >
                    100% Lunas
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Metode Pembayaran</label>
                <input
                  type="text"
                  required
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Referensi Transaksi</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={paySubmitting}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {paySubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Konfirmasi Pembayaran</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {adjTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Buat Adjustment Payroll</h2>
              <button
                type="button"
                onClick={() => setAdjTarget(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Penerima: <span className="font-semibold text-slate-900">{adjTarget.employee_name}</span>.
              Gunakan nilai positif atau negatif (integer IDR) untuk penyesuaian resmi yang tercatat di audit log.
            </p>
            <form onSubmit={submitAdjustment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nominal Adjustment (IDR)</label>
                <input
                  type="number"
                  required
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Resmi (Wajib)</label>
                <input
                  type="text"
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Misal: Koreksi chapter periode tertutup"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAdjTarget(null)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={adjSubmitting}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {adjSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Simpan Adjustment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
