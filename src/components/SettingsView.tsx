import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  Search,
  Shield,
  Sliders,
  Terminal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AdminRole, AuthUser, BotState, RoleName } from '../types.ts';
import {
  CardSkeletonGrid,
  ConfirmModal,
  StatusBadge,
  useToast,
} from './ui/DashboardUI.tsx';

interface SettingsResponse {
  guild: { id: string; discord_guild_id: string; name: string; timezone: string };
  rates: Record<RoleName, number>;
  rateHistory: Array<{
    id: string;
    role: string;
    rate_idr: number;
    effective_from: string;
    is_active: boolean | number;
    created_by: string;
  }>;
  roleAliases: Array<{ id: string; alias: string; role: RoleName }>;
  botSettings: Record<string, unknown>;
  botState: BotState;
  checkpoints: Array<{
    id: string;
    discord_channel_id: string;
    channel_name: string;
    sync_status: string;
    last_synced_at: string | null;
  }>;
}

interface AdminUserItem {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  discord_user_id: string | null;
  is_active: boolean | number;
  last_login_at: string | null;
}

interface AuditLogItem {
  id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  created_at: string;
}

type SettingsTab = 'rates' | 'bot' | 'admins' | 'audit';

export function SettingsView({ user }: { user: AuthUser }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('rates');
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditSearch, setAuditSearch] = useState('');

  const [guildName, setGuildName] = useState('');
  const [guildDiscordId, setGuildDiscordId] = useState('');
  const [rateInputs, setRateInputs] = useState<Record<RoleName, number>>({
    Translator: 3000,
    Editor: 3000,
    Solo: 6000,
  });

  const [newAlias, setNewAlias] = useState('');
  const [newAliasRole, setNewAliasRole] = useState<RoleName>('Translator');

  const [notifChannelId, setNotifChannelId] = useState('');
  const [reminderDays, setReminderDays] = useState(3);
  const [adminDiscordIds, setAdminDiscordIds] = useState('');
  const [adminRoleIds, setAdminRoleIds] = useState('');

  const [savingGuild, setSavingGuild] = useState(false);
  const [savingBot, setSavingBot] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const [showNewAdmin, setShowNewAdmin] = useState(false);
  const [admEmail, setAdmEmail] = useState('');
  const [admName, setAdmName] = useState('');
  const [admRole, setAdmRole] = useState<AdminRole>('Admin');
  const [admPass, setAdmPass] = useState('');
  const [admDiscordUid, setAdmDiscordUid] = useState('');

  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'default' | 'warning' | 'danger';
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const isOwner = user.role === 'Owner';
  const canAdmin = user.role !== 'Viewer';

  async function loadAll() {
    try {
      const [sRes, logRes] = await Promise.all([
        apiFetch<SettingsResponse>('/settings'),
        apiFetch<{ logs: AuditLogItem[] }>('/audit-logs?pageSize=50'),
      ]);
      setData(sRes);
      setGuildName(sRes.guild.name);
      setGuildDiscordId(sRes.guild.discord_guild_id);
      setRateInputs(sRes.rates);
      setNotifChannelId(String(sRes.botSettings.notification_channel_id || ''));
      setReminderDays(Number(sRes.botSettings.period_reminder_days_before_end ?? 3));
      setAdminDiscordIds(
        Array.isArray(sRes.botSettings.admin_discord_user_ids)
          ? (sRes.botSettings.admin_discord_user_ids as string[]).join(', ')
          : ''
      );
      setAdminRoleIds(
        Array.isArray(sRes.botSettings.admin_discord_role_ids)
          ? (sRes.botSettings.admin_discord_role_ids as string[]).join(', ')
          : ''
      );
      setAuditLogs(logRes.logs);

      if (isOwner) {
        const usersRes = await apiFetch<{ users: AdminUserItem[] }>('/settings/admin-users');
        setAdminUsers(usersRes.users);
      }
    } catch (err) {
      toast.error('Gagal memuat pengaturan sistem', err instanceof Error ? err.message : undefined);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [isOwner]);

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.actor_email.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.entity_type.toLowerCase().includes(q) ||
        (l.reason || '').toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  async function handleSaveGuild(e: React.FormEvent) {
    e.preventDefault();
    setSavingGuild(true);
    try {
      await apiFetch('/settings/guild', {
        method: 'PUT',
        body: JSON.stringify({ name: guildName, discordGuildId: guildDiscordId }),
      });
      toast.success('Konfigurasi Discord Guild disimpan.');
      await loadAll();
    } catch (err) {
      toast.error('Gagal menyimpan guild', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingGuild(false);
    }
  }

  function requestSaveRate(role: RoleName) {
    const nextRate = Math.trunc(Number(rateInputs[role]));
    setConfirmState({
      title: `Ubah Tarif ${role} ke ${formatIdr(nextRate)}?`,
      description:
        'Tarif baru hanya berlaku untuk laporan chapter mendatang. Snapshot tarif pada periode atau laporan lama tidak berubah.',
      confirmLabel: 'Simpan Tarif Baru',
      variant: 'warning',
      onConfirm: async () => {
        await apiFetch('/settings/rates', {
          method: 'PUT',
          body: JSON.stringify({ role, rateIdr: nextRate }),
        });
        toast.success(`Tarif ${role} diperbarui`, `Tarif aktif baru: ${formatIdr(nextRate)}.`);
        await loadAll();
      },
    });
  }

  async function handleAddRoleAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!newAlias.trim()) return;
    try {
      await apiFetch('/settings/role-aliases', {
        method: 'POST',
        body: JSON.stringify({ alias: newAlias.trim(), role: newAliasRole }),
      });
      toast.success('Alias role ditambahkan', `${newAlias.trim()} → ${newAliasRole}`);
      setNewAlias('');
      await loadAll();
    } catch (err) {
      toast.error('Gagal menambah alias', err instanceof Error ? err.message : undefined);
    }
  }

  function requestDeleteRoleAlias(id: string, aliasName: string) {
    setConfirmState({
      title: `Hapus alias role "${aliasName}"?`,
      description: 'Kata kunci ini tidak lagi dipetakan otomatis saat parser membaca pesan Discord.',
      confirmLabel: 'Hapus Alias',
      variant: 'danger',
      onConfirm: async () => {
        await apiFetch(`/settings/role-aliases/${id}`, { method: 'DELETE' });
        toast.success('Alias role dihapus', aliasName);
        await loadAll();
      },
    });
  }

  async function handleSaveBotSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingBot(true);
    try {
      await apiFetch('/settings/bot', {
        method: 'PUT',
        body: JSON.stringify({
          notification_channel_id: notifChannelId.trim(),
          period_reminder_days_before_end: Number(reminderDays),
          admin_discord_user_ids: adminDiscordIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          admin_discord_role_ids: adminRoleIds
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      toast.success('Pengaturan Bot & Notifikasi disimpan.');
      await loadAll();
    } catch (err) {
      toast.error('Gagal menyimpan pengaturan bot', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingBot(false);
    }
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreatingAdmin(true);
    try {
      await apiFetch('/settings/admin-users', {
        method: 'POST',
        body: JSON.stringify({
          email: admEmail,
          fullName: admName,
          role: admRole,
          password: admPass,
          discordUserId: admDiscordUid || undefined,
        }),
      });
      setShowNewAdmin(false);
      toast.success('Akun admin baru dibuat', `${admName} (${admRole})`);
      setAdmEmail('');
      setAdmName('');
      setAdmPass('');
      setAdmDiscordUid('');
      await loadAll();
    } catch (err) {
      toast.error('Gagal membuat akun admin', err instanceof Error ? err.message : undefined);
    } finally {
      setCreatingAdmin(false);
    }
  }

  function requestToggleAdminUser(u: AdminUserItem) {
    setConfirmState({
      title: u.is_active ? `Nonaktifkan akun ${u.full_name}?` : `Aktifkan akun ${u.full_name}?`,
      description: u.is_active
        ? 'Pengguna tidak akan dapat masuk ke dashboard sampai diaktifkan kembali oleh Owner.'
        : 'Pengguna akan kembali dapat masuk sesuai hak akses rolenya.',
      confirmLabel: u.is_active ? 'Nonaktifkan' : 'Aktifkan',
      variant: u.is_active ? 'warning' : 'default',
      onConfirm: async () => {
        await apiFetch(`/settings/admin-users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !u.is_active }),
        });
        toast.success(u.is_active ? 'Akun admin dinonaktifkan' : 'Akun admin diaktifkan', u.email);
        await loadAll();
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

  if (!data) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        <CardSkeletonGrid count={4} />
      </div>
    );
  }

  const tabs: Array<{ key: SettingsTab; label: string; icon: React.ReactNode; hidden?: boolean }> = [
    { key: 'rates', label: 'Tarif & Alias Role', icon: <Sliders className="w-3.5 h-3.5" /> },
    { key: 'bot', label: 'Guild & Bot Discord', icon: <Shield className="w-3.5 h-3.5" /> },
    { key: 'admins', label: 'Admin Dashboard', icon: <Users className="w-3.5 h-3.5" />, hidden: !isOwner },
    { key: 'audit', label: 'Audit Log Sistem', icon: <Terminal className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          Pengaturan Sistem &amp; Audit Log
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Konfigurasi tarif payroll, alias role, integrasi bot Discord, dan jejak audit sistem.
        </p>
      </div>

      {/* Section Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-2">
        {tabs
          .filter((t) => !t.hidden)
          .map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-3.5 py-2 text-xs font-medium rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
      </div>

      {/* Tab: Rates & Aliases */}
      {activeTab === 'rates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Tarif per Chapter (IDR)</h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Solo adalah role tersendiri (bukan Translator + Editor). Perubahan tarif hanya berlaku untuk laporan baru.
              </p>
            </div>

            <div className="space-y-3">
              {(['Translator', 'Editor', 'Solo'] as const).map((r) => (
                <div key={r} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800 w-24 shrink-0">{r}</span>
                  <input
                    type="number"
                    min={0}
                    disabled={!isOwner}
                    value={rateInputs[r]}
                    onChange={(e) =>
                      setRateInputs((prev) => ({ ...prev, [r]: Number(e.target.value) }))
                    }
                    className="flex-1 px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg disabled:bg-slate-50"
                  />
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => requestSaveRate(r)}
                      className="px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      Simpan
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Mapping Alias Role</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Normalisasi kata kunci laporan Discord (seperti TL/ETL/TS) ke role resmi payroll.
              </p>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {data.roleAliases.map((ra) => (
                <div key={ra.id} className="px-3 py-2 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-semibold text-slate-900">{ra.alias}</span>
                    <span className="text-slate-400 mx-2">→</span>
                    <span className="text-slate-700">{ra.role}</span>
                  </div>
                  {canAdmin && (
                    <button
                      type="button"
                      onClick={() => requestDeleteRoleAlias(ra.id, ra.alias)}
                      className="text-slate-400 hover:text-rose-600 cursor-pointer p-1"
                      aria-label={`Hapus alias ${ra.alias}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {canAdmin && (
              <form onSubmit={handleAddRoleAlias} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="Alias baru (misal: Proofreader)"
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <select
                  value={newAliasRole}
                  onChange={(e) => setNewAliasRole(e.target.value as RoleName)}
                  className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="Translator">Translator</option>
                  <option value="Editor">Editor</option>
                  <option value="Solo">Solo</option>
                </select>
                <button
                  type="submit"
                  className="px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Tambah
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Tab: Guild & Bot */}
      {activeTab === 'bot' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Discord Guild &amp; Timezone</h2>
            <form onSubmit={handleSaveGuild} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Studio / Server
                </label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={guildName}
                  onChange={(e) => setGuildName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Discord Guild ID</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={guildDiscordId}
                  onChange={(e) => setGuildDiscordId(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                />
              </div>
              {isOwner && (
                <button
                  type="submit"
                  disabled={savingGuild}
                  className="px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {savingGuild && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Simpan Konfigurasi Guild</span>
                </button>
              )}
            </form>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Pengaturan Bot &amp; Notifikasi</h2>
            <form onSubmit={handleSaveBotSettings} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Channel Notifikasi Discord ID
                </label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={notifChannelId}
                  onChange={(e) => setNotifChannelId(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Admin Discord User IDs (pisahkan koma)
                </label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={adminDiscordIds}
                  onChange={(e) => setAdminDiscordIds(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Admin Discord Role IDs
                  </label>
                  <input
                    type="text"
                    disabled={!isOwner}
                    value={adminRoleIds}
                    onChange={(e) => setAdminRoleIds(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Pengingat Tutup Periode (Hari)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    disabled={!isOwner}
                    value={reminderDays}
                    onChange={(e) => setReminderDays(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                  />
                </div>
              </div>
              {isOwner && (
                <button
                  type="submit"
                  disabled={savingBot}
                  className="px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {savingBot && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Simpan Pengaturan Bot</span>
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Tab: Admin Users (Owner Only) */}
      {activeTab === 'admins' && isOwner && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Pengguna Admin Dashboard</h2>
              <p className="text-xs text-slate-500">
                Hanya Owner yang dapat mengelola akses Owner, Admin, atau Viewer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewAdmin(true)}
              className="px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" /> Tambah Admin
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Nama</th>
                  <th className="py-2.5 px-4 font-medium">Email</th>
                  <th className="py-2.5 px-4 font-medium">Role</th>
                  <th className="py-2.5 px-4 font-medium">Discord User ID</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adminUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                      {u.full_name}
                    </td>
                    <td className="py-3 px-4 font-mono">{u.email}</td>
                    <td className="py-3 px-4 font-medium">{u.role}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{u.discord_user_id || '-'}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() => requestToggleAdminUser(u)}
                          className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Audit Logs */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Audit Log Sistem</h2>
              <p className="text-xs text-slate-500">
                Jejak perubahan laporan, pembayaran, tarif, dan tutup/buka periode.
              </p>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Cari aktor, aksi, alasan..."
                className="pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg w-full sm:w-64 focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Waktu (WIB)</th>
                  <th className="py-2.5 px-4 font-medium">Aktor</th>
                  <th className="py-2.5 px-4 font-medium">Aksi</th>
                  <th className="py-2.5 px-4 font-medium">Entitas</th>
                  <th className="py-2.5 px-4 font-medium">Alasan / Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {formatJakartaDateTime(log.created_at)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="font-medium text-slate-900">{log.actor_email}</span>
                      <span className="text-slate-400 ml-1">({log.actor_role})</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-800">{log.action}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{log.entity_type}</td>
                    <td className="py-2.5 px-4 text-slate-600">{log.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Audit Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">{log.action}</span>
                  <span className="font-mono text-slate-400">{log.entity_type}</span>
                </div>
                <div className="text-slate-600 leading-relaxed">{log.reason || '-'}</div>
                <div className="text-slate-500 font-mono tabular-nums pt-0.5">
                  {log.actor_email} ({log.actor_role}) · {formatJakartaDateTime(log.created_at)} WIB
                </div>
              </div>
            ))}
          </div>
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

      {/* Add Admin Modal */}
      {showNewAdmin && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Tambah Akun Admin</h2>
              <button
                type="button"
                onClick={() => setShowNewAdmin(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAdmin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={admName}
                  onChange={(e) => setAdmName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={admEmail}
                  onChange={(e) => setAdmEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={admRole}
                    onChange={(e) => setAdmRole(e.target.value as AdminRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Owner">Owner</option>
                    <option value="Admin">Admin</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Discord User ID
                  </label>
                  <input
                    type="text"
                    value={admDiscordUid}
                    onChange={(e) => setAdmDiscordUid(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    placeholder="Opsional"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password (min 8 karakter)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={admPass}
                  onChange={(e) => setAdmPass(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewAdmin(false)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creatingAdmin}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {creatingAdmin && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Buat Akun</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
