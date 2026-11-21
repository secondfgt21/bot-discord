import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, History, MessageSquarePlus, Pencil, X } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, Period, RoleName } from '../types.ts';

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

export function ReportsView({ user, periods, initialStatusFilter = '' }: ReportsViewProps) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filter options
  const [employees, setEmployees] = useState<Array<{ id: string; display_name: string; discord_user_id: string; discord_username: string }>>([]);
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
  const [search, setSearch] = useState('');

  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Modals
  const [editingChapter, setEditingChapter] = useState<ChapterRow | null>(null);
  const [editProjectId, setEditProjectId] = useState('');
  const [editRole, setEditRole] = useState<RoleName>('Translator');
  const [editChapterNum, setEditChapterNum] = useState(1);
  const [editStatus, setEditStatus] = useState<'approved' | 'rejected' | 'void' | 'pending'>('approved');
  const [editReason, setEditReason] = useState('');

  const [historyReportId, setHistoryReportId] = useState<string | null>(null);
  const [historyEvents, setHistoryEvents] = useState<Array<{ id: string; event_type: string; actor_type: string; actor_id: string; reason: string; created_at: string }>>([]);

  const [showIngest, setShowIngest] = useState(false);
  const [ingestChannelId, setIngestChannelId] = useState('');
  const [ingestAuthorId, setIngestAuthorId] = useState('');
  const [ingestContent, setIngestContent] = useState('');

  useEffect(() => {
    setStatus(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    void (async () => {
      const [empRes, projRes] = await Promise.all([
        apiFetch<{ employees: Array<{ id: string; display_name: string; discord_user_id: string; discord_username: string }> }>('/employees'),
        apiFetch<{ projects: Array<{ id: string; title: string }>; allChannelMappings: Array<{ discord_channel_id: string; channel_name: string }> }>('/projects'),
      ]);
      setEmployees(empRes.employees);
      setProjects(projRes.projects);
      const uniqueCh = new Map<string, string>();
      for (const c of projRes.allChannelMappings) {
        uniqueCh.set(c.discord_channel_id, c.channel_name || c.discord_channel_id);
      }
      const chList = Array.from(uniqueCh.entries()).map(([id, name]) => ({ discord_channel_id: id, channel_name: name }));
      setChannels(chList);
      if (chList.length > 0) setIngestChannelId((prev) => prev || chList[0].discord_channel_id);
      if (empRes.employees.length > 0) setIngestAuthorId((prev) => prev || empRes.employees[0].discord_user_id);
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
      if (search) params.set('search', search);

      const res = await apiFetch<{
        reports: ReportRow[];
        pagination: { page: number; totalPages: number; total: number };
      }>(`/reports?${params.toString()}`);

      setReports(res.reports);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports(page);
  }, [page, periodId, memberId, projectId, role, status, channelId, chapterFilter, dateFilter, search]);

  function toggleChapterSelection(chId: string) {
    setSelectedChapterIds((prev) =>
      prev.includes(chId) ? prev.filter((id) => id !== chId) : [...prev, chId]
    );
  }

  async function handleBulkAction(action: 'approve' | 'reject' | 'void', ids = selectedChapterIds) {
    if (ids.length === 0) return;
    setFeedback(null);
    try {
      const res = await apiFetch<{ updatedCount: number }>('/reports/chapters/bulk-approval', {
        method: 'POST',
        body: JSON.stringify({
          chapterIds: ids,
          action,
          reason: action === 'approve' ? 'Disetujui melalui dashboard' : `Aksi ${action} oleh admin`,
        }),
      });
      setSelectedChapterIds([]);
      setFeedback(`${res.updatedCount} chapter berhasil diperbarui (${action}).`);
      await loadReports(page);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal memproses aksi.');
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
    setFeedback(null);
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
      setFeedback('Koreksi chapter disimpan dan payroll diperbarui.');
      await loadReports(page);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menyimpan koreksi.');
    }
  }

  async function openHistory(reportId: string) {
    setHistoryReportId(reportId);
    const res = await apiFetch<{
      events: Array<{ id: string; event_type: string; actor_type: string; actor_id: string; reason: string; created_at: string }>;
    }>(`/reports/${reportId}`);
    setHistoryEvents(res.events);
  }

  async function handleIngestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const emp = employees.find((x) => x.discord_user_id === ingestAuthorId);
    try {
      const res = await apiFetch<{
        outcome: string;
        parseStatus?: string;
        chaptersCreated?: number;
        approvalSummary?: string;
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
      setFeedback(
        `Hasil parser: ${res.outcome}${res.parseStatus ? ` (${res.parseStatus})` : ''}${res.approvalSummary ? ` · ${res.approvalSummary}` : ''}`
      );
      await loadReports(1);
      setPage(1);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal memproses pesan.');
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Manajemen Laporan Discord
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Menampilkan {total} pesan laporan · Setiap rentang chapter dipecah menjadi entri chapter individual.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && selectedChapterIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => void handleBulkAction('approve')}
                className="px-3.5 py-2 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
              >
                Approve ({selectedChapterIds.length})
              </button>
              <button
                type="button"
                onClick={() => void handleBulkAction('reject')}
                className="px-3.5 py-2 text-xs font-medium bg-rose-700 hover:bg-rose-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
              >
                Reject ({selectedChapterIds.length})
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
              <span>Proses Pesan Discord</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 flex items-center justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Multi-Criteria Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <select
          value={periodId}
          onChange={(e) => { setPeriodId(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="">Semua Bulan</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>{p.period_key}</option>
          ))}
        </select>

        <select
          value={memberId}
          onChange={(e) => { setMemberId(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="">Semua Karyawan</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.display_name}</option>
          ))}
        </select>

        <select
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="">Semua Komik</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>

        <select
          value={role}
          onChange={(e) => { setRole(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="">Semua Role</option>
          <option value="Translator">Translator</option>
          <option value="Editor">Editor</option>
          <option value="Solo">Solo</option>
        </select>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="auto_approved">Auto Approved</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="void">Void</option>
        </select>

        <select
          value={channelId}
          onChange={(e) => { setChannelId(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="">Semua Channel</option>
          {channels.map((c) => (
            <option key={c.discord_channel_id} value={c.discord_channel_id}>{c.channel_name}</option>
          ))}
        </select>

        <input
          type="number"
          value={chapterFilter}
          onChange={(e) => { setChapterFilter(e.target.value); setPage(1); }}
          placeholder="No. Chapter"
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
        />

        <input
          type="date"
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
        />
      </div>

      {/* Reports List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            Memuat laporan...
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Tidak ada laporan sesuai filter.
          </div>
        ) : (
          reports.map((rep) => {
            const notes: string[] = Array.isArray(rep.parse_notes_json)
              ? rep.parse_notes_json
              : JSON.parse(rep.parse_notes_json || '[]');
            const activeChapters = rep.chapters.filter((c) => c.approval_status !== 'void' && c.approval_status !== 'rejected');
            const totalReportIdr = activeChapters.reduce((s, c) => s + c.amount_idr, 0);

            return (
              <div key={rep.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-sm text-slate-900">{rep.employee_name}</span>
                      <span>·</span>
                      <span className="font-mono">{formatJakartaDateTime(rep.message_timestamp)}</span>
                      <span>·</span>
                      <span>Periode {rep.period_key}</span>
                      <span>·</span>
                      <span className="font-mono">Parse: {rep.parse_status}</span>
                      {Boolean(rep.is_deleted) && <span className="text-rose-700 font-medium">· DELETED</span>}
                    </div>
                    <div className="text-sm font-mono text-slate-800 break-all">
                      {rep.raw_content}
                    </div>
                    {notes.length > 0 && (
                      <div className="text-xs text-amber-700 mt-1">
                        Catatan parser: {notes.join(' · ')}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{rep.chapters.length} entri chapter</div>
                      <div className="text-sm font-semibold font-mono tabular-nums text-slate-900">
                        Total: {formatIdr(totalReportIdr)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openHistory(rep.id)}
                      className="p-2 text-slate-500 hover:text-slate-900 border border-slate-200 bg-white rounded-lg cursor-pointer"
                      title="Histori perubahan"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    {rep.message_url && (
                      <a
                        href={rep.message_url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 text-slate-500 hover:text-slate-900 border border-slate-200 bg-white rounded-lg"
                        title="Buka pesan Discord"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Individual Chapter Rows */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="text-slate-500 border-b border-slate-100">
                      <tr>
                        {canEdit && <th className="py-2 px-4 w-8"></th>}
                        <th className="py-2 px-4 font-medium">Komik</th>
                        <th className="py-2 px-4 font-medium">Chapter</th>
                        <th className="py-2 px-4 font-medium">Role</th>
                        <th className="py-2 px-4 font-medium text-right">Tarif Snapshot</th>
                        <th className="py-2 px-4 font-medium text-right">Nominal</th>
                        <th className="py-2 px-4 font-medium">Status</th>
                        {canEdit && <th className="py-2 px-4 font-medium text-right">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rep.chapters.map((ch) => (
                        <tr key={ch.id} className="hover:bg-slate-50">
                          {canEdit && (
                            <td className="py-2 px-4">
                              <input
                                type="checkbox"
                                checked={selectedChapterIds.includes(ch.id)}
                                onChange={() => toggleChapterSelection(ch.id)}
                                className="rounded border-slate-300"
                              />
                            </td>
                          )}
                          <td className="py-2 px-4 text-slate-800">{ch.project_title || 'Belum Ditentukan'}</td>
                          <td className="py-2 px-4 font-mono tabular-nums font-medium text-slate-900">
                            Ch. {ch.chapter_number}
                            {Boolean(ch.duplicate_flag) && (
                              <span className="ml-2 text-rose-700 font-sans font-medium">
                                (Potensi Duplikat)
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-4 text-slate-700">{ch.role || '-'}</td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                            {formatIdr(ch.unit_rate_idr)}
                          </td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                            {formatIdr(ch.amount_idr)}
                          </td>
                          <td className="py-2 px-4">
                            <span
                              className={`font-medium ${
                                ch.approval_status === 'approved' || ch.approval_status === 'auto_approved'
                                  ? 'text-emerald-700'
                                  : ch.approval_status === 'pending'
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                              }`}
                            >
                              {ch.approval_status}
                            </span>
                          </td>
                          {canEdit && (
                            <td className="py-2 px-4 text-right whitespace-nowrap space-x-2">
                              {ch.approval_status !== 'approved' && ch.approval_status !== 'auto_approved' && (
                                <button
                                  type="button"
                                  onClick={() => void handleBulkAction('approve', [ch.id])}
                                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" /> Approve
                                </button>
                              )}
                              {ch.approval_status !== 'rejected' && (
                                <button
                                  type="button"
                                  onClick={() => void handleBulkAction('reject', [ch.id])}
                                  className="text-rose-700 hover:underline cursor-pointer"
                                >
                                  Reject
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openChapterEdit(ch)}
                                className="inline-flex items-center gap-1 text-slate-700 hover:underline cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" /> Koreksi
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Halaman {page} dari {totalPages}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 cursor-pointer"
          >
            Sebelumnya
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-40 cursor-pointer"
          >
            Berikutnya
          </button>
        </div>
      </div>

      {/* Chapter Correction Modal */}
      {editingChapter && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Koreksi Entri Chapter</h2>
              <button type="button" onClick={() => setEditingChapter(null)} className="text-slate-400 cursor-pointer">
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
                    <option key={p.id} value={p.id}>{p.title}</option>
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
                  onChange={(e) => setEditStatus(e.target.value as 'approved' | 'rejected' | 'void' | 'pending')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                  <option value="void">Void</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Koreksi (Wajib untuk Audit Log)</label>
                <input
                  type="text"
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Misal: Konflik channel diverifikasi ke komik yang benar"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditingChapter(null)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                  Simpan Koreksi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Event History Drawer */}
      {historyReportId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6 border-l border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-semibold text-slate-900">Histori Perubahan Laporan</h2>
              <button type="button" onClick={() => setHistoryReportId(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {historyEvents.map((ev) => (
                <div key={ev.id} className="py-3 text-xs space-y-1">
                  <div className="font-semibold text-slate-900">{ev.event_type}</div>
                  <div className="text-slate-600">{ev.reason || '-'}</div>
                  <div className="text-slate-400 font-mono">
                    {ev.actor_type} ({ev.actor_id}) · {formatJakartaDateTime(ev.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Discord Message Ingestion Modal */}
      {showIngest && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                Proses Pesan Laporan Discord
              </h2>
              <button type="button" onClick={() => setShowIngest(false)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Pesan akan diproses melalui Smart Parser deterministik, deteksi duplikat, dan kalkulasi payroll yang sama persis dengan Discord Gateway Bot.
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">Pengirim (Discord User ID)</label>
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
                  placeholder="Contoh: CH 108-110, 115, 118-120 ETL Done @Controller"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowIngest(false)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                  Jalankan Parser & Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
