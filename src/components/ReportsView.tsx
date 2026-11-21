import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Filter,
  History,
  Loader2,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period, RoleName } from '../types.ts';
import {
  CardSkeletonGrid,
  ConfirmModal,
  EmptyState,
  PaginationBar,
  StatusBadge,
  useToast,
} from './ui/DashboardUI.tsx';

interface ChapterRow {
  id: string;
  report_id: string;
  project_id: string | null;
  project_title: string | null;
  chapter_number: number;
  role: RoleName | null;
  unit_rate_idr: number;
  amount_idr: number;
  approval_status: 'auto_approved' | 'approved' | 'pending' | 'rejected' | 'void';
  duplicate_flag: boolean | number;
  duplicate_of_chapter_id: string | null;
}

interface ReportRow {
  id: string;
  period_key: string;
  employee_name: string;
  author_username: string;
  discord_author_id: string;
  discord_channel_id: string;
  discord_message_id: string;
  raw_content: string;
  message_url: string;
  message_timestamp: string;
  parse_status: string;
  parse_notes_json: string | string[];
  is_deleted: boolean | number;
  chapters: ChapterRow[];
}

interface ReportsViewProps {
  user: AuthUser;
  periods: Period[];
  initialStatusFilter?: string;
}

const STATUS_TABS = [
  { value: '', label: 'Semua' },
  { value: 'pending', label: 'Pending' },
  { value: 'auto_approved', label: 'Sukses Tercatat' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'void', label: 'Void' },
];

export function ReportsView({ user, periods, initialStatusFilter = '' }: ReportsViewProps) {
  const toast = useToast();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<
    Array<{ id: string; display_name: string; discord_user_id: string; discord_username: string }>
  >([]);
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [channels, setChannels] = useState<Array<{ discord_channel_id: string; channel_name: string }>>([]);

  // Active Filters
  const [periodId, setPeriodId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState(initialStatusFilter);
  const [channelId, setChannelId] = useState('');
  const [chapterFilter, setChapterFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);

  // Confirm Modal state for approve/reject/void
  const [confirmAction, setConfirmAction] = useState<{
    action: 'approve' | 'reject' | 'void';
    ids: string[];
    title: string;
    description: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Correction Modal
  const [editingChapter, setEditingChapter] = useState<ChapterRow | null>(null);
  const [editProjectId, setEditProjectId] = useState('');
  const [editRole, setEditRole] = useState<RoleName>('Translator');
  const [editChapterNum, setEditChapterNum] = useState(1);
  const [editStatus, setEditStatus] = useState<'approved' | 'rejected' | 'void' | 'pending'>('approved');
  const [editReason, setEditReason] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // History Drawer
  const [historyReportId, setHistoryReportId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEvents, setHistoryEvents] = useState<
    Array<{ id: string; event_type: string; actor_type: string; actor_id: string; reason: string; created_at: string }>
  >([]);

  // Manual Ingest Modal
  const [showIngest, setShowIngest] = useState(false);
  const [ingestChannelId, setIngestChannelId] = useState('');
  const [ingestAuthorId, setIngestAuthorId] = useState('');
  const [ingestContent, setIngestContent] = useState('');
  const [ingestSubmitting, setIngestSubmitting] = useState(false);

  useEffect(() => {
    setStatus(initialStatusFilter);
    setPage(1);
  }, [initialStatusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void (async () => {
      try {
        const [empRes, projRes] = await Promise.all([
          apiFetch<{
            employees: Array<{
              id: string;
              display_name: string;
              discord_user_id: string;
              discord_username: string;
            }>;
          }>('/employees'),
          apiFetch<{
            projects: Array<{ id: string; title: string }>;
            allChannelMappings: Array<{ discord_channel_id: string; channel_name: string }>;
          }>('/projects'),
        ]);
        setEmployees(empRes.employees);
        setProjects(projRes.projects);
        const uniqueCh = new Map<string, string>();
        for (const c of projRes.allChannelMappings) {
          uniqueCh.set(c.discord_channel_id, c.channel_name || c.discord_channel_id);
        }
        const chList = Array.from(uniqueCh.entries()).map(([id, name]) => ({
          discord_channel_id: id,
          channel_name: name,
        }));
        setChannels(chList);
        if (chList.length > 0) setIngestChannelId((prev) => prev || chList[0].discord_channel_id);
        if (empRes.employees.length > 0) setIngestAuthorId((prev) => prev || empRes.employees[0].discord_user_id);
      } catch (err) {
        toast.error('Gagal memuat opsi filter', err instanceof Error ? err.message : undefined);
      }
    })();
  }, []);

  async function loadReports(targetPage = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(targetPage), pageSize: '15' });
      if (periodId) params.set('periodId', periodId);
      if (memberId) params.set('memberId', memberId);
      if (projectId) params.set('projectId', projectId);
      if (role) params.set('role', role);
      if (status) params.set('status', status);
      if (channelId) params.set('channelId', channelId);
      if (chapterFilter) params.set('chapter', chapterFilter);
      if (dateFilter) params.set('date', dateFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch<{
        reports: ReportRow[];
        pagination: { page: number; totalPages: number; total: number };
      }>(`/reports?${params.toString()}`);

      setReports(res.reports);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
    } catch (err) {
      toast.error('Gagal memuat laporan', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports(page);
  }, [page, periodId, memberId, projectId, role, status, channelId, chapterFilter, dateFilter, search]);

  const hasActiveFilters = Boolean(
    periodId || memberId || projectId || role || status || channelId || chapterFilter || dateFilter || searchInput
  );

  function resetAllFilters() {
    setPeriodId('');
    setMemberId('');
    setProjectId('');
    setRole('');
    setStatus('');
    setChannelId('');
    setChapterFilter('');
    setDateFilter('');
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  function toggleChapterSelection(chId: string) {
    setSelectedChapterIds((prev) =>
      prev.includes(chId) ? prev.filter((id) => id !== chId) : [...prev, chId]
    );
  }

  function requestApprovalAction(action: 'approve' | 'reject' | 'void', ids = selectedChapterIds) {
    if (ids.length === 0) return;
    const labelMap = {
      approve: {
        title: `Setujui ${ids.length} Entri Chapter?`,
        description:
          'Chapter yang disetujui akan langsung masuk ke perhitungan payroll pekerja untuk periode terkait.',
      },
      reject: {
        title: `Tolak ${ids.length} Entri Chapter?`,
        description:
          'Chapter yang ditolak tidak dihitung ke payroll dan akan membebaskan nomor chapter agar dapat dilaporkan ulang secara sah.',
      },
      void: {
        title: `Void ${ids.length} Entri Chapter?`,
        description:
          'Entri chapter akan dibatalkan (void) dan payroll terkait akan dihitung ulang secara otomatis.',
      },
    };
    setConfirmAction({
      action,
      ids,
      title: labelMap[action].title,
      description: labelMap[action].description,
    });
  }

  async function executeApprovalAction() {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      const res = await apiFetch<{ updatedCount: number }>('/reports/chapters/bulk-approval', {
        method: 'POST',
        body: JSON.stringify({
          chapterIds: confirmAction.ids,
          action: confirmAction.action,
          reason:
            confirmAction.action === 'approve'
              ? 'Disetujui melalui dashboard admin'
              : `Aksi ${confirmAction.action} oleh admin`,
        }),
      });
      setSelectedChapterIds((prev) => prev.filter((id) => !confirmAction.ids.includes(id)));
      setConfirmAction(null);
      toast.success(
        `${res.updatedCount} chapter berhasil di-${confirmAction.action}`,
        'Perhitungan payroll telah diperbarui.'
      );
      await loadReports(page);
    } catch (err) {
      toast.error('Gagal memproses aksi', err instanceof Error ? err.message : undefined);
    } finally {
      setActionLoading(false);
    }
  }

  function openChapterEdit(ch: ChapterRow) {
    setEditingChapter(ch);
    setEditProjectId(ch.project_id || (projects[0]?.id ?? ''));
    setEditRole(ch.role || 'Translator');
    setEditChapterNum(ch.chapter_number || 1);
    setEditStatus(ch.approval_status === 'auto_approved' ? 'approved' : ch.approval_status);
    setEditReason('');
  }

  async function submitChapterEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingChapter) return;
    setEditSaving(true);
    try {
      await apiFetch(`/reports/chapters/${editingChapter.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          projectId: editProjectId || undefined,
          role: editRole,
          chapterNumber: Number(editChapterNum),
          approvalStatus: editStatus,
          reason: editReason,
        }),
      });
      setEditingChapter(null);
      toast.success('Koreksi chapter disimpan', 'Payroll terkait telah dihitung ulang.');
      await loadReports(page);
    } catch (err) {
      toast.error('Gagal menyimpan koreksi', err instanceof Error ? err.message : undefined);
    } finally {
      setEditSaving(false);
    }
  }

  async function openHistory(reportId: string) {
    setHistoryReportId(reportId);
    setHistoryLoading(true);
    try {
      const res = await apiFetch<{
        events: Array<{
          id: string;
          event_type: string;
          actor_type: string;
          actor_id: string;
          reason: string;
          created_at: string;
        }>;
      }>(`/reports/${reportId}`);
      setHistoryEvents(res.events);
    } catch (err) {
      toast.error('Gagal memuat histori laporan', err instanceof Error ? err.message : undefined);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleIngestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIngestSubmitting(true);
    const emp = employees.find((x) => x.discord_user_id === ingestAuthorId);
    try {
      const res = await apiFetch<{
        outcome: string;
        parseStatus?: string;
        approvalSummary?: string;
        isPending?: boolean;
        pendingReason?: string | null;
      }>('/reports/ingest', {
        method: 'POST',
        body: JSON.stringify({
          discordChannelId: ingestChannelId,
          discordAuthorId: ingestAuthorId,
          authorUsername: emp?.discord_username || 'worker',
          authorDisplayName: emp?.display_name || 'Discord Worker',
          content: ingestContent,
        }),
      });
      setShowIngest(false);
      setIngestContent('');
      if (res.isPending) {
        toast.warning(
          'Laporan masuk antrian Pending',
          res.pendingReason || res.approvalSummary || res.outcome
        );
      } else {
        toast.success(
          `Pesan diproses (${res.outcome})`,
          res.approvalSummary || res.parseStatus || undefined
        );
      }
      await loadReports(1);
      setPage(1);
    } catch (err) {
      toast.error('Gagal memproses pesan Discord', err instanceof Error ? err.message : undefined);
    } finally {
      setIngestSubmitting(false);
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Manajemen Laporan Discord
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-mono tabular-nums font-medium text-slate-700">{total}</span> pesan laporan ·
            Validasi duplikat otomatis berdasarkan judul komik, role, dan irisan chapter.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && selectedChapterIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => requestApprovalAction('approve')}
                className="px-3 py-2 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
              >
                Approve ({selectedChapterIds.length})
              </button>
              <button
                type="button"
                onClick={() => requestApprovalAction('reject')}
                className="px-3 py-2 text-xs font-medium bg-rose-700 hover:bg-rose-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
              >
                Reject ({selectedChapterIds.length})
              </button>
              <button
                type="button"
                onClick={() => requestApprovalAction('void')}
                className="px-3 py-2 text-xs font-medium bg-slate-700 hover:bg-slate-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
              >
                Void ({selectedChapterIds.length})
              </button>
            </>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowIngest(true)}
              className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span>Proses Pesan Manual</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Status Tabs + Instant Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((tab) => {
              const active = status === tab.value;
              return (
                <button
                  key={tab.value || 'all'}
                  type="button"
                  onClick={() => {
                    setStatus(tab.value);
                    setPage(1);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari isi pesan, pekerja, judul..."
                className="pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 w-full sm:w-64 focus:outline-none focus:border-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowMoreFilters((v) => !v)}
              className={`px-3 py-2 text-xs font-medium rounded-lg border inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                showMoreFilters
                  ? 'bg-slate-100 border-slate-300 text-slate-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filter Lanjutan</span>
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Core & Advanced Filter Selects */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 ${
            showMoreFilters ? 'lg:grid-cols-7' : 'lg:grid-cols-4'
          } gap-2.5 pt-2 border-t border-slate-100`}
        >
          <select
            aria-label="Filter Periode"
            value={periodId}
            onChange={(e) => {
              setPeriodId(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Bulan</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_key} ({p.status})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Komik"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Komik</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Role</option>
            <option value="Translator">Translator</option>
            <option value="Editor">Editor</option>
            <option value="Solo">Solo</option>
          </select>

          <select
            aria-label="Filter Karyawan"
            value={memberId}
            onChange={(e) => {
              setMemberId(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Karyawan</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.display_name}
              </option>
            ))}
          </select>

          {showMoreFilters && (
            <>
              <select
                aria-label="Filter Channel"
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-slate-900"
              >
                <option value="">Semua Channel</option>
                {channels.map((c) => (
                  <option key={c.discord_channel_id} value={c.discord_channel_id}>
                    {c.channel_name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                value={chapterFilter}
                onChange={(e) => {
                  setChapterFilter(e.target.value);
                  setPage(1);
                }}
                placeholder="No. Chapter"
                className="px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
              />

              <input
                type="date"
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
              />
            </>
          )}
        </div>
      </div>

      {/* Reports List */}
      <div className="space-y-4">
        {loading ? (
          <CardSkeletonGrid count={4} />
        ) : reports.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-5 h-5" />}
            title="Tidak ada laporan sesuai filter"
            description="Coba ubah kata kunci pencarian, status, atau periode untuk melihat laporan lainnya."
            action={
              hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
                >
                  Reset Semua Filter
                </button>
              ) : undefined
            }
          />
        ) : (
          reports.map((rep) => {
            const notes: string[] = Array.isArray(rep.parse_notes_json)
              ? rep.parse_notes_json
              : JSON.parse(rep.parse_notes_json || '[]');
            const activeChapters = rep.chapters.filter(
              (c) => c.approval_status !== 'void' && c.approval_status !== 'rejected'
            );
            const totalReportIdr = activeChapters.reduce((s, c) => s + c.amount_idr, 0);
            const hasDuplicate = rep.chapters.some((c) => Boolean(c.duplicate_flag));
            const hasPending = rep.chapters.some((c) => c.approval_status === 'pending');

            return (
              <div
                key={rep.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden"
              >
                {/* Report Header */}
                <div className="px-4 sm:px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-sm text-slate-900">{rep.employee_name}</span>
                      <span className="font-mono text-slate-400">@{rep.author_username}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono tabular-nums">{formatJakartaDateTime(rep.message_timestamp)} WIB</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono">Periode {rep.period_key}</span>
                      {hasPending ? (
                        <StatusBadge status="pending" />
                      ) : activeChapters.length > 0 ? (
                        <StatusBadge status="auto_approved" label="Sukses Tercatat" />
                      ) : null}
                      {Boolean(rep.is_deleted) && <StatusBadge status="void" label="Deleted" />}
                    </div>

                    <div className="text-xs sm:text-sm font-mono text-slate-800 bg-white border border-slate-200/80 rounded-lg px-3 py-1.5 break-words">
                      {rep.raw_content}
                    </div>

                    {(notes.length > 0 || hasDuplicate) && (
                      <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          {notes.length > 0
                            ? notes.join(' · ')
                            : 'Terdeteksi indikasi duplikat chapter pada komik dan role yang sama.'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-200/70">
                    <div className="text-left lg:text-right">
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                        {rep.chapters.length} entri chapter
                      </div>
                      <div className="text-sm font-semibold font-mono tabular-nums text-slate-900">
                        {formatIdr(totalReportIdr)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void openHistory(rep.id)}
                        className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 bg-white rounded-lg cursor-pointer transition-colors"
                        title="Histori perubahan"
                        aria-label="Histori perubahan"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      {rep.message_url && (
                        <a
                          href={rep.message_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 bg-white rounded-lg transition-colors"
                          title="Buka pesan Discord"
                          aria-label="Buka pesan Discord"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Desktop Chapter Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="text-slate-500 bg-white border-b border-slate-100">
                      <tr>
                        {canEdit && <th className="py-2.5 px-4 w-8"></th>}
                        <th className="py-2.5 px-4 font-medium">Komik</th>
                        <th className="py-2.5 px-4 font-medium">Chapter</th>
                        <th className="py-2.5 px-4 font-medium">Role</th>
                        <th className="py-2.5 px-4 font-medium text-right">Tarif</th>
                        <th className="py-2.5 px-4 font-medium text-right">Nominal</th>
                        <th className="py-2.5 px-4 font-medium">Status</th>
                        {canEdit && <th className="py-2.5 px-4 font-medium text-right">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rep.chapters.map((ch) => (
                        <tr key={ch.id} className="hover:bg-slate-50/80 transition-colors">
                          {canEdit && (
                            <td className="py-2.5 px-4">
                              <input
                                type="checkbox"
                                checked={selectedChapterIds.includes(ch.id)}
                                onChange={() => toggleChapterSelection(ch.id)}
                                className="rounded border-slate-300 cursor-pointer"
                              />
                            </td>
                          )}
                          <td className="py-2.5 px-4 text-slate-900 font-medium">
                            {ch.project_title || 'Belum Ditentukan'}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                            <span>Ch. {ch.chapter_number}</span>
                            {Boolean(ch.duplicate_flag) && (
                              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-sans font-medium bg-rose-50 text-rose-700 border border-rose-200 rounded">
                                Duplikat
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">{ch.role || '-'}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                            {formatIdr(ch.unit_rate_idr)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {formatIdr(ch.amount_idr)}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <StatusBadge status={ch.approval_status} />
                          </td>
                          {canEdit && (
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                {ch.approval_status !== 'approved' &&
                                  ch.approval_status !== 'auto_approved' && (
                                    <button
                                      type="button"
                                      onClick={() => requestApprovalAction('approve', [ch.id])}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                                    >
                                      <Check className="w-3 h-3" /> Approve
                                    </button>
                                  )}
                                {ch.approval_status !== 'rejected' && (
                                  <button
                                    type="button"
                                    onClick={() => requestApprovalAction('reject', [ch.id])}
                                    className="px-2 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openChapterEdit(ch)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer"
                                >
                                  <Pencil className="w-3 h-3" /> Koreksi
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Chapter Cards */}
                <div className="md:hidden divide-y divide-slate-100">
                  {rep.chapters.map((ch) => (
                    <div key={ch.id} className="p-4 space-y-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          {canEdit && (
                            <input
                              type="checkbox"
                              checked={selectedChapterIds.includes(ch.id)}
                              onChange={() => toggleChapterSelection(ch.id)}
                              className="mt-0.5 rounded border-slate-300"
                            />
                          )}
                          <div>
                            <div className="font-semibold text-slate-900">
                              {ch.project_title || 'Belum Ditentukan'}
                            </div>
                            <div className="text-slate-600 mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-medium text-slate-900">
                                Ch. {ch.chapter_number}
                              </span>
                              <span>·</span>
                              <span>{ch.role || '-'}</span>
                              {Boolean(ch.duplicate_flag) && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 rounded">
                                  Duplikat
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <StatusBadge status={ch.approval_status} />
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          {formatIdr(ch.amount_idr)}
                        </span>
                        {canEdit && (
                          <div className="flex items-center gap-1.5">
                            {ch.approval_status !== 'approved' &&
                              ch.approval_status !== 'auto_approved' && (
                                <button
                                  type="button"
                                  onClick={() => requestApprovalAction('approve', [ch.id])}
                                  className="px-2.5 py-1 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md cursor-pointer"
                                >
                                  Approve
                                </button>
                              )}
                            {ch.approval_status !== 'rejected' && (
                              <button
                                type="button"
                                onClick={() => requestApprovalAction('reject', [ch.id])}
                                className="px-2.5 py-1 font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md cursor-pointer"
                              >
                                Reject
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openChapterEdit(ch)}
                              className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 rounded-md cursor-pointer"
                            >
                              Koreksi
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {!loading && reports.length > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={total}
          onPageChange={(next) => setPage(next)}
        />
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        open={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        description={confirmAction?.description || ''}
        confirmLabel={
          confirmAction?.action === 'approve'
            ? 'Ya, Setujui'
            : confirmAction?.action === 'reject'
              ? 'Ya, Tolak'
              : 'Ya, Void'
        }
        variant={confirmAction?.action === 'approve' ? 'default' : 'danger'}
        loading={actionLoading}
        onConfirm={executeApprovalAction}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Chapter Correction Modal */}
      {editingChapter && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Koreksi Entri Chapter</h2>
              <button
                type="button"
                onClick={() => setEditingChapter(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitChapterEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Komik</label>
                <select
                  value={editProjectId}
                  onChange={(e) => setEditProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as RoleName)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Translator">Translator</option>
                    <option value="Editor">Editor</option>
                    <option value="Solo">Solo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Chapter</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editChapterNum}
                    onChange={(e) => setEditChapterNum(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status Approval</label>
                <select
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as 'approved' | 'rejected' | 'void' | 'pending')
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                  <option value="void">Void</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alasan Koreksi (Wajib untuk Audit Log)
                </label>
                <input
                  type="text"
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Misal: Verifikasi duplikat atau perbaikan role"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingChapter(null)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Simpan Koreksi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Event History Drawer */}
      {historyReportId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="flex-1" onClick={() => setHistoryReportId(null)} />
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6 border-l border-slate-200 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-semibold text-slate-900">Histori Perubahan Laporan</h2>
              <button
                type="button"
                onClick={() => setHistoryReportId(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {historyLoading ? (
              <div className="py-8 flex justify-center text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {historyEvents.map((ev) => (
                  <div key={ev.id} className="py-3 text-xs space-y-1">
                    <div className="font-semibold text-slate-900 font-mono">{ev.event_type}</div>
                    <div className="text-slate-600 leading-relaxed">{ev.reason || '-'}</div>
                    <div className="text-slate-400 font-mono tabular-nums">
                      {ev.actor_type} ({ev.actor_id}) · {formatJakartaDateTime(ev.created_at)} WIB
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Discord Message Ingestion Modal */}
      {showIngest && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Proses Pesan Laporan Discord</h2>
              <button
                type="button"
                onClick={() => setShowIngest(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Pesan diproses melalui Smart Parser, deteksi duplikat per komik &amp; role, dan kalkulasi payroll yang sama persis dengan bot Discord.
            </p>
            <form onSubmit={handleIngestSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Channel Laporan</label>
                  <select
                    value={ingestChannelId}
                    onChange={(e) => setIngestChannelId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {channels.map((c) => (
                      <option key={c.discord_channel_id} value={c.discord_channel_id}>
                        {c.channel_name} ({c.discord_channel_id.slice(-4)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pengirim</label>
                  <select
                    value={ingestAuthorId}
                    onChange={(e) => setIngestAuthorId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.discord_user_id}>
                        {emp.display_name} (@{emp.discord_username})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Isi Pesan Discord</label>
                <textarea
                  rows={3}
                  required
                  value={ingestContent}
                  onChange={(e) => setIngestContent(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  placeholder="Contoh: <#1352988212079104031> Solo Leveling CH 4-5 ETL Done"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowIngest(false)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={ingestSubmitting}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {ingestSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Jalankan Parser &amp; Simpan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
