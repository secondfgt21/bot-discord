import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AdminRole, AuthUser, BotState, RoleName } from '../types.ts';

interface SettingsResponse {
  guild: { id: string; discord_guild_id: string; name: string; timezone: string };
  rates: Record<RoleName, number>;
  rateHistory: Array<{ id: string; role: string; rate_idr: number; effective_from: string; is_active: boolean | number; created_by: string }>;
  roleAliases: Array<{ id: string; alias: string; role: RoleName }>;
  botSettings: Record<string, unknown>;
  botState: BotState;
  checkpoints: Array<{ id: string; discord_channel_id: string; channel_name: string; sync_status: string; last_synced_at: string | null }>;
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

export function SettingsView({ user }: { user: AuthUser }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  // New Admin User Form (Owner only)
  const [showNewAdmin, setShowNewAdmin] = useState(false);
  const [admEmail, setAdmEmail] = useState('');
  const [admName, setAdmName] = useState('');
  const [admRole, setAdmRole] = useState<AdminRole>('Admin');
  const [admPass, setAdmPass] = useState('');
  const [admDiscordUid, setAdmDiscordUid] = useState('');

  const isOwner = user.role === 'Owner';
  const canAdmin = user.role !== 'Viewer';

  async function loadAll() {
    const [sRes, logRes] = await Promise.all([
      apiFetch<SettingsResponse>('/settings'),
      apiFetch<{ logs: AuditLogItem[] }>('/audit-logs?pageSize=25'),
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
  }

  useEffect(() => {
    void loadAll();
  }, [isOwner]);

  async function handleSaveGuild(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/settings/guild', {
        method: 'PUT',
        body: JSON.stringify({ name: guildName, discordGuildId: guildDiscordId }),
      });
      setFeedback('Konfigurasi Discord Guild disimpan.');
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menyimpan guild.');
    }
  }

  async function handleSaveRate(role: RoleName) {
    setFeedback(null);
    try {
      await apiFetch('/settings/rates', {
        method: 'PUT',
        body: JSON.stringify({ role, rateIdr: Math.trunc(Number(rateInputs[role])) }),
      });
      setFeedback(`Tarif ${role} diperbarui ke ${formatIdr(rateInputs[role])}. Periode lama tidak berubah.`);
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mengubah tarif.');
    }
  }

  async function handleAddRoleAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!newAlias.trim()) return;
    setFeedback(null);
    try {
      await apiFetch('/settings/role-aliases', {
        method: 'POST',
        body: JSON.stringify({ alias: newAlias.trim(), role: newAliasRole }),
      });
      setNewAlias('');
      setFeedback('Alias role ditambahkan.');
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menambah alias.');
    }
  }

  async function handleDeleteRoleAlias(id: string) {
    await apiFetch(`/settings/role-aliases/${id}`, { method: 'DELETE' });
    await loadAll();
  }

  async function handleSaveBotSettings(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/settings/bot', {
        method: 'PUT',
        body: JSON.stringify({
          notification_channel_id: notifChannelId.trim(),
          period_reminder_days_before_end: Number(reminderDays),
          admin_discord_user_ids: adminDiscordIds.split(',').map((s) => s.trim()).filter(Boolean),
          admin_discord_role_ids: adminRoleIds.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      setFeedback('Pengaturan Bot & Notifikasi disimpan.');
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan bot.');
    }
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
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
      setAdmEmail('');
      setAdmName('');
      setAdmPass('');
      setAdmDiscordUid('');
      setFeedback('Akun admin baru dibuat.');
      await loadAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal membuat akun admin.');
    }
  }

  async function handleToggleAdminUser(u: AdminUserItem) {
    await apiFetch(`/settings/admin-users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !u.is_active }),
    });
    await loadAll();
  }

  if (!data) {
    return <div className="text-sm text-slate-400 py-8">Memuat pengaturan...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          Pengaturan Sistem & Audit Log
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Perubahan tarif, konfigurasi server, dan manajemen pengguna Owner/Admin/Viewer diperiksa di backend.
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payroll Rates */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Tarif per Chapter (IDR)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Solo adalah role tersendiri (bukan Translator + Editor). Perubahan tarif hanya berlaku untuk laporan baru; snapshot periode lama tidak berubah.
            </p>
          </div>

          <div className="space-y-3">
            {(['Translator', 'Editor', 'Solo'] as const).map((r) => (
              <div key={r} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-800 w-28">{r}</span>
                <input
                  type="number"
                  min={0}
                  disabled={!isOwner}
                  value={rateInputs[r]}
                  onChange={(e) => setRateInputs((prev) => ({ ...prev, [r]: Number(e.target.value) }))}
                  className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                />
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => void handleSaveRate(r)}
                    className="px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    Simpan
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Role Aliases */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Mapping Alias Role</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Normalisasi kata kunci laporan Discord ke role payroll resmi.
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
                    onClick={() => void handleDeleteRoleAlias(ra.id)}
                    className="text-slate-400 hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canAdmin && (
            <form onSubmit={handleAddRoleAlias} className="flex gap-2">
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
              <button type="submit" className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                Tambah
              </button>
            </form>
          )}
        </div>

        {/* Discord Guild Config */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Discord Guild & Timezone</h2>
          <form onSubmit={handleSaveGuild} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Studio / Server</label>
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
              <button type="submit" className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                Simpan Konfigurasi Guild
              </button>
            )}
          </form>
        </div>

        {/* Bot & Notification Settings */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Pengaturan Bot & Notifikasi</h2>
          <form onSubmit={handleSaveBotSettings} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Channel Notifikasi Discord ID</label>
              <input
                type="text"
                disabled={!isOwner}
                value={notifChannelId}
                onChange={(e) => setNotifChannelId(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Admin Discord User IDs (pisahkan koma)</label>
              <input
                type="text"
                disabled={!isOwner}
                value={adminDiscordIds}
                onChange={(e) => setAdminDiscordIds(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Admin Discord Role IDs</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={adminRoleIds}
                  onChange={(e) => setAdminRoleIds(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Pengingat Tutup Periode (Hari)</label>
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
              <button type="submit" className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer">
                Simpan Pengaturan Bot
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Admin Users (Owner Only) */}
      {isOwner && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Pengguna Admin Dashboard</h2>
              <p className="text-xs text-slate-500">Hanya Owner yang dapat membuat dan mengelola akses Owner, Admin, atau Viewer.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewAdmin(true)}
              className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
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
                  <tr key={u.id}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{u.full_name}</td>
                    <td className="py-2.5 px-4 font-mono">{u.email}</td>
                    <td className="py-2.5 px-4 font-medium">{u.role}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500">{u.discord_user_id || '-'}</td>
                    <td className="py-2.5 px-4">{u.is_active ? 'Aktif' : 'Nonaktif'}</td>
                    <td className="py-2.5 px-4 text-right">
                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() => void handleToggleAdminUser(u)}
                          className="text-slate-700 underline cursor-pointer"
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

      {/* Audit Log Viewer */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Audit Log Sistem</h2>
          <p className="text-xs text-slate-500">Jejak perubahan laporan, pembayaran, tarif, dan periode payroll.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-4 font-medium">Waktu</th>
                <th className="py-2.5 px-4 font-medium">Aktor</th>
                <th className="py-2.5 px-4 font-medium">Aksi</th>
                <th className="py-2.5 px-4 font-medium">Entitas</th>
                <th className="py-2.5 px-4 font-medium">Alasan / Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id}>
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
      </div>

      {/* Add Admin Modal */}
      {showNewAdmin && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Tambah Akun Admin</h2>
              <button type="button" onClick={() => setShowNewAdmin(false)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAdmin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap</label>
                <input type="text" required value={admName} onChange={(e) => setAdmName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input type="email" required value={admEmail} onChange={(e) => setAdmEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                  <select value={admRole} onChange={(e) => setAdmRole(e.target.value as AdminRole)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white">
                    <option value="Owner">Owner</option>
                    <option value="Admin">Admin</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Discord User ID</label>
                  <input type="text" value={admDiscordUid} onChange={(e) => setAdmDiscordUid(e.target.value)} className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg" placeholder="Opsional" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password (min 8 karakter)</label>
                <input type="password" required minLength={8} value={admPass} onChange={(e) => setAdmPass(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNewAdmin(false)} className="px-4 py-2 text-sm text-slate-700 cursor-pointer">Batal</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg cursor-pointer">Buat Akun</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
