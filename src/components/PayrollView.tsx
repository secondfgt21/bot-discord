import React, { useEffect, useState } from 'react';
import { CreditCard, Download, FileSpreadsheet, SlidersHorizontal, X } from 'lucide-react';
import { apiFetch, downloadExportFile, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period } from '../types.ts';

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
  items: Array<{ id: string; project_title: string | null; chapter_number: number; role: string; unit_rate_idr: number; amount_idr: number }>;
  adjustments: Array<{ id: string; amount_idr: number; reason: string; authorized_by: string; created_at: string }>;
  payments: Array<{ id: string; amount_idr: number; paid_at: string; method: string; transaction_ref: string; admin_name: string }>;
}

export function PayrollView({ user, periods }: { user: AuthUser; periods: Period[] }) {
  const [periodId, setPeriodId] = useState(periods[0]?.id || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [records, setRecords] = useState<PayrollRecordRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [detail, setDetail] = useState<PayrollBreakdown | null>(null);
  const [payTarget, setPayTarget] = useState<PayrollRecordRow | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState('BCA Transfer');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const [adjTarget, setAdjTarget] = useState<PayrollRecordRow | null>(null);
  const [adjAmount, setAdjAmount] = useState<number>(0);
  const [adjReason, setAdjReason] = useState('');

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayroll();
  }, [periodId, statusFilter]);

  async function openBreakdown(id: string) {
    const res = await apiFetch<PayrollBreakdown>(`/payroll/${id}/items`);
    setDetail(res);
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
    setFeedback(null);
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
      setPayTarget(null);
      setFeedback('Pembayaran berhasil dicatat.');
      await loadPayroll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mencatat pembayaran.');
    }
  }

  async function handleBulkPay() {
    if (selectedIds.length === 0) return;
    setFeedback(null);
    try {
      const res = await apiFetch<{ processedCount: number }>('/payroll/bulk-pay', {
        method: 'POST',
        body: JSON.stringify({
          payrollRecordIds: selectedIds,
          method: 'BCA Transfer',
        }),
      });
      setSelectedIds([]);
      setFeedback(`${res.processedCount} payroll berhasil dilunasi sekaligus.`);
      await loadPayroll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal memproses bulk payment.');
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjTarget) return;
    setFeedback(null);
    try {
      await apiFetch('/payroll/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          payrollRecordId: adjTarget.id,
          amountIdr: Number(adjAmount),
          reason: adjReason,
        }),
      });
      setAdjTarget(null);
      setFeedback('Adjustment payroll berhasil dicatat.');
      await loadPayroll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal membuat adjustment.');
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Manajemen Payroll
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Perhitungan berasal dari snapshot chapter yang berstatus approved / auto_approved.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={periodId}
            onChange={(e) => { setPeriodId(e.target.value); setSelectedIds([]); }}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_key} ({p.status})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            <option value="">Semua Status</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Partially Paid</option>
            <option value="PAID">Paid</option>
          </select>

          {canEdit && selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => void handleBulkPay()}
              className="px-3.5 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
            >
              Lunasi Massal ({selectedIds.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => void downloadExportFile('payroll', 'xlsx', periodId)}
            className="px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            onClick={() => void downloadExportFile('payroll', 'csv', periodId)}
            className="px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 flex justify-between items-center">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                {canEdit && <th className="py-3 px-4 w-8"></th>}
                <th className="py-3 px-4 font-medium">Nama</th>
                <th className="py-3 px-4 font-medium text-right">Translator</th>
                <th className="py-3 px-4 font-medium text-right">Editor</th>
                <th className="py-3 px-4 font-medium text-right">Solo</th>
                <th className="py-3 px-4 font-medium text-right">Total Ch</th>
                <th className="py-3 px-4 font-medium text-right">Total Gaji</th>
                <th className="py-3 px-4 font-medium text-right">Sudah Dibayar</th>
                <th className="py-3 px-4 font-medium text-right">Sisa</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-400">
                    Memuat data payroll...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500">
                    Belum ada catatan payroll pada periode ini.
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50">
                    {canEdit && (
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          disabled={rec.remaining_amount_idr <= 0 || rec.period_status === 'CLOSED'}
                          checked={selectedIds.includes(rec.id)}
                          onChange={() =>
                            setSelectedIds((prev) =>
                              prev.includes(rec.id) ? prev.filter((x) => x !== rec.id) : [...prev, rec.id]
                            )
                          }
                        />
                      </td>
                    )}
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {rec.employee_name}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{rec.translator_chapters}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{rec.editor_chapters}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{rec.solo_chapters}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">{rec.total_chapters}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium">{formatIdr(rec.net_amount_idr)}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">{formatIdr(rec.paid_amount_idr)}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700 font-medium">{formatIdr(rec.remaining_amount_idr)}</td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap font-medium">
                      <span
                        className={
                          rec.payment_status === 'PAID'
                            ? 'text-emerald-700'
                            : rec.payment_status === 'PARTIALLY_PAID'
                              ? 'text-amber-700'
                              : 'text-rose-700'
                        }
                      >
                        {rec.payment_status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2 text-xs">
                      <button
                        type="button"
                        onClick={() => void openBreakdown(rec.id)}
                        className="text-slate-700 hover:underline cursor-pointer"
                      >
                        Rincian
                      </button>
                      {canEdit && rec.remaining_amount_idr > 0 && rec.period_status !== 'CLOSED' && (
                        <button
                          type="button"
                          onClick={() => openPayModal(rec)}
                          className="inline-flex items-center gap-1 text-slate-900 font-medium hover:underline cursor-pointer"
                        >
                          <CreditCard className="w-3.5 h-3.5" /> Bayar
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => { setAdjTarget(rec); setAdjAmount(0); setAdjReason(''); }}
                          className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 cursor-pointer"
                          title="Adjustment"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Breakdown Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Rincian Payroll — {detail.record.employee_name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  Periode {detail.record.period_key} · Bruto {formatIdr(detail.record.gross_amount_idr)} · Adjustment {formatIdr(detail.record.adjustment_amount_idr)} · Netto {formatIdr(detail.record.net_amount_idr)}
                </p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Daftar Chapter Terhitung</h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
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
                        <td className="py-2 px-3">{it.project_title || '-'}</td>
                        <td className="py-2 px-3 font-mono tabular-nums">Ch.{it.chapter_number}</td>
                        <td className="py-2 px-3">{it.role}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{formatIdr(it.unit_rate_idr)}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">{formatIdr(it.amount_idr)}</td>
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
                    <div key={adj.id} className="px-3 py-2 flex justify-between text-xs">
                      <div>
                        <div className="font-medium text-slate-800">{adj.reason}</div>
                        <div className="text-slate-400">Oleh {adj.authorized_by} · {formatJakartaDateTime(adj.created_at)}</div>
                      </div>
                      <div className="font-mono tabular-nums font-semibold">{formatIdr(adj.amount_idr)}</div>
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
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Catat Pembayaran</h2>
              <button type="button" onClick={() => setPayTarget(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Penerima: <span className="font-semibold text-slate-800">{payTarget.employee_name}</span> · Sisa tagihan:{' '}
              <span className="font-mono font-semibold text-slate-900">{formatIdr(payTarget.remaining_amount_idr)}</span>
            </p>
            <form onSubmit={submitPayment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nominal (Rupiah Integer)</label>
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
                    className="text-xs text-slate-600 underline cursor-pointer"
                  >
                    50% Sebagian
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayAmount(payTarget.remaining_amount_idr)}
                    className="text-xs text-slate-600 underline cursor-pointer"
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
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPayTarget(null)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                  Simpan Pembayaran
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustment Modal */}
      {adjTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Buat Adjustment Payroll</h2>
              <button type="button" onClick={() => setAdjTarget(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Gunakan nilai positif atau negatif (integer Rupiah) untuk penyesuaian resmi tanpa menghapus histori.
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
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAdjTarget(null)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                  Simpan Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
