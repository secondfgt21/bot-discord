import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';

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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelName, setNewChannelName] = useState('');

  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});
  const [channelInputs, setChannelInputs] = useState<Record<string, { id: string; name: string; isDefault: boolean }>>({});

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await apiFetch<{ projects: ProjectItem[] }>('/projects');
      setProjects(res.projects);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({
        title: newTitle,
        aliases: newAliases.split(',').map((s) => s.trim()).filter(Boolean),
        discordChannelId: newChannelId,
        channelName: newChannelName,
      }),
    });
    setNewTitle('');
    setNewAliases('');
    setNewChannelId('');
    setNewChannelName('');
    setShowCreate(false);
    await loadProjects();
  }

  async function handleAddAlias(projectId: string) {
    const val = aliasInputs[projectId]?.trim();
    if (!val) return;
    await apiFetch(`/projects/${projectId}/aliases`, {
      method: 'POST',
      body: JSON.stringify({ alias: val }),
    });
    setAliasInputs((prev) => ({ ...prev, [projectId]: '' }));
    await loadProjects();
  }

  async function handleDeleteAlias(aliasId: string) {
    await apiFetch(`/projects/aliases/${aliasId}`, { method: 'DELETE' });
    await loadProjects();
  }

  async function handleAddChannel(projectId: string) {
    const inp = channelInputs[projectId];
    if (!inp?.id?.trim()) return;
    await apiFetch(`/projects/${projectId}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        discordChannelId: inp.id.trim(),
        channelName: inp.name.trim(),
        isDefault: inp.isDefault,
      }),
    });
    setChannelInputs((prev) => ({ ...prev, [projectId]: { id: '', name: '', isDefault: true } }));
    await loadProjects();
  }

  async function handleDeleteChannel(mappingId: string) {
    await apiFetch(`/projects/channels/${mappingId}`, { method: 'DELETE' });
    await loadProjects();
  }

  async function handleToggleActive(p: ProjectItem) {
    await apiFetch(`/projects/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !p.is_active }),
    });
    await loadProjects();
  }

  async function openProjectDetail(id: string) {
    const res = await apiFetch<ProjectDetail>(`/projects/${id}`);
    setDetail(res);
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Proyek Komik & Channel Mapping
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Satu channel Discord dapat di-mapping ke satu komik default atau beberapa komik sekaligus.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Komik</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-8">Memuat daftar komik...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {projects.map((p) => {
            const chInp = channelInputs[p.id] || { id: '', name: '', isDefault: true };
            return (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => void openProjectDetail(p.id)}
                      className="text-lg font-semibold text-slate-900 hover:underline text-left cursor-pointer"
                    >
                      {p.title}
                    </button>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      {p.total_chapters} chapter · {formatIdr(p.total_expense_idr)} ·{' '}
                      {p.is_active ? 'Aktif' : 'Nonaktif'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openProjectDetail(p.id)}
                      className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                    >
                      Kontributor
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(p)}
                        className="text-xs font-medium text-slate-500 hover:text-slate-900 underline cursor-pointer"
                      >
                        {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Aliases */}
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1.5">Alias Nama Komik</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700 mb-2">
                    {p.aliases.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1">
                        <span>{a.alias}</span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteAlias(a.id)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={aliasInputs[p.id] || ''}
                        onChange={(e) => setAliasInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="Tambah alias (misal: SL)"
                        className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddAlias(p.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer"
                      >
                        Tambah
                      </button>
                    </div>
                  )}
                </div>

                {/* Channel Mappings */}
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1.5">Channel Discord Terhubung</div>
                  <div className="space-y-1 mb-2">
                    {p.channels.length === 0 ? (
                      <div className="text-xs text-slate-400">Belum ada channel mapping.</div>
                    ) : (
                      p.channels.map((c) => (
                        <div key={c.id} className="flex items-center justify-between text-xs text-slate-700 py-1 border-b border-slate-100 last:border-0">
                          <span className="font-mono">
                            {c.channel_name || '#channel'} ({c.discord_channel_id})
                            {c.is_default ? ' · Default' : ' · Multi-Proyek'}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteChannel(c.id)}
                              className="text-slate-400 hover:text-rose-600 cursor-pointer"
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
                          setChannelInputs((prev) => ({ ...prev, [p.id]: { ...chInp, id: e.target.value } }))
                        }
                        placeholder="Channel ID"
                        className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                      />
                      <input
                        type="text"
                        value={chInp.name}
                        onChange={(e) =>
                          setChannelInputs((prev) => ({ ...prev, [p.id]: { ...chInp, name: e.target.value } }))
                        }
                        placeholder="#nama-channel"
                        className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddChannel(p.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer"
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

      {/* Create Comic Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Tambah Komik Baru</h2>
              <button type="button" onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
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
                <label className="block text-xs font-medium text-slate-700 mb-1">Alias (pisahkan dengan koma)</label>
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">Discord Channel ID</label>
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
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">
                  Batal
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                  Simpan Komik
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h2 className="text-xl font-semibold text-slate-900">{detail.project.title}</h2>
              <button type="button" onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-800 cursor-pointer">
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
                      <span>{c.display_name} · {c.role}</span>
                      <span className="font-mono tabular-nums">{c.chapters} ch · {formatIdr(c.amount_idr)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Riwayat Pekerjaan Terbaru</h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {detail.history.map((h) => (
                  <div key={h.id} className="px-3 py-2 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-medium text-slate-800">
                        Ch.{h.chapter_number} ({h.role}) — {h.employee_name}
                      </div>
                      <div className="text-slate-500">{formatJakartaDateTime(h.created_at)}</div>
                    </div>
                    <div className="font-mono tabular-nums">
                      {formatIdr(h.amount_idr)} · {h.approval_status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
