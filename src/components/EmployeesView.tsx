import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, Search, UserCheck, UserX, X } from 'lucide-react';
import { apiFetch, formatIdr, formatJakartaDateTime } from '../lib/api.ts';
import type { AuthUser, RoleName } from '../types.ts';

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

export function EmployeesView({ user }: { user: AuthUser }) {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<EmployeeDetailResponse | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeSummary | null>(null);

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadEmployees(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  async function openDetail(id: string) {
    const data = await apiFetch<EmployeeDetailResponse>(`/employees/${id}`);
    setSelectedDetail(data);
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
      }
      setShowForm(false);
      await loadEmployees();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan karyawan.');
    }
  }

  async function handleToggleActive(emp: EmployeeSummary) {
    await apiFetch(`/employees/${emp.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !emp.is_active }),
    });
    await loadEmployees();
  }

  const canEdit = user.role !== 'Viewer';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Manajemen Karyawan
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Identitas pekerja ditautkan ke Discord User ID pengirim laporan.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau Discord ID..."
              className="pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 w-64 focus:outline-none focus:border-slate-900"
            />
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Karyawan</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-medium">Nama Tampilan</th>
                <th className="py-3 px-4 font-medium">Discord User ID</th>
                <th className="py-3 px-4 font-medium">Role</th>
                <th className="py-3 px-4 font-medium text-right">Total Ch</th>
                <th className="py-3 px-4 font-medium text-right">Penghasilan</th>
                <th className="py-3 px-4 font-medium text-right">Saldo Belum Dibayar</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    Memuat data karyawan...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Tidak ada karyawan ditemukan.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50">
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
                      {emp.roles.join(' · ') || '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                      {emp.total_chapters}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                      {formatIdr(emp.total_earned_idr)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700 font-medium">
                      {formatIdr(emp.unpaid_balance_idr)}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {emp.is_active ? (
                        <span className="text-emerald-700 font-medium">Aktif</span>
                      ) : (
                        <span className="text-slate-400 font-medium">Nonaktif</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => void openDetail(emp.id)}
                        className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                      >
                        Detail
                      </button>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(emp)}
                            className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleActive(emp)}
                            title={emp.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            className="inline-flex items-center text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                          >
                            {emp.is_active ? (
                              <UserX className="w-3.5 h-3.5" />
                            ) : (
                              <UserCheck className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingEmployee ? 'Edit Karyawan' : 'Tambah Karyawan Baru'}
              </h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
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
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                        formRoles.includes(r)
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                >
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Detail Drawer / Modal */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 border-l border-slate-200 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {selectedDetail.employee.display_name}
                </h2>
                <p className="text-xs text-slate-500 mt-1 font-mono">
                  Discord ID: {selectedDetail.employee.discord_user_id} · @{selectedDetail.employee.discord_username} ·{' '}
                  {selectedDetail.employee.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="translator_chapters" stackId="a" name="Translator" fill="#0f172a" />
                    <Bar dataKey="editor_chapters" stackId="a" name="Editor" fill="#475569" />
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
              <div className="border border-slate-200 rounded-lg overflow-hidden">
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
                        <td className="py-2 px-3">{ph.payment_status}</td>
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
                    <div key={py.id} className="px-3 py-2 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-medium text-slate-800">{py.method} · {py.transaction_ref || '-'}</div>
                        <div className="text-slate-500">{formatJakartaDateTime(py.paid_at)} · oleh {py.admin_name}</div>
                      </div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900">
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
