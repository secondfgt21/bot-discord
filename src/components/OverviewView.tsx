import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileText,
  Radio,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, BotState, Period } from '../types.ts';
import { EmptyState, StatusBadge, useToast } from './ui/DashboardUI.tsx';

interface OverviewResponse {
  period: Period;
  stats: {
    activeEmployees: number;
    totalProjects: number;
    monthlyChapters: number;
    totalPayrollIdr: number;
    totalPaidIdr: number;
    totalUnpaidIdr: number;
    partialCount: number;
    pendingReportsCount: number;
  };
  charts: {
    dailyProductivity: Array<{ date: string; chapters: number; amount_idr: number }>;
    workerProductivity: Array<{
      name: string;
      translator: number;
      editor: number;
      solo: number;
      total: number;
    }>;
    monthlyExpenses: Array<{ period: string; total_payroll_idr: number; paid_idr: number; chapters: number }>;
    chaptersByComic: Array<{ title: string; chapters: number; amount_idr: number }>;
    roleDistribution: Array<{ role: string; chapters: number; amount_idr: number }>;
  };
  recentActivity: Array<{
    id: string;
    raw_content: string;
    parse_status: string;
    message_timestamp: string;
    employee_name: string;
    project_title: string | null;
    chapter_count: number;
    pending_count: number;
    approved_amount_idr: number;
  }>;
  botState: BotState;
  checkpoints: Array<{
    id: string;
    discord_channel_id: string;
    channel_name: string;
    last_message_id: string | null;
    last_synced_at: string | null;
    sync_status: string;
  }>;
}

interface OverviewViewProps {
  user: AuthUser;
  periods: Period[];
  onNavigateReportsPending: () => void;
}

const ROLE_COLORS = ['#0f172a', '#475569', '#059669'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function OverviewView({ user, periods, onNavigateReportsPending }: OverviewViewProps) {
  const toast = useToast();
  const nowJakarta = new Date(Date.now() + 7 * 3600 * 1000);
  const [selectedYear, setSelectedYear] = useState<number>(nowJakarta.getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(nowJakarta.getUTCMonth() + 1);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function loadOverview(year: number, month: number) {
    setLoading(true);
    try {
      const res = await apiFetch<OverviewResponse>(`/overview?year=${year}&month=${month}`);
      setData(res);
    } catch (err) {
      toast.error('Gagal memuat ringkasan', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview(selectedYear, selectedMonth);
  }, [selectedYear, selectedMonth]);

  async function handleManualSync() {
    setSyncing(true);
    try {
      const res = await apiFetch<{ synced: boolean; reason?: string }>('/bot/sync', {
        method: 'POST',
      });
      if (res.synced) {
        toast.success('Sinkronisasi Discord selesai', 'Checkpoint channel telah diperbarui.');
      } else {
        toast.info('Bot dalam mode standby', res.reason || 'Token bot belum aktif.');
      }
      await loadOverview(selectedYear, selectedMonth);
    } catch (err) {
      toast.error('Gagal sinkronisasi Discord', err instanceof Error ? err.message : undefined);
    } finally {
      setSyncing(false);
    }
  }

  const years = Array.from(
    new Set([nowJakarta.getUTCFullYear(), ...periods.map((p) => p.year)])
  ).sort((a, b) => b - a);

  const paidPct =
    data && data.stats.totalPayrollIdr > 0
      ? Math.min(100, Math.round((data.stats.totalPaidIdr / data.stats.totalPayrollIdr) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Header & Period Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Ringkasan Operasional
            </h1>
            {data?.period && <StatusBadge status={data.period.status} />}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Periode {MONTH_NAMES[selectedMonth - 1]} {selectedYear} · Zona waktu Asia/Jakarta (WIB)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter Bulan"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={name} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Tahun"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 font-mono focus:outline-none focus:border-slate-900"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          {user.role !== 'Viewer' && (
            <button
              type="button"
              onClick={handleManualSync}
              disabled={syncing}
              className="px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync Checkpoint</span>
            </button>
          )}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading || !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
                <div className="h-3.5 w-28 bg-slate-200 rounded animate-pulse" />
                <div className="h-7 w-36 bg-slate-200 rounded animate-pulse" />
                <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
          </div>
        </div>
      ) : (
        <>
          {/* KPI Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Karyawan Aktif</span>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-semibold text-slate-900 mt-2 font-mono tabular-nums">
                {data.stats.activeEmployees}
              </div>
              <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                <span>{data.stats.totalProjects} proyek komik aktif</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Chapter Disetujui</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-semibold text-slate-900 mt-2 font-mono tabular-nums">
                {data.stats.monthlyChapters}
              </div>
              <div className="text-xs text-slate-500 mt-1.5">
                Masuk kalkulasi payroll periode ini
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Total Payroll</span>
                <Wallet className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-semibold text-slate-900 mt-2 font-mono tabular-nums">
                {formatIdr(data.stats.totalPayrollIdr)}
              </div>
              <div className="text-xs text-slate-500 mt-1.5">
                {data.stats.partialCount} karyawan dibayar sebagian
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Realisasi Pembayaran</span>
                <span className="font-mono tabular-nums font-semibold text-slate-700">{paidPct}%</span>
              </div>
              <div className="text-xl font-semibold text-emerald-700 mt-2 font-mono tabular-nums">
                {formatIdr(data.stats.totalPaidIdr)}
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${paidPct}%` }}
                />
              </div>
              <div className="text-xs text-amber-700 mt-1.5 font-mono tabular-nums">
                Sisa: {formatIdr(data.stats.totalUnpaidIdr)}
              </div>
            </div>
          </div>

          {/* Pending Review CTA + Bot Sync */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    data.stats.pendingReportsCount > 0
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Antrian Laporan Pending Review
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Duplikat chapter (komik &amp; role sama) atau format ambigu otomatis ditahan di Pending hingga diverifikasi admin.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onNavigateReportsPending}
                className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <span className="font-mono tabular-nums">{data.stats.pendingReportsCount}</span>
                <span>Pending</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Sinkronisasi Discord Gateway
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Status:{' '}
                    <span className="font-medium text-slate-800">{data.botState.status}</span> ·{' '}
                    <span className="font-mono tabular-nums">{data.checkpoints.length}</span> channel terpantau
                  </p>
                </div>
              </div>
              <div className="text-left sm:text-right text-xs text-slate-600 font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shrink-0">
                {data.botState.botTag || 'Token Standby'}
              </div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-900">Produktivitas Chapter per Hari</h2>
                <span className="text-xs text-slate-500">Harian (WIB)</span>
              </div>
              <div className="h-64">
                {data.charts.dailyProductivity.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    Belum ada chapter disetujui pada periode ini.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.dailyProductivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="chapters" name="Chapter" fill="#0f172a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-900">Produktivitas per Pekerja</h2>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-xs bg-slate-900" />TL</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-xs bg-slate-500" />ED</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" />Solo</span>
                </div>
              </div>
              <div className="h-64">
                {data.charts.workerProductivity.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    Belum ada kontribusi pekerja pada periode ini.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.workerProductivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="translator" stackId="a" name="Translator" fill="#0f172a" />
                      <Bar dataKey="editor" stackId="a" name="Editor" fill="#64748b" />
                      <Bar dataKey="solo" stackId="a" name="Solo" fill="#059669" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-900">Tren Pengeluaran Payroll (IDR)</h2>
                <span className="text-xs text-slate-500">Per Bulan</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.charts.monthlyExpenses}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip formatter={(val) => formatIdr(Number(val ?? 0))} />
                    <Line
                      type="monotone"
                      dataKey="total_payroll_idr"
                      name="Total Payroll"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={{ r: 3.5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="paid_idr"
                      name="Sudah Dibayar"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={{ r: 3.5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">Chapter per Komik</h2>
                <div className="h-60">
                  {data.charts.chaptersByComic.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Belum ada data
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.charts.chaptersByComic} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                        <YAxis dataKey="title" type="category" width={90} tick={{ fontSize: 11, fill: '#334155' }} />
                        <Tooltip />
                        <Bar dataKey="chapters" name="Chapter" fill="#334155" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">Distribusi Role</h2>
                <div className="h-60">
                  {data.charts.roleDistribution.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400">
                      Belum ada data
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.charts.roleDistribution}
                          dataKey="chapters"
                          nameKey="role"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={70}
                          paddingAngle={2}
                        >
                          {data.charts.roleDistribution.map((_, idx) => (
                            <Cell key={idx} fill={ROLE_COLORS[idx % ROLE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity Section */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Aktivitas Laporan Terbaru</h2>
                <p className="text-xs text-slate-500 mt-0.5">10 pesan laporan terakhir yang diproses bot</p>
              </div>
            </div>

            {data.recentActivity.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<FileText className="w-5 h-5" />}
                  title="Belum ada laporan pada periode ini"
                  description="Laporan yang dikirim pekerja di channel Discord akan muncul secara otomatis di sini."
                />
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-4 font-medium">Waktu (WIB)</th>
                        <th className="py-2.5 px-4 font-medium">Pekerja</th>
                        <th className="py-2.5 px-4 font-medium">Komik</th>
                        <th className="py-2.5 px-4 font-medium">Pesan Asli</th>
                        <th className="py-2.5 px-4 font-medium text-right">Chapter</th>
                        <th className="py-2.5 px-4 font-medium text-right">Nominal</th>
                        <th className="py-2.5 px-4 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentActivity.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap font-mono tabular-nums">
                            {formatJakartaDateTime(item.message_timestamp)}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                            {item.employee_name}
                          </td>
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                            {item.project_title || 'Belum Ditentukan'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 max-w-xs truncate font-mono text-xs">
                            {item.raw_content}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                            {item.chapter_count}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">
                            {formatIdr(item.approved_amount_idr)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {item.pending_count > 0 ? (
                              <StatusBadge status="pending" label={`Pending (${item.pending_count})`} />
                            ) : (
                              <StatusBadge status="auto_approved" label="Sukses Tercatat" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List */}
                <div className="md:hidden divide-y divide-slate-100">
                  {data.recentActivity.map((item) => (
                    <div key={item.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{item.employee_name}</div>
                          <div className="text-xs text-slate-500 font-mono tabular-nums">
                            {formatJakartaDateTime(item.message_timestamp)} WIB
                          </div>
                        </div>
                        {item.pending_count > 0 ? (
                          <StatusBadge status="pending" label={`Pending (${item.pending_count})`} />
                        ) : (
                          <StatusBadge status="auto_approved" label="Sukses Tercatat" />
                        )}
                      </div>
                      <div className="text-xs font-medium text-slate-800">
                        {item.project_title || 'Belum Ditentukan'}
                      </div>
                      <div className="text-xs font-mono text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 break-words">
                        {item.raw_content}
                      </div>
                      <div className="flex items-center justify-between text-xs pt-0.5">
                        <span className="text-slate-500 font-mono tabular-nums">
                          {item.chapter_count} chapter
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {formatIdr(item.approved_amount_idr)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
