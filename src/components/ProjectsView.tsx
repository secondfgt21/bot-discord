import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Info, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';
import {
  CardSkeletonGrid,
  ConfirmModal,
  EmptyState,
  StatusBadge,
  useToast,
} from './ui/DashboardUI.tsx';

interface ProjectItem {
  id: string;
  title: string;
  slug: string;
  is_active: boolean | number;
  total_chapters: number;
  total_expense_idr: number;
  aliases: Array<{ id: string; alias: string }>;
  channels: Array<{
    id: string;
    discord_channel_id: string;
    channel_name: string;
    is_default: boolean | number;
  }>;
}

interface ProjectDetail {
  project: { id: string; title: string; slug: string; is_active: boolean | number };
  contributors: Array<{ id: string; display_name: string; role: string; chapters: number; amount_idr: number }>;
  history: Array<{
    id: string;
    chapter_number: number;
    role: string;
    amount_idr: number;
    approval_status: string;
    created_at: string;
    employee_name: string;
  }>;
}

export function ProjectsView({ user }: { user: AuthUser }) {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelName, setNewChannelName] = useState('');

  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});
  const [channelInputs, setChannelInputs] = useState<
    Record<string, { id: string; name: string; isDefault: boolean }>
  >({});

  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'default';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await apiFetch<{ projects: ProjectItem[] }>('/projects');
      setProjects(res.projects);
    } catch (err) {
      toast.error('Gagal memuat daftar komik', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter === 'active' && !p.is_active) return false;
      if (statusFilter === 'inactive' && Boolean(p.is_active)) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.aliases.some((a) => a.alias.toLowerCase().includes(q)) ||
        p.channels.some(
          (c) =>
            c.channel_name.toLowerCase().includes(q) ||
            c.discord_channel_id.toLowerCase().includes(q)
        )
      );
    });
  }, [projects, search, statusFilter]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          aliases: newAliases
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          discordChannelId: newChannelId,
          channelName: newChannelName,
        }),
      });
      toast.success('Proyek komik ditambahkan', newTitle);
      setNewTitle('');
      setNewAliases('');
      setNewChannelId('');
      setNewChannelName('');
      setShowCreate(false);
      await loadProjects();
    } catch (err) {
      toast.error('Gagal menambahkan komik', err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  }

  async function handleAddAlias(projectId: string) {
    const val = aliasInputs[projectId]?.trim();
    if (!val) return;
    try {
      await apiFetch(`/projects/${projectId}/aliases`, {
        method: 'POST',
        body: JSON.stringify({ alias: val }),
      });
      setAliasInputs((prev) => ({ ...prev, [projectId]: '' }));
      toast.success('Alias ditambahkan', val);
      await loadProjects();
    } catch (err) {
      toast.error('Gagal menambah alias', err instanceof Error ? err.message : undefined);
    }
  }

  function requestDeleteAlias(aliasId: string, aliasText: string) {
    setConfirmState({
      title: `Hapus alias "${aliasText}"?`,
      description: 'Laporan mendatang tidak akan lagi mencocokkan alias ini secara otomatis.',
      confirmLabel: 'Hapus Alias',
      variant: 'danger',
      onConfirm: async () => {
        await apiFetch(`/projects/aliases/${aliasId}`, { method: 'DELETE' });
        toast.success('Alias dihapus', aliasText);
        await loadProjects();
      },
    });
  }

  async function handleAddChannel(projectId: string) {
    const inp = channelInputs[projectId];
    if (!inp?.id?.trim()) return;
    try {
      await apiFetch(`/projects/${projectId}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          discordChannelId: inp.id.trim(),
          channelName: inp.name.trim(),
          isDefault: inp.isDefault,
        }),
      });
      setChannelInputs((prev) => ({
        ...prev,
        [projectId]: { id: '', name: '', isDefault: true },
      }));
      toast.success('Channel mapping disimpan');
      await loadProjects();
    } catch (err) {
      toast.error('Gagal menyimpan channel mapping', err instanceof Error ? err.message : undefined);
    }
  }

  function requestDeleteChannel(mappingId: string, channelLabel: string) {
    setConfirmState({
      title: `Hapus mapping ${channelLabel}?`,
      description: 'Channel Discord ini tidak lagi terhubung ke proyek komik ini.',
      confirmLabel: 'Hapus Mapping',
      variant: 'danger',
      onConfirm: async () => {
        await apiFetch(`/projects/channels/${mappingId}`, { method: 'DELETE' });
        toast.success('Mapping channel dihapus', channelLabel);
        await loadProjects();
      },
    });
  }

  function requestToggleActive(p: ProjectItem) {
    setConfirmState({
      title: p.is_active ? `Nonaktifkan "${p.title}"?` : `Aktifkan "${p.title}"?`,
      description: p.is_active
        ? 'Komik nonaktif tetap tersimpan pada histori payroll dan laporan sebelumnya.'
        : 'Komik akan kembali aktif untuk pencocokan laporan otomatis.',
      confirmLabel: p.is_active ? 'Nonaktifkan' : 'Aktifkan',
      variant: p.is_active ? 'warning' : 'default',
      onConfirm: async () => {
        await apiFetch(`/projects/${p.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !p.is_active }),
        });
        toast.success(p.is_active ? 'Komik dinonaktifkan' : 'Komik diaktifkan', p.title);
        await loadProjects();
      },
    });
  }

  async function executeConfirm() {
    if (!confirmState) return;
    setConfirmLoading(true);
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch (err) {
      toast.error('Aksi gagal diproses', err instanceof Error ? err.message : undefined);
    } finally {
      setConfirmLoading(false);
    }
  }

  async function openProjectDetail(id: string) {
    try {
      const res = await apiFetch<ProjectDetail>(`/projects/${id}`);
      setDetail(res);
    } catch (err) {
      toast.error('Gagal memuat detail proyek', err instanceof Error ? err.message : undefined);
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Proyek Komik &amp; Channel Mapping
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-mono tabular-nums font-medium text-slate-700">
              {filteredProjects.length}
            </span>{' '}
            proyek komik · Judul baru dari laporan Discord juga otomatis didaftarkan oleh bot.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Komik</span>
          </button>
        )}
      </div>

      {/* Multi-Comic Channel Guidance */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-slate-600">
        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <span className="leading-relaxed">
          Channel <span className="font-mono font-semibold text-slate-900">#file-tl (1352988212079104031)</span>{' '}
          bersifat penampungan multi-komik dan dikecualikan dari ikatan satu proyek agar laporan komik apa pun di sana diparsing langsung dari judul pesan tanpa konflik.
        </span>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <select
          aria-label="Filter Status Komik"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900 w-full sm:w-auto"
        >
          <option value="all">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul, alias, atau channel..."
            className="pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg w-full sm:w-72 focus:outline-none focus:border-slate-900"
          />
        </div>
      </div>

      {loading ? (
        <CardSkeletonGrid count={4} />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-5 h-5" />}
          title="Belum ada komik ditemukan"
          description="Tambah proyek komik secara manual atau kirim laporan baru di Discord."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredProjects.map((p) => {
            const chInp = channelInputs[p.id] || { id: '', name: '', isDefault: true };
            return (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openProjectDetail(p.id)}
                        className="text-base font-semibold text-slate-900 hover:underline text-left cursor-pointer"
                      >
                        {p.title}
                      </button>
                      <StatusBadge status={p.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                      {p.total_chapters} chapter · {formatIdr(p.total_expense_idr)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void openProjectDetail(p.id)}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                    >
                      Kontributor
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => requestToggleActive(p)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                      >
                        {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Aliases */}
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1.5">Alias Nama Komik</div>
                  <div className="flex flex-wrap gap-1.5 text-xs mb-2.5">
                    {p.aliases.length === 0 ? (
                      <span className="text-slate-400">Belum ada alias.</span>
                    ) : (
                      p.aliases.map((a) => (
                        <span
                          key={a.id}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-md text-slate-700"
                        >
                          <span>{a.alias}</span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => requestDeleteAlias(a.id, a.alias)}
                              className="text-slate-400 hover:text-rose-600 cursor-pointer"
                              aria-label={`Hapus alias ${a.alias}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={aliasInputs[p.id] || ''}
                        onChange={(e) =>
                          setAliasInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        placeholder="Tambah alias (misal: SL)"
                        className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddAlias(p.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        Tambah
                      </button>
                    </div>
                  )}
                </div>

                {/* Channel Mappings */}
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1.5">
                    Channel Discord Terhubung
                  </div>
                  <div className="space-y-1 mb-2.5">
                    {p.channels.length === 0 ? (
                      <div className="text-xs text-slate-400">
                        Belum ada channel khusus (dapat dilaporkan lewat #file-tl).
                      </div>
                    ) : (
                      p.channels.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between text-xs text-slate-700 py-1.5 px-2.5 bg-slate-50 border border-slate-100 rounded-lg"
                        >
                          <span className="font-mono truncate">
                            {c.channel_name || '#channel'} ({c.discord_channel_id})
                            {c.is_default ? ' · Default' : ' · Multi'}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                requestDeleteChannel(
                                  c.id,
                                  `${c.channel_name || '#channel'} (${c.discord_channel_id})`
                                )
                              }
                              className="text-slate-400 hover:text-rose-600 cursor-pointer ml-2 shrink-0"
                              aria-label="Hapus channel mapping"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {canEdit && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={chInp.id}
                        onChange={(e) =>
                          setChannelInputs((prev) => ({
                            ...prev,
                            [p.id]: { ...chInp, id: e.target.value },
                          }))
                        }
                        placeholder="Channel ID"
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                      />
                      <input
                        type="text"
                        value={chInp.name}
                        onChange={(e) =>
                          setChannelInputs((prev) => ({
                            ...prev,
                            [p.id]: { ...chInp, name: e.target.value },
                          }))
                        }
                        placeholder="#nama-channel"
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddChannel(p.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        Map Channel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        confirmLabel={confirmState?.confirmLabel || 'Konfirmasi'}
        variant={confirmState?.variant || 'default'}
        loading={confirmLoading}
        onConfirm={executeConfirm}
        onCancel={() => setConfirmState(null)}
      />

      {/* Create Comic Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Tambah Komik Baru</h2>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul Komik</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Contoh: Tower of God"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Alias (pisahkan dengan koma)
                </label>
                <input
                  type="text"
                  value={newAliases}
                  onChange={(e) => setNewAliases(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="TOG, Tower of God"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Discord Channel ID
                  </label>
                  <input
                    type="text"
                    value={newChannelId}
                    onChange={(e) => setNewChannelId(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    placeholder="Opsional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Channel</label>
                  <input
                    type="text"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="#tower-of-god"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Simpan Komik</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="flex-1" onClick={() => setDetail(null)} />
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-semibold text-slate-900">{detail.project.title}</h2>
                <StatusBadge status={detail.project.is_active ? 'ACTIVE' : 'INACTIVE'} />
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Kontributor</h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {detail.contributors.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">Belum ada kontribusi disetujui.</div>
                ) : (
                  detail.contributors.map((c, i) => (
                    <div key={`${c.id}-${c.role}-${i}`} className="px-3 py-2 flex justify-between text-xs">
                      <span className="font-medium text-slate-800">
                        {c.display_name} · <span className="text-slate-500 font-normal">{c.role}</span>
                      </span>
                      <span className="font-mono tabular-nums text-slate-700">
                        {c.chapters} ch · {formatIdr(c.amount_idr)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Riwayat Pekerjaan Terbaru</h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {detail.history.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">Belum ada riwayat chapter.</div>
                ) : (
                  detail.history.map((h) => (
                    <div key={h.id} className="px-3 py-2.5 flex justify-between items-center text-xs gap-2">
                      <div>
                        <div className="font-medium text-slate-800">
                          Ch. {h.chapter_number} ({h.role}) — {h.employee_name}
                        </div>
                        <div className="text-slate-500 font-mono">{formatJakartaDateTime(h.created_at)} WIB</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono tabular-nums font-medium">{formatIdr(h.amount_idr)}</span>
                        <StatusBadge status={h.approval_status} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
