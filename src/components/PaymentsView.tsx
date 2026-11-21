import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, RotateCcw, Search, X } from 'lucide-react';
import { apiFetch, downloadExportFile, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period } from '../types.ts';

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

export function PaymentsView({ user, periods }: { user: AuthUser; periods: Period[] }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [search, setSearch] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  async function loadPayments(targetPage = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: '20' });
      if (periodId) params.set('periodId', periodId);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch<{
        payments: PaymentRow[];
        pagination: { totalPages: number };
      }>(`/payments?${params.toString()}`);

      setPayments(res.payments);
      setTotalPages(res.pagination.totalPages);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadPayments(page), 200);
    return () => clearTimeout(t);
  }, [page, periodId, search]);

  async function submitReversal(e: React.FormEvent) {
    e.preventDefault();
    if (!reversing) return;
    setFeedback(null);
    try {
      await apiFetch(`/payments/${reversing.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reverseReason }),
      });
      setReversing(null);
      setReverseReason('');
      setFeedback('Transaksi reversal dicatat tanpa menghapus histori pembayaran lama.');
      await loadPayments(page);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal membuat reversal.');
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Riwayat Pembayaran
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Transaksi pembayaran bersifat immutable; koreksi menggunakan entri reversal tercatat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Cari penerima / ref..."
              className="pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg w-52"
            />
          </div>

          <select
            value={periodId}
            onChange={(e) => { setPeriodId(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
          >
            <option value="">Semua Periode</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.period_key}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void downloadExportFile('payments', 'xlsx', periodId)}
            className="px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => void downloadExportFile('payments', 'csv', periodId)}
            className="px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
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
                <th className="py-3 px-4 font-medium">Tanggal</th>
                <th className="py-3 px-4 font-medium">Penerima</th>
                <th className="py-3 px-4 font-medium">Periode</th>
                <th className="py-3 px-4 font-medium text-right">Nominal</th>
                <th className="py-3 px-4 font-medium">Admin</th>
                <th className="py-3 px-4 font-medium">Metode</th>
                <th className="py-3 px-4 font-medium">Reference</th>
                <th className="py-3 px-4 font-medium">Status</th>
                {canEdit && <th className="py-3 px-4 font-medium text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">Memuat riwayat...</td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">Belum ada transaksi pembayaran.</td>
                </tr>
              ) : (
                payments.map((py) => (
                  <tr key={py.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 text-xs font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {formatJakartaDateTime(py.paid_at)}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {py.recipient_name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{py.period_key}</td>
                    <td className={`py-3 px-4 text-right font-mono tabular-nums font-medium ${py.amount_idr < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                      {formatIdr(py.amount_idr)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">{py.admin_name}</td>
                    <td className="py-3 px-4 text-xs text-slate-700">{py.method}</td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-500">{py.transaction_ref || '-'}</td>
                    <td className="py-3 px-4 text-xs whitespace-nowrap">
                      {py.is_reversal ? (
                        <span className="text-rose-700 font-medium">REVERSAL</span>
                      ) : (
                        <span className="text-slate-700">{py.payroll_status}</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-3 px-4 text-right">
                        {!py.is_reversal && py.amount_idr > 0 && (
                          <button
                            type="button"
                            onClick={() => { setReversing(py); setReverseReason(''); }}
                            className="inline-flex items-center gap-1 text-xs text-rose-700 hover:underline cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Reversal
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Halaman {page} dari {totalPages}</span>
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 cursor-pointer">
            Sebelumnya
          </button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 cursor-pointer">
            Berikutnya
          </button>
        </div>
      </div>

      {reversing && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Buat Reversal Pembayaran</h2>
              <button type="button" onClick={() => setReversing(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Transaksi lama ({formatIdr(reversing.amount_idr)} untuk {reversing.recipient_name}) tetap tersimpan. Sistem akan membuat entri reversal negatif yang tercatat di audit log.
            </p>
            <form onSubmit={submitReversal} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Reversal (Wajib)</label>
                <input
                  type="text"
                  required
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Misal: Salah input nominal transfer"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReversing(null)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">Batal</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-rose-700 text-white rounded-lg cursor-pointer">Konfirmasi Reversal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
