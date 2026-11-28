import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Search,
  Sliders,
  Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period, RoleName } from '../types.ts';
import { StatusBadge, useToast } from './ui/DashboardUI.tsx';

interface SheetRekapViewProps {
  user: AuthUser;
  periods: Period[];
}

type SubTabKey = 'monthly' | 'validated' | 'settings' | 'raw';

interface SummaryData {
  totalChapters: number;
  totalSalary: number;
  problemReportsCount: number;
  periodCode: string;
}

interface RoleSummary {
  role: string;
  rate: number;
  chapters: number;
  salary: number;
}

interface YearlySummaryItem {
  month: number;
  monthName: string;
  chapters: number;
  salary: number;
  isActive: boolean;
}

interface MemberSummary {
  employee_id: string;
  name: string;
  chapters: number;
  salary: number;
  payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  paid_amount: number;
  remaining_amount: number;
  payroll_record_id: string;
}

interface ValidatedReport {
  id: string;
  message_timestamp: string;
  name: string;
  role: RoleName;
  comic_title: string;
  chapter_number: number;
  period_key: string;
  rate: number;
  cek: string;
  normalized_name: string;
  duplicate_flag: boolean | number;
  amount_idr: number;
}

interface RawSubmission {
  id: string;
  timestamp: string;
  name: string;
  raw_content: string;
  parse_status: string;
  project_title: string | null;
  message_url: string | null;
}

interface RoleAliasItem {
  id: string;
  alias: string;
  role: RoleName;
}

const MONTH_NAMES = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' },
];

export function SheetRekapView({ user, periods: _periods }: SheetRekapViewProps) {
  const toast = useToast();
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(currentDate.getMonth() + 1);
  const [subTab, setSubTab] = useState<SubTabKey>('monthly');

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryData>({
    totalChapters: 0,
    totalSalary: 0,
    problemReportsCount: 0,
    periodCode: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
  });
  const [byRole, setByRole] = useState<RoleSummary[]>([]);
  const [yearlySummary, setYearlySummary] = useState<YearlySummaryItem[]>([]);
  const [byMember, setByMember] = useState<MemberSummary[]>([]);
  const [reports, setReports] = useState<ValidatedReport[]>([]);
  const [rawSubmissions, setRawSubmissions] = useState<RawSubmission[]>([]);
  const [_rates, setRates] = useState<Record<RoleName, number>>({ Translator: 3000, Editor: 3000, Solo: 6000 });
  const [roleAliases, setRoleAliases] = useState<RoleAliasItem[]>([]);

  // Filters for Validated Tab
  const [searchValidated, setSearchValidated] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterProblemOnly, setFilterProblemOnly] = useState(false);

  // Rate Editing state
  const [editingRates, setEditingRates] = useState<Record<RoleName, number>>({ Translator: 3000, Editor: 3000, Solo: 6000 });
  const [savingRate, setSavingRate] = useState<string | null>(null);

  // New Alias state
  const [newAlias, setNewAlias] = useState('');
  const [newAliasRole, setNewAliasRole] = useState<RoleName>('Translator');

  async function loadSheetData() {
    setLoading(true);
    try {
      const res = await apiFetch<{
        summary: SummaryData;
        byRole: RoleSummary[];
        yearlySummary: YearlySummaryItem[];
        byMember: MemberSummary[];
        reports: ValidatedReport[];
        rawSubmissions: RawSubmission[];
        rates: Record<RoleName, number>;
        roleAliases: RoleAliasItem[];
      }>(`/rekap-sheet?year=${selectedYear}&month=${selectedMonth}`);

      setSummary(res.summary);
      setByRole(res.byRole);
      setYearlySummary(res.yearlySummary);
      setByMember(res.byMember);
      setReports(res.reports);
      setRawSubmissions(res.rawSubmissions);
      setRates(res.rates);
      setEditingRates(res.rates);
      setRoleAliases(res.roleAliases);
    } catch (err) {
      toast.error('Gagal memuat Sheet Rekap', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSheetData();
  }, [selectedYear, selectedMonth]);

  async function handleUpdateRate(role: RoleName) {
    const val = Number(editingRates[role]);
    if (isNaN(val) || val < 0) {
      toast.error('Nilai tarif tidak valid.');
      return;
    }
    setSavingRate(role);
    try {
      const res = await apiFetch<{ rates: Record<RoleName, number> }>('/settings/rates', {
        method: 'PUT',
        body: JSON.stringify({ role, rateIdr: val }),
      });
      setRates(res.rates);
      setEditingRates(res.rates);
      toast.success(`Tarif ${role} berhasil diperbarui.`);
      void loadSheetData();
    } catch (err) {
      toast.error('Gagal memperbarui tarif', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingRate(null);
    }
  }

  async function handleAddAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!newAlias.trim()) return;
    try {
      await apiFetch('/settings/role-aliases', {
        method: 'POST',
        body: JSON.stringify({ alias: newAlias.trim(), role: newAliasRole }),
      });
      setNewAlias('');
      toast.success('Alias role berhasil ditambahkan.');
      void loadSheetData();
    } catch (err) {
      toast.error('Gagal menambah alias', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleDeleteAlias(id: string) {
    try {
      await apiFetch(`/settings/role-aliases/${id}`, { method: 'DELETE' });
      toast.success('Alias berhasil dihapus.');
      void loadSheetData();
    } catch (err) {
      toast.error('Gagal menghapus alias', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleQuickPay(recordId: string, remaining: number) {
    if (remaining <= 0) return;
    try {
      await apiFetch('/payroll/pay', {
        method: 'POST',
        body: JSON.stringify({
          payrollRecordId: recordId,
          amountIdr: remaining,
          method: 'Bank Transfer',
          transactionRef: `SHEET-PAY-${Date.now()}`,
          notes: 'Pelunasan cepat via Sheet Rekap',
        }),
      });
      toast.success('Pembayaran lunas dicatat.');
      void loadSheetData();
    } catch (err) {
      toast.error('Gagal mencatat pembayaran', err instanceof Error ? err.message : undefined);
    }
  }

  function exportToExcel() {
    try {
      const wb = XLSX.utils.book_new();

      const wsRole = XLSX.utils.json_to_sheet(
        byRole.map((r) => ({
          Role: r.role,
          'Tarif (Rp)': r.rate,
          'Total Chapter': r.chapters,
          'Total Gaji (Rp)': r.salary,
        }))
      );
      XLSX.utils.book_append_sheet(wb, wsRole, 'Rekap Role');

      const wsMember = XLSX.utils.json_to_sheet(
        byMember.map((m) => ({
          'Nama Anggota': m.name,
          'Total Chapter': m.chapters,
          'Total Gaji (Rp)': m.salary,
          'Sudah Dibayar (Rp)': m.paid_amount,
          'Sisa Belum Bayar (Rp)': m.remaining_amount,
          'Status Bayar': m.payment_status,
        }))
      );
      XLSX.utils.book_append_sheet(wb, wsMember, 'Rekap Anggota');

      const wsReports = XLSX.utils.json_to_sheet(
        reports.map((r) => ({
          Timestamp: r.message_timestamp,
          Nama: r.name,
          Role: r.role,
          'Judul Komik': r.comic_title,
          Chapter: r.chapter_number,
          Periode: r.period_key,
          Tarif: r.rate,
          Status: r.cek,
          'Nominal (Rp)': r.amount_idr,
        }))
      );
      XLSX.utils.book_append_sheet(wb, wsReports, 'Laporan Tervalidasi');

      XLSX.writeFile(wb, `ComicPay-SheetRekap-${summary.periodCode}.xlsx`);
      toast.success('File Excel berhasil diunduh.');
    } catch (err) {
      toast.error('Gagal mengexport Excel', err instanceof Error ? err.message : undefined);
    }
  }

  const filteredReports = reports.filter((r) => {
    if (filterRole && r.role !== filterRole) return false;
    if (filterProblemOnly && r.cek !== 'pending' && !r.duplicate_flag) return false;
    if (searchValidated.trim()) {
      const q = searchValidated.trim().toLowerCase();
      const matchName = r.name.toLowerCase().includes(q);
      const matchComic = r.comic_title.toLowerCase().includes(q);
      if (!matchName && !matchComic) return false;
    }
    return true;
  });

  function getRoleBadgeStyle(role: string) {
    switch (role) {
      case 'Translator':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Editor':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Solo':
        return 'bg-teal-50 text-teal-700 border-teal-200';
      case 'Bonus':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  }

  function getPaymentBadge(status: string) {
    switch (status) {
      case 'PAID':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md">Lunas</span>;
      case 'PARTIALLY_PAID':
        return <span className="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-md">Sebagian</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-md">Belum Dibayar</span>;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2.5">
            <FileSpreadsheet className="w-7 h-7 text-indigo-600" />
            <span>Sheet Rekap (Jajan Staff)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Pusat pemantauan payroll komik gaya spreadsheet Google Sheets dalam satu tampilan terstruktur, transparan, dan real-time.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Bulan:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="text-xs font-semibold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
            >
              {MONTH_NAMES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Tahun:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="text-xs font-semibold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
            >
              {[2024, 2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={exportToExcel}
            className="px-3.5 py-2 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg inline-flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            onClick={() => void loadSheetData()}
            className="p-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 shadow-sm cursor-pointer"
            title="Muat Ulang Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Chapter Periode</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {summary.totalChapters.toLocaleString('id-ID')} <span className="text-xs font-sans text-slate-500 font-normal">Ch</span>
            </div>
            <div className="text-xs text-indigo-600 mt-1 font-medium">Periode {summary.periodCode}</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <FileText className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Gaji (Net)</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {formatIdr(summary.totalSalary)}
            </div>
            <div className="text-xs text-emerald-600 mt-1 font-medium">Siap / Telah Diproses</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CreditCard className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Laporan Bermasalah</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
              {summary.problemReportsCount} <span className="text-xs font-sans text-slate-500 font-normal">Laporan</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubTab('validated');
                setFilterProblemOnly(true);
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-1 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Periksa sekarang</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="bg-slate-100/80 border-b border-slate-200 px-4 flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('monthly')}
            className={`px-4 py-3 text-xs font-semibold flex items-center gap-2 border-t-2 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'monthly'
                ? 'bg-white text-indigo-700 border-indigo-600 shadow-sm'
                : 'text-slate-600 border-transparent hover:bg-slate-200/50 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>1. Rekap Gaji Bulanan (Utama)</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('validated')}
            className={`px-4 py-3 text-xs font-semibold flex items-center gap-2 border-t-2 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'validated'
                ? 'bg-white text-indigo-700 border-indigo-600 shadow-sm'
                : 'text-slate-600 border-transparent hover:bg-slate-200/50 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>2. Data Laporan (Log Tervalidasi)</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('settings')}
            className={`px-4 py-3 text-xs font-semibold flex items-center gap-2 border-t-2 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'settings'
                ? 'bg-white text-indigo-700 border-indigo-600 shadow-sm'
                : 'text-slate-600 border-transparent hover:bg-slate-200/50 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>3. Pengaturan Tarif & Alias Nama</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('raw')}
            className={`px-4 py-3 text-xs font-semibold flex items-center gap-2 border-t-2 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'raw'
                ? 'bg-white text-indigo-700 border-indigo-600 shadow-sm'
                : 'text-slate-600 border-transparent hover:bg-slate-200/50 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>4. Log Masuk Mentah (Raw)</span>
          </button>
        </div>

        <div className="p-5">
          {subTab === 'monthly' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Rekap Per Role ({summary.periodCode})</h3>
                    <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded font-mono">
                      {byRole.reduce((s, r) => s + r.chapters, 0)} Ch
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="text-slate-500 bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Role</th>
                          <th className="py-2.5 px-4 font-medium text-right">Tarif (Rp)</th>
                          <th className="py-2.5 px-4 font-medium text-right">Chapter</th>
                          <th className="py-2.5 px-4 font-medium text-right">Gaji (Rp)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {byRole.map((item) => (
                          <tr key={item.role} className="hover:bg-indigo-50/40 transition-colors even:bg-slate-50/60">
                            <td className="py-3 px-4">
                              <span className={`px-2.5 py-1 text-xs font-semibold rounded-md border ${getRoleBadgeStyle(item.role)}`}>
                                {item.role}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                              {formatIdr(item.rate)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {item.chapters}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                              {formatIdr(item.salary)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-100/80 border-t border-slate-200 font-bold text-slate-900">
                        <tr>
                          <td className="py-3 px-4">TOTAL</td>
                          <td className="py-3 px-4 text-right">-</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {byRole.reduce((s, r) => s + r.chapters, 0)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-indigo-700">
                            {formatIdr(byRole.reduce((s, r) => s + r.salary, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Ringkasan Tahunan ({selectedYear})</h3>
                    <span className="text-xs bg-white/20 px-2.5 py-0.5 rounded font-mono">12 Bulan</span>
                  </div>
                  <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="text-slate-500 bg-slate-50 border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Bulan</th>
                          <th className="py-2.5 px-4 font-medium text-right">Chapter</th>
                          <th className="py-2.5 px-4 font-medium text-right">Gaji (Rp)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {yearlySummary.map((y) => (
                          <tr
                            key={y.month}
                            className={`transition-colors ${
                              y.isActive ? 'bg-indigo-50/80 font-semibold' : 'hover:bg-indigo-50/40 even:bg-slate-50/60'
                            }`}
                          >
                            <td className="py-2.5 px-4 flex items-center gap-2">
                              <span>{y.monthName}</span>
                              {y.isActive && (
                                <span className="px-1.5 py-0.5 text-[10px] font-sans bg-indigo-600 text-white rounded">
                                  Aktif
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800">
                              {y.chapters}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 font-semibold">
                              {formatIdr(y.salary)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-100/80 border-t border-slate-200 font-bold text-slate-900 sticky bottom-0">
                        <tr>
                          <td className="py-3 px-4">TOTAL TAHUNAN</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums">
                            {yearlySummary.reduce((s, y) => s + y.chapters, 0)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-indigo-700">
                            {formatIdr(yearlySummary.reduce((s, y) => s + y.salary, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Rekap Per Anggota Staf ({summary.periodCode})</h3>
                  <span className="text-xs text-slate-500 font-mono">{byMember.length} Anggota</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="text-slate-500 bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 font-medium">Nama Anggota</th>
                        <th className="py-3 px-4 font-medium text-right">Total Chapter</th>
                        <th className="py-3 px-4 font-medium text-right">Total Gaji (Rp)</th>
                        <th className="py-3 px-4 font-medium text-right">Sudah Dibayar</th>
                        <th className="py-3 px-4 font-medium text-right">Sisa Hutang</th>
                        <th className="py-3 px-4 font-medium text-center">Status Bayar</th>
                        <th className="py-3 px-4 font-medium text-right">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {byMember.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            Belum ada rekap anggota untuk periode ini.
                          </td>
                        </tr>
                      ) : (
                        byMember.map((m) => (
                          <tr key={m.employee_id} className="hover:bg-indigo-50/40 transition-colors even:bg-slate-50/60">
                            <td className="py-3 px-4 font-semibold text-slate-900">{m.name}</td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {m.chapters}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                              {formatIdr(m.salary)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700">
                              {formatIdr(m.paid_amount)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-rose-700 font-semibold">
                              {formatIdr(m.remaining_amount)}
                            </td>
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {getPaymentBadge(m.payment_status)}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {m.remaining_amount > 0 && user.role !== 'Viewer' ? (
                                <button
                                  type="button"
                                  onClick={() => void handleQuickPay(m.payroll_record_id, m.remaining_amount)}
                                  className="px-2.5 py-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-md cursor-pointer"
                                >
                                  Lunasi Sisa
                                </button>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {subTab === 'validated' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchValidated}
                      onChange={(e) => setSearchValidated(e.target.value)}
                      placeholder="Cari nama atau judul komik..."
                      className="pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg w-full sm:w-60 focus:outline-none focus:border-indigo-600"
                    />
                  </div>

                  <select
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                  >
                    <option value="">Semua Role</option>
                    <option value="Translator">Translator</option>
                    <option value="Editor">Editor</option>
                    <option value="Solo">Solo</option>
                  </select>

                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer px-2">
                    <input
                      type="checkbox"
                      checked={filterProblemOnly}
                      onChange={(e) => setFilterProblemOnly(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Hanya Bermasalah / Pending</span>
                  </label>
                </div>

                <div className="text-xs text-slate-500 font-mono">
                  Menampilkan {filteredReports.length} dari {reports.length} entri
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-medium">Timestamp (WIB)</th>
                      <th className="py-3 px-4 font-medium">Nama Anggota</th>
                      <th className="py-3 px-4 font-medium">Role</th>
                      <th className="py-3 px-4 font-medium">Judul Komik</th>
                      <th className="py-3 px-4 font-medium text-center">Chapter</th>
                      <th className="py-3 px-4 font-medium text-center">Periode</th>
                      <th className="py-3 px-4 font-medium text-right">Tarif</th>
                      <th className="py-3 px-4 font-medium text-center">Status Cek</th>
                      <th className="py-3 px-4 font-medium">Nama Dibakukan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredReports.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-500">
                          Tidak ada data laporan yang cocok dengan filter.
                        </td>
                      </tr>
                    ) : (
                      filteredReports.map((r) => (
                        <tr key={r.id} className="hover:bg-indigo-50/40 transition-colors even:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                            {formatJakartaDateTime(r.message_timestamp)}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{r.name}</td>
                          <td className="py-2.5 px-4">
                            <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${getRoleBadgeStyle(r.role)}`}>
                              {r.role}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-800">{r.comic_title}</td>
                          <td className="py-2.5 px-4 text-center font-mono tabular-nums font-bold text-slate-900">
                            Ch. {r.chapter_number}
                            {Boolean(r.duplicate_flag) && (
                              <span className="ml-1.5 px-1 py-0.5 text-[10px] bg-rose-50 text-rose-700 border border-rose-200 rounded">
                                Dup
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-center font-mono text-slate-600">{r.period_key}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                            {formatIdr(r.rate)}
                          </td>
                          <td className="py-2.5 px-4 text-center whitespace-nowrap">
                            <StatusBadge status={r.cek} />
                          </td>
                          <td className="py-2.5 px-4 text-slate-700 font-medium">{r.normalized_name}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {subTab === 'settings' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
                    Pengaturan Tarif Chapter per Role (Rp)
                  </h3>
                  <div className="space-y-4">
                    {(['Translator', 'Editor', 'Solo'] as RoleName[]).map((role) => (
                      <div key={role} className="flex items-center justify-between gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-800">{role}</label>
                          <span className="text-[11px] text-slate-500">Berlaku untuk chapter baru</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={500}
                            value={editingRates[role]}
                            onChange={(e) =>
                              setEditingRates((prev) => ({ ...prev, [role]: Number(e.target.value) }))
                            }
                            className="w-32 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg text-right"
                          />
                          {user.role !== 'Viewer' && (
                            <button
                              type="button"
                              disabled={savingRate === role}
                              onClick={() => void handleUpdateRate(role)}
                              className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                            >
                              {savingRate === role ? 'Menyimpan...' : 'Simpan'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
                    Pemetaan Alias & Normalisasi Nama
                  </h3>
                  {user.role !== 'Viewer' && (
                    <form onSubmit={handleAddAlias} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Alias / typo nama di Discord..."
                        value={newAlias}
                        onChange={(e) => setNewAlias(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                      />
                      <select
                        value={newAliasRole}
                        onChange={(e) => setNewAliasRole(e.target.value as RoleName)}
                        className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="Translator">Translator</option>
                        <option value="Editor">Editor</option>
                        <option value="Solo">Solo</option>
                      </select>
                      <button
                        type="submit"
                        className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer"
                      >
                        Tambah
                      </button>
                    </form>
                  )}

                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                    {roleAliases.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500">Belum ada alias terdaftar.</div>
                    ) : (
                      roleAliases.map((a) => (
                        <div key={a.id} className="p-2.5 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-semibold text-slate-900">{a.alias}</span>
                            <span className="text-slate-400 mx-2">→</span>
                            <span className="text-indigo-600 font-medium">{a.role}</span>
                          </div>
                          {user.role !== 'Viewer' && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteAlias(a.id)}
                              className="text-rose-600 hover:text-rose-800 text-[11px] cursor-pointer"
                            >
                              Hapus
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {subTab === 'raw' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500">
                Daftar pesan laporan mentah yang masuk dari bot Discord sebelum atau sesudah diparsing, untuk audit silang selisih angka.
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-medium">Timestamp (WIB)</th>
                      <th className="py-3 px-4 font-medium">Pengirim</th>
                      <th className="py-3 px-4 font-medium">Isi Pesan Mentah</th>
                      <th className="py-3 px-4 font-medium">Status Parse</th>
                      <th className="py-3 px-4 font-medium">Komik Deteksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rawSubmissions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          Tidak ada log pesan mentah pada periode ini.
                        </td>
                      </tr>
                    ) : (
                      rawSubmissions.map((rs) => (
                        <tr key={rs.id} className="hover:bg-indigo-50/40 transition-colors even:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                            {formatJakartaDateTime(rs.timestamp)}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{rs.name}</td>
                          <td className="py-2.5 px-4 font-mono text-slate-800 max-w-xs truncate">{rs.raw_content}</td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                                rs.parse_status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {rs.parse_status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">{rs.project_title || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
