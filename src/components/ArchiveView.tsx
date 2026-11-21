import React, { useEffect, useState } from 'react';
import { Lock, Unlock, X } from 'lucide-react';
import { apiFetch, downloadExportFile, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';

interface ArchivePeriod {
  id: string;
  period_key: string;
  year: number;
  month: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED' | 'REOPENED';
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  active_workers: number;
  total_comics: number;
  translator_chapters: number;
  editor_chapters: number;
  solo_chapters: number;
  total_chapters: number;
  total_payroll_idr: number;
  total_paid_idr: number;
  total_unpaid_idr: number;
  byComic: Array<{ title: string; chapters: number; amount_idr: number }>;
}

export function ArchiveView({
  user,
  onPeriodsUpdated,
}: {
  user: AuthUser;
  onPeriodsUpdated: () => void;
}) {
  const [archives, setArchives] = useState<ArchivePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  const [reopenTarget, setReopenTarget] = useState<ArchivePeriod | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  async function loadArchives() {
    setLoading(true);
    try {
      const res = await apiFetch<{ archives: ArchivePeriod[] }>('/periods/archive');
      setArchives(res.archives);
      if (res.archives.length >= 2) {
        setCompareA((prev) => prev || res.archives[0].id);
        setCompareB((prev) => prev || res.archives[1].id);
      } else if (res.archives.length === 1) {
        setCompareA(res.archives[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadArchives();
  }, []);

  async function handleClosePeriod(p: ArchivePeriod) {
    setFeedback(null);
    try {
      await apiFetch(`/periods/${p.id}/close`, { method: 'POST' });
      setFeedback(`Periode ${p.period_key} berhasil ditutup (CLOSED).`);
      await loadArchives();
      onPeriodsUpdated();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menutup periode.');
    }
  }

  async function submitReopen(e: React.FormEvent) {
    e.preventDefault();
    if (!reopenTarget) return;
    setFeedback(null);
    try {
      await apiFetch(`/periods/${reopenTarget.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason: reopenReason }),
      });
      setReopenTarget(null);
      setReopenReason('');
      setFeedback('Periode berhasil dibuka kembali (REOPENED).');
      await loadArchives();
      onPeriodsUpdated();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal membuka kembali periode.');
    }
  }

  const periodA = archives.find((a) => a.id === compareA);
  const periodB = archives.find((a) => a.id === compareB);
  const canAdmin = user.role !== 'Viewer';
  const isOwner = user.role === 'Owner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          Arsip Bulanan & Perbandingan Periode
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Data bulan lama tidak pernah dihapus saat pergantian bulan (Asia/Jakarta).
        </p>
      </div>

      {feedback && (
        <div className="px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 flex justify-between items-center">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Month Comparison Panel */}
      {archives.length >= 2 && periodA && periodB && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Perbandingan Antarbulan</h2>
            <div className="flex items-center gap-2 text-xs">
              <select
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono"
              >
                {archives.map((a) => (
                  <option key={a.id} value={a.id}>{a.period_key}</option>
                ))}
              </select>
              <span className="text-slate-400">vs</span>
              <select
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono"
              >
                {archives.map((a) => (
                  <option key={a.id} value={a.id}>{a.period_key}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-slate-500">Total Chapter</div>
              <div className="font-mono tabular-nums text-base font-semibold mt-1">
                {periodA.total_chapters} <span className="text-slate-400 font-normal">vs</span> {periodB.total_chapters}
              </div>
              <div className="text-slate-500 mt-0.5 font-mono">
                Selisih: {periodA.total_chapters - periodB.total_chapters >= 0 ? '+' : ''}
                {periodA.total_chapters - periodB.total_chapters}
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-slate-500">Total Payroll</div>
              <div className="font-mono tabular-nums text-sm font-semibold mt-1">
                {formatIdr(periodA.total_payroll_idr)}
              </div>
              <div className="text-slate-500 mt-0.5 font-mono">
                vs {formatIdr(periodB.total_payroll_idr)}
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-slate-500">Karyawan Aktif</div>
              <div className="font-mono tabular-nums text-base font-semibold mt-1">
                {periodA.active_workers} <span className="text-slate-400 font-normal">vs</span> {periodB.active_workers}
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-slate-500">Komik Dikerjakan</div>
              <div className="font-mono tabular-nums text-base font-semibold mt-1">
                {periodA.total_comics} <span className="text-slate-400 font-normal">vs</span> {periodB.total_comics}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Archive Cards */}
      {loading ? (
        <div className="text-sm text-slate-400 py-8">Memuat arsip bulanan...</div>
      ) : (
        <div className="space-y-4">
          {archives.map((arc) => (
            <div key={arc.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold font-mono text-slate-900">{arc.period_key}</h3>
                    <span
                      className={`text-xs font-medium ${
                        arc.status === 'CLOSED'
                          ? 'text-slate-700'
                          : arc.status === 'REOPENED'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {arc.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Dibuka: {formatJakartaDateTime(arc.opened_at)}
                    {arc.closed_at && ` · Ditutup: ${formatJakartaDateTime(arc.closed_at)} oleh ${arc.closed_by}`}
                    {arc.reopened_at && ` · Dibuka kembali: ${formatJakartaDateTime(arc.reopened_at)} (${arc.reopen_reason})`}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadExportFile('payroll', 'xlsx', arc.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    Export Excel
                  </button>
                  {canAdmin && arc.status !== 'CLOSED' && (
                    <button
                      type="button"
                      onClick={() => void handleClosePeriod(arc)}
                      className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" /> Tutup Periode
                    </button>
                  )}
                  {isOwner && arc.status === 'CLOSED' && (
                    <button
                      type="button"
                      onClick={() => { setReopenTarget(arc); setReopenReason(''); }}
                      className="px-3 py-1.5 text-xs font-medium bg-amber-700 hover:bg-amber-800 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" /> Buka Kembali (Owner)
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">Karyawan</div>
                  <div className="font-mono tabular-nums font-semibold text-sm mt-0.5">{arc.active_workers}</div>
                </div>
                <div>
                  <div className="text-slate-500">Komik</div>
                  <div className="font-mono tabular-nums font-semibold text-sm mt-0.5">{arc.total_comics}</div>
                </div>
                <div>
                  <div className="text-slate-500">Total Chapter</div>
                  <div className="font-mono tabular-nums font-semibold text-sm mt-0.5">
                    {arc.total_chapters}
                  </div>
                  <div className="text-slate-400 font-mono">
                    TL {arc.translator_chapters} · ED {arc.editor_chapters} · S {arc.solo_chapters}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Total Payroll</div>
                  <div className="font-mono tabular-nums font-semibold text-sm mt-0.5">
                    {formatIdr(arc.total_payroll_idr)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Sudah Dibayar</div>
                  <div className="font-mono tabular-nums font-semibold text-sm text-emerald-700 mt-0.5">
                    {formatIdr(arc.total_paid_idr)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Belum Dibayar</div>
                  <div className="font-mono tabular-nums font-semibold text-sm text-amber-700 mt-0.5">
                    {formatIdr(arc.total_unpaid_idr)}
                  </div>
                </div>
              </div>

              {arc.byComic.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-xs font-medium text-slate-600 mb-1.5">Pengeluaran per Komik</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700 font-mono tabular-nums">
                    {arc.byComic.map((c) => (
                      <span key={c.title}>
                        {c.title}: {c.chapters} ch ({formatIdr(c.amount_idr)})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {reopenTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Buka Kembali Periode {reopenTarget.period_key}
              </h2>
              <button type="button" onClick={() => setReopenTarget(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Tindakan khusus Owner ini akan dicatat di audit log beserta alasannya.
            </p>
            <form onSubmit={submitReopen} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Pembukaan Kembali (Wajib)</label>
                <input
                  type="text"
                  required
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Misal: Koreksi laporan tertinggal sebelum tutup buku"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setReopenTarget(null)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">Batal</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-amber-700 text-white rounded-lg cursor-pointer">Buka Periode</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
