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
import { RefreshCw } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, BotState, Period } from '../types.ts';

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

export function OverviewView({ user, periods, onNavigateReportsPending }: OverviewViewProps) {
  const nowJakarta = new Date(Date.now() + 7 * 3600 * 1000);
  const [selectedYear, setSelectedYear] = useState<number>(nowJakarta.getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(nowJakarta.getUTCMonth() + 1);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function loadOverview(year: number, month: number) {
    setLoading(true);
    try {
      const res = await apiFetch<OverviewResponse>(`/overview?year=${year}&month=${month}`);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview(selectedYear, selectedMonth);
  }, [selectedYear, selectedMonth]);

  async function handleManualSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await apiFetch<{ synced: boolean; reason?: string }>('/bot/sync', {
        method: 'POST',
      });
      setSyncMessage(
        res.synced
          ? 'Sinkronisasi pesan Discord selesai.'
          : res.reason || 'Bot dalam mode standby.'
      );
      await loadOverview(selectedYear, selectedMonth);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Gagal sinkronisasi.');
    } finally {
      setSyncing(false);
    }
  }

  const years = Array.from(
    new Set([nowJakarta.getUTCFullYear(), ...periods.map((p) => p.year)])
  ).sort((a, b) => b - a);

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];

  return (
    <div className="space-y-6">
      {/* Header Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Ringkasan Operasional Payroll
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Periode {monthNames[selectedMonth - 1]} {selectedYear} · Timezone Asia/Jakarta · Status {data?.period.status || 'OPEN'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter Bulan"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            {monthNames.map((name, idx) => (
              <option key={name} value={idx + 1}>
                {name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Tahun"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
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
              className="px-3.5 py-2 text-sm font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sync Checkpoint</span>
            </button>
          )}
        </div>
      </div>

      {syncMessage && (
        <div className="px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700">
          {syncMessage}
        </div>
      )}

      {/* KPI Metrics Grid */}
      {loading || !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Karyawan Aktif</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1.5 font-mono tabular-nums">
                {data.stats.activeEmployees}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {data.stats.totalProjects} proyek komik aktif
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Chapter Disetujui Bulan Ini</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1.5 font-mono tabular-nums">
                {data.stats.monthlyChapters}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Terhitung ke kalkulasi payroll
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Total Payroll Bulan Ini</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1.5 font-mono tabular-nums">
                {formatIdr(data.stats.totalPayrollIdr)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {data.stats.partialCount} karyawan dibayar sebagian
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Sudah Dibayar · Sisa</div>
              <div className="text-xl font-semibold text-emerald-700 mt-1.5 font-mono tabular-nums">
                {formatIdr(data.stats.totalPaidIdr)}
              </div>
              <div className="text-xs text-amber-700 mt-1 font-mono tabular-nums">
                Belum dibayar: {formatIdr(data.stats.totalUnpaidIdr)}
              </div>
            </div>
          </div>

          {/* Pending Banner + Bot Sync Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Antrian Laporan Pending Review
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Laporan dengan konflik komik, duplikat potensial, atau format ambigu tidak masuk payroll sebelum disetujui.
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateReportsPending}
                className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span className="font-mono tabular-nums mr-1.5">{data.stats.pendingReportsCount}</span>
                Pending
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Sinkronisasi Discord Gateway
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Status: <span className="font-medium text-slate-800">{data.botState.status}</span>
                  {' · '}
                  {data.checkpoints.length} channel checkpoint terpantau
                </p>
              </div>
              <div className="text-right text-xs text-slate-500 font-mono tabular-nums">
                {data.botState.botTag || 'Token Standby'}
              </div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Productivity */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">
                Produktivitas Chapter per Hari
              </h2>
              <div className="h-64">
                {data.charts.dailyProductivity.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">
                    Belum ada chapter disetujui pada periode ini.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.dailyProductivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="chapters" name="Chapter" fill="#0f172a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Worker Productivity */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">
                Produktivitas per Pekerja (Translator / Editor / Solo)
              </h2>
              <div className="h-64">
                {data.charts.workerProductivity.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">
                    Belum ada kontribusi pekerja pada periode ini.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.workerProductivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="translator" stackId="a" name="Translator" fill="#0f172a" />
                      <Bar dataKey="editor" stackId="a" name="Editor" fill="#475569" />
                      <Bar dataKey="solo" stackId="a" name="Solo" fill="#059669" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Monthly Expenses */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">
                Pengeluaran Payroll per Bulan (IDR)
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.charts.monthlyExpenses}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip formatter={(val) => formatIdr(Number(val ?? 0))} />
                    <Line
                      type="monotone"
                      dataKey="total_payroll_idr"
                      name="Total Payroll"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="paid_idr"
                      name="Sudah Dibayar"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chapters by Comic & Role Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">
                  Chapter per Komik
                </h2>
                <div className="h-60">
                  {data.charts.chaptersByComic.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-slate-400">
                      Kosong
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.charts.chaptersByComic} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                        <YAxis dataKey="title" type="category" width={95} tick={{ fontSize: 11, fill: '#334155' }} />
                        <Tooltip />
                        <Bar dataKey="chapters" name="Chapter" fill="#334155" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-900 mb-4">
                  Distribusi Role
                </h2>
                <div className="h-60">
                  {data.charts.roleDistribution.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-slate-400">
                      Kosong
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

          {/* Recent Activity Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Aktivitas Laporan Terbaru
              </h2>
              <span className="text-xs text-slate-500">10 pesan terakhir</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Waktu</th>
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
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap font-mono tabular-nums">
                        {formatJakartaDateTime(item.message_timestamp)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {item.employee_name}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                        {item.project_title || 'Ambigu'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate font-mono text-xs">
                        {item.raw_content}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                        {item.chapter_count}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900">
                        {formatIdr(item.approved_amount_idr)}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-xs">
                        {item.pending_count > 0 ? (
                          <span className="text-amber-700 font-medium">
                            Pending ({item.pending_count})
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Approved</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
