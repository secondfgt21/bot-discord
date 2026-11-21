import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2, Plus, Search, UserCheck, Users, UserX, X } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, RoleName } from '../types.ts';
import {
  ConfirmModal,
  EmptyState,
  SortableTh,
  StatusBadge,
  TableSkeleton,
  useToast,
  type SortDirection,
} from './ui/DashboardUI.tsx';

interface EmployeeSummary {
  id: string;
  discord_user_id: string;
  discord_username: string;
  display_name: string;
  is_active: boolean | number;
  notes: string;
  roles: RoleName[];
  total_chapters: number;
  total_earned_idr: number;
  total_paid_idr: number;
  unpaid_balance_idr: number;
}

interface EmployeeDetailResponse {
  employee: EmployeeSummary;
  totals: {
    translator_chapters: number;
    editor_chapters: number;
    solo_chapters: number;
    total_chapters: number;
    total_earned_idr: number;
    total_paid_idr: number;
    unpaid_balance_idr: number;
  };
  payrollHistory: Array<{
    id: string;
    period_key: string;
    period_status: string;
    translator_chapters: number;
    editor_chapters: number;
    solo_chapters: number;
    total_chapters: number;
    net_amount_idr: number;
    paid_amount_idr: number;
    remaining_amount_idr: number;
    payment_status: string;
  }>;
  paymentHistory: Array<{
    id: string;
    period_key: string;
    amount_idr: number;
    paid_at: string;
    method: string;
    transaction_ref: string;
    admin_name: string;
  }>;
  projectsWorked: Array<{ id: string; title: string; chapters: number; amount_idr: number }>;
  monthlyChart: Array<{
    period: string;
    translator_chapters: number;
    editor_chapters: number;
    solo_chapters: number;
    net_amount_idr: number;
  }>;
}

type SortKey = 'display_name' | 'total_chapters' | 'total_earned_idr' | 'unpaid_balance_idr';

export function EmployeesView({ user }: { user: AuthUser }) {
  const toast = useToast();
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('unpaid_balance_idr');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<EmployeeDetailResponse | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<EmployeeSummary | null>(null);
  const [toggling, setToggling] = useState(false);

  const [formDisplayName, setFormDisplayName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formDiscordId, setFormDiscordId] = useState('');
  const [formRoles, setFormRoles] = useState<RoleName[]>(['Translator']);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadEmployees(q = search) {
    setLoading(true);
    try {
      const data = await apiFetch<{ employees: EmployeeSummary[] }>(
        `/employees?search=${encodeURIComponent(q)}`
      );
      setEmployees(data.employees);
    } catch (err) {
      toast.error('Gagal memuat daftar karyawan', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void loadEmployees(search), 220);
    return () => window.clearTimeout(t);
  }, [search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'display_name' ? 'asc' : 'desc');
    }
  }

  const displayedEmployees = useMemo(() => {
    const list = employees.filter((emp) => {
      if (roleFilter && !emp.roles.includes(roleFilter as RoleName)) return false;
      if (statusFilter === 'active' && !emp.is_active) return false;
      if (statusFilter === 'inactive' && Boolean(emp.is_active)) return false;
      return true;
    });
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'display_name') return a.display_name.localeCompare(b.display_name) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
    return list;
  }, [employees, roleFilter, statusFilter, sortKey, sortDir]);

  async function openDetail(id: string) {
    try {
      const data = await apiFetch<EmployeeDetailResponse>(`/employees/${id}`);
      setSelectedDetail(data);
    } catch (err) {
      toast.error('Gagal memuat detail karyawan', err instanceof Error ? err.message : undefined);
    }
  }

  function openCreateModal() {
    setEditingEmployee(null);
    setFormDisplayName('');
    setFormUsername('');
    setFormDiscordId('');
    setFormRoles(['Translator']);
    setFormError(null);
    setShowForm(true);
  }

  function openEditModal(emp: EmployeeSummary) {
    setEditingEmployee(emp);
    setFormDisplayName(emp.display_name);
    setFormUsername(emp.discord_username);
    setFormDiscordId(emp.discord_user_id);
    setFormRoles(emp.roles.length > 0 ? emp.roles : ['Translator']);
    setFormError(null);
    setShowForm(true);
  }

  function toggleRole(r: RoleName) {
    setFormRoles((prev) =>
      prev.includes(r) ? (prev.length > 1 ? prev.filter((x) => x !== r) : prev) : [...prev, r]
    );
  }

  async function handleSaveEmployee(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (editingEmployee) {
        await apiFetch(`/employees/${editingEmployee.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: formDisplayName,
            discordUsername: formUsername,
            discordUserId: formDiscordId,
            roles: formRoles,
          }),
        });
        toast.success('Data karyawan diperbarui', formDisplayName);
      } else {
        await apiFetch('/employees', {
          method: 'POST',
          body: JSON.stringify({
            displayName: formDisplayName,
            discordUsername: formUsername,
            discordUserId: formDiscordId,
            roles: formRoles,
          }),
        });
        toast.success('Karyawan baru ditambahkan', formDisplayName);
      }
      setShowForm(false);
      await loadEmployees();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan karyawan.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggleActive() {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await apiFetch(`/employees/${toggleTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !toggleTarget.is_active }),
      });
      toast.success(
        toggleTarget.is_active ? 'Karyawan dinonaktifkan' : 'Karyawan diaktifkan kembali',
        toggleTarget.display_name
      );
      setToggleTarget(null);
      await loadEmployees();
    } catch (err) {
      toast.error('Gagal mengubah status karyawan', err instanceof Error ? err.message : undefined);
    } finally {
      setToggling(false);
    }
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Manajemen Karyawan
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-mono tabular-nums font-medium text-slate-700">
              {displayedEmployees.length}
            </span>{' '}
            karyawan · Identitas pekerja ditautkan ke Discord User ID pengirim laporan.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Karyawan</span>
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter Role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="">Semua Role</option>
            <option value="Translator">Translator</option>
            <option value="Editor">Editor</option>
            <option value="Solo">Solo</option>
          </select>

          <select
            aria-label="Filter Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="px-3 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="all">Semua Status</option>
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
          </select>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, username, Discord ID..."
            className="pl-9 pr-3.5 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-lg text-slate-900 w-full sm:w-64 focus:outline-none focus:border-slate-900"
          />
        </div>
      </div>

      {/* Table / Mobile Cards */}
      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : displayedEmployees.length === 0 ? (
        <EmptyState
          icon={<Users className="w-5 h-5" />}
          title="Tidak ada karyawan ditemukan"
          description="Tambahkan karyawan baru atau sesuaikan filter pencarian Anda."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <SortableTh
                    label="Nama Tampilan"
                    active={sortKey === 'display_name'}
                    direction={sortDir}
                    onClick={() => toggleSort('display_name')}
                  />
                  <th className="py-3 px-4 font-medium">Discord ID</th>
                  <th className="py-3 px-4 font-medium">Role</th>
                  <SortableTh
                    label="Total Ch"
                    align="right"
                    active={sortKey === 'total_chapters'}
                    direction={sortDir}
                    onClick={() => toggleSort('total_chapters')}
                  />
                  <SortableTh
                    label="Penghasilan"
                    align="right"
                    active={sortKey === 'total_earned_idr'}
                    direction={sortDir}
                    onClick={() => toggleSort('total_earned_idr')}
                  />
                  <SortableTh
                    label="Belum Dibayar"
                    align="right"
                    active={sortKey === 'unpaid_balance_idr'}
                    direction={sortDir}
                    onClick={() => toggleSort('unpaid_balance_idr')}
                  />
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => void openDetail(emp.id)}
                        className="font-medium text-slate-900 hover:underline text-left cursor-pointer"
                      >
                        {emp.display_name}
                      </button>
                      <div className="text-xs text-slate-500 font-mono">@{emp.discord_username}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                      {emp.discord_user_id}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      <div className="flex flex-wrap gap-1">
                        {emp.roles.length > 0 ? (
                          emp.roles.map((r) => (
                            <span
                              key={r}
                              className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[11px] font-medium text-slate-700"
                            >
                              {r}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">
                      {emp.total_chapters}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                      {formatIdr(emp.total_earned_idr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700 font-semibold">
                      {formatIdr(emp.unpaid_balance_idr)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <StatusBadge status={emp.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => void openDetail(emp.id)}
                          className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          Detail
                        </button>
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(emp)}
                              className="px-2.5 py-1 font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setToggleTarget(emp)}
                              title={emp.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                              className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-md cursor-pointer"
                            >
                              {emp.is_active ? (
                                <UserX className="w-3.5 h-3.5" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {displayedEmployees.map((emp) => (
              <div key={emp.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button
                      type="button"
                      onClick={() => void openDetail(emp.id)}
                      className="font-semibold text-slate-900 text-left cursor-pointer"
                    >
                      {emp.display_name}
                    </button>
                    <div className="text-xs font-mono text-slate-500">
                      @{emp.discord_username} · {emp.discord_user_id}
                    </div>
                  </div>
                  <StatusBadge status={emp.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </div>

                <div className="flex flex-wrap gap-1">
                  {emp.roles.map((r) => (
                    <span
                      key={r}
                      className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[11px] font-medium text-slate-700"
                    >
                      {r}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50 border border-slate-100 rounded-lg p-2.5 text-xs">
                  <div>
                    <div className="text-slate-500 text-[11px]">Chapter</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                      {emp.total_chapters}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Total</div>
                    <div className="font-mono tabular-nums font-medium text-slate-900 mt-0.5">
                      {formatIdr(emp.total_earned_idr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Belum Bayar</div>
                    <div className="font-mono tabular-nums font-semibold text-amber-700 mt-0.5">
                      {formatIdr(emp.unpaid_balance_idr)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => void openDetail(emp.id)}
                    className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  >
                    Detail
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(emp)}
                        className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setToggleTarget(emp)}
                        className="px-3 py-1.5 font-medium text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                      >
                        {emp.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Toggle Active */}
      <ConfirmModal
        open={Boolean(toggleTarget)}
        title={
          toggleTarget?.is_active
            ? `Nonaktifkan ${toggleTarget.display_name}?`
            : `Aktifkan kembali ${toggleTarget?.display_name}?`
        }
        description={
          toggleTarget?.is_active
            ? 'Karyawan nonaktif tetap menyimpan histori payroll sebelumnya.'
            : 'Karyawan akan ditandai aktif kembali di daftar pekerja.'
        }
        confirmLabel={toggleTarget?.is_active ? 'Ya, Nonaktifkan' : 'Ya, Aktifkan'}
        variant={toggleTarget?.is_active ? 'warning' : 'default'}
        loading={toggling}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingEmployee ? 'Edit Karyawan' : 'Tambah Karyawan Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveEmployee} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Tampilan</label>
                <input
                  type="text"
                  required
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Discord User ID</label>
                <input
                  type="text"
                  required
                  value={formDiscordId}
                  onChange={(e) => setFormDiscordId(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  placeholder="Contoh: 880000000000000105"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Discord Username</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  placeholder="Contoh: raka_tl"
                />
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-700 mb-1.5">Role Pekerjaan</span>
                <div className="flex gap-2">
                  {(['Translator', 'Editor', 'Solo'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRole(r)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                        formRoles.includes(r)
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Simpan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Detail Drawer */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="flex-1" onClick={() => setSelectedDetail(null)} />
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-6 shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xl font-semibold text-slate-900">
                    {selectedDetail.employee.display_name}
                  </h2>
                  <StatusBadge status={selectedDetail.employee.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </div>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  Discord ID: {selectedDetail.employee.discord_user_id} · @
                  {selectedDetail.employee.discord_username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="text-slate-400 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500">Translator</div>
                <div className="text-lg font-semibold font-mono tabular-nums mt-0.5">
                  {selectedDetail.totals.translator_chapters} ch
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500">Editor</div>
                <div className="text-lg font-semibold font-mono tabular-nums mt-0.5">
                  {selectedDetail.totals.editor_chapters} ch
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500">Solo</div>
                <div className="text-lg font-semibold font-mono tabular-nums mt-0.5">
                  {selectedDetail.totals.solo_chapters} ch
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500">Total Penghasilan</div>
                <div className="text-base font-semibold font-mono tabular-nums mt-0.5">
                  {formatIdr(selectedDetail.totals.total_earned_idr)}
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500">Sudah Dibayar</div>
                <div className="text-base font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
                  {formatIdr(selectedDetail.totals.total_paid_idr)}
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-xs text-slate-500">Sisa Pembayaran</div>
                <div className="text-base font-semibold font-mono tabular-nums text-amber-700 mt-0.5">
                  {formatIdr(selectedDetail.totals.unpaid_balance_idr)}
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Grafik Produktivitas Bulanan
              </h3>
              <div className="h-48 border border-slate-200 rounded-lg p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selectedDetail.monthlyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="translator_chapters" stackId="a" name="Translator" fill="#0f172a" />
                    <Bar dataKey="editor_chapters" stackId="a" name="Editor" fill="#64748b" />
                    <Bar dataKey="solo_chapters" stackId="a" name="Solo" fill="#059669" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                Komik yang Pernah Dikerjakan
              </h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {selectedDetail.projectsWorked.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">Belum ada komik.</div>
                ) : (
                  selectedDetail.projectsWorked.map((pw) => (
                    <div key={pw.id} className="px-3 py-2 flex justify-between text-xs">
                      <span className="font-medium text-slate-800">{pw.title}</span>
                      <span className="font-mono tabular-nums text-slate-600">
                        {pw.chapters} ch · {formatIdr(pw.amount_idr)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Riwayat Payroll</h3>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Periode</th>
                      <th className="py-2 px-3 text-right">Ch</th>
                      <th className="py-2 px-3 text-right">Total</th>
                      <th className="py-2 px-3 text-right">Sisa</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedDetail.payrollHistory.map((ph) => (
                      <tr key={ph.id}>
                        <td className="py-2 px-3 font-mono">{ph.period_key}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{ph.total_chapters}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{formatIdr(ph.net_amount_idr)}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{formatIdr(ph.remaining_amount_idr)}</td>
                        <td className="py-2 px-3">
                          <StatusBadge status={ph.payment_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Riwayat Pembayaran</h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {selectedDetail.paymentHistory.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">Belum ada pembayaran.</div>
                ) : (
                  selectedDetail.paymentHistory.map((py) => (
                    <div key={py.id} className="px-3 py-2 flex justify-between items-center text-xs gap-2">
                      <div>
                        <div className="font-medium text-slate-800">
                          {py.method} · {py.transaction_ref || '-'}
                        </div>
                        <div className="text-slate-500 font-mono">
                          {formatJakartaDateTime(py.paid_at)} WIB · oleh {py.admin_name}
                        </div>
                      </div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 shrink-0">
                        {formatIdr(py.amount_idr)}
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
