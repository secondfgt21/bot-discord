import React, { useEffect, useState } from 'react';
import {
  Archive,
  Bell,
  BookOpen,
  CheckCheck,
  CreditCard,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { ArchiveView } from './components/ArchiveView.tsx';
import { EmployeesView } from './components/EmployeesView.tsx';
import { LoginView } from './components/LoginView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { PaymentsView } from './components/PaymentsView.tsx';
import { PayrollView } from './components/PayrollView.tsx';
import { ProjectsView } from './components/ProjectsView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { SheetRekapView } from './components/SheetRekapView.tsx';
import { StatusBadge, ToastProvider, useToast } from './components/ui/DashboardUI.tsx';
import { apiFetch, formatJakartaDateTime, getStoredToken, setStoredToken } from './lib/api.ts';
import type { AuthUser, Period } from './types.ts';

type TabKey =
  | 'overview'
  | 'sheet-rekap'
  | 'employees'
  | 'projects'
  | 'reports'
  | 'payroll'
  | 'payments'
  | 'archive'
  | 'settings';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean | number;
  created_at: string;
}

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    title: 'Utama',
    items: [
      { key: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
      { key: 'sheet-rekap', label: 'Sheet Rekap', icon: FileSpreadsheet },
      { key: 'reports', label: 'Laporan Discord', icon: FileText },
      { key: 'payroll', label: 'Payroll Bulanan', icon: Receipt },
      { key: 'payments', label: 'Riwayat Pembayaran', icon: CreditCard },
    ],
  },
  {
    title: 'Master Data',
    items: [
      { key: 'employees', label: 'Karyawan', icon: Users },
      { key: 'projects', label: 'Komik & Channel', icon: BookOpen },
      { key: 'archive', label: 'Arsip Periode', icon: Archive },
      { key: 'settings', label: 'Pengaturan & Log', icon: Settings },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function AppShell() {
  const toast = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [reportInitialStatus, setReportInitialStatus] = useState('');
  const [periods, setPeriods] = useState<Period[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingRead, setMarkingRead] = useState(false);

  async function refreshPeriods() {
    try {
      const res = await apiFetch<{ periods: Period[] }>('/periods');
      setPeriods(res.periods);
    } catch {
      // ignore transient error
    }
  }

  async function refreshNotifications() {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/notifications'
      );
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // ignore transient error
    }
  }

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    void (async () => {
      try {
        const res = await apiFetch<{ user: AuthUser }>('/auth/me');
        setUser(res.user);
      } catch {
        setStoredToken(null);
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshPeriods();
    void refreshNotifications();
  }, [user]);

  function handleLogout() {
    setStoredToken(null);
    setUser(null);
    setActiveTab('overview');
    setMobileMenuOpen(false);
    toast.info('Sesi berakhir', 'Anda telah keluar dari Admin Dashboard ComicPay.');
  }

  async function handleMarkAllRead() {
    if (user?.role === 'Viewer') return;
    setMarkingRead(true);
    try {
      await apiFetch('/notifications/read-all', { method: 'POST' });
      await refreshNotifications();
      toast.success('Semua notifikasi ditandai sudah dibaca.');
    } catch (err) {
      toast.error('Gagal menandai notifikasi', err instanceof Error ? err.message : undefined);
    } finally {
      setMarkingRead(false);
    }
  }

  function navigateTo(key: TabKey) {
    if (key !== 'reports') setReportInitialStatus('');
    setActiveTab(key);
    setMobileMenuOpen(false);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 text-sm text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin text-slate-900" />
        <span>Memuat sesi ComicPay...</span>
      </div>
    );
  }

  if (!user) {
    return <LoginView onSuccess={(u) => setUser(u)} />;
  }

  const currentNav = ALL_NAV_ITEMS.find((n) => n.key === activeTab);
  const activePeriod = periods.find((p) => p.status !== 'CLOSED') || periods[0];

  const renderSidebarNav = () => (
    <nav className="flex-1 p-3 space-y-5 overflow-y-auto">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.title}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigateTo(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-white border-r border-slate-200 shrink-0 sticky top-0 h-screen">
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm tracking-tight">
              CP
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 block leading-none">
                ComicPay
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">Admin Console</span>
            </div>
          </div>
        </div>

        {renderSidebarNav()}

        <div className="p-4 border-t border-slate-200 bg-slate-50/60 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">{user.fullName}</div>
              <div className="text-[11px] text-slate-500 truncate mt-0.5">{user.email}</div>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-white border border-slate-200 text-slate-700 shrink-0">
              <Shield className="w-3 h-3 text-slate-500" />
              {user.role}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 w-full px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-72 max-w-[85vw] bg-white border-r border-slate-200 h-full flex flex-col shadow-xl">
            <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
                  CP
                </div>
                <span className="text-base font-bold text-slate-900">ComicPay</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
                aria-label="Tutup menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {renderSidebarNav()}

            <div className="p-4 border-t border-slate-200 bg-slate-50 text-xs">
              <div className="font-semibold text-slate-900 truncate">{user.fullName}</div>
              <div className="text-slate-500 truncate mt-0.5">
                {user.email} · {user.role}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-3 w-full px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar</span>
              </button>
            </div>
          </div>
          <div
            className="flex-1 bg-slate-900/45"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
              aria-label="Buka navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="hidden sm:inline">ComicPay</span>
              <span className="hidden sm:inline text-slate-300">/</span>
              <span className="font-semibold text-slate-900 truncate">{currentNav?.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activePeriod && (
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span className="text-slate-500">Periode:</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {activePeriod.period_key}
                </span>
                <StatusBadge status={activePeriod.status} />
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowNotifs((v) => !v);
                void refreshNotifications();
              }}
              className="relative px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              <Bell className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">Notifikasi</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.2 bg-rose-50 text-rose-700 border border-rose-200 rounded font-mono tabular-nums text-[11px] font-semibold">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'overview' && (
            <OverviewView
              user={user}
              periods={periods}
              onNavigateReportsPending={() => {
                setReportInitialStatus('pending');
                setActiveTab('reports');
              }}
            />
          )}
          {activeTab === 'sheet-rekap' && <SheetRekapView user={user} periods={periods} />}
          {activeTab === 'employees' && <EmployeesView user={user} />}
          {activeTab === 'projects' && <ProjectsView user={user} />}
          {activeTab === 'reports' && (
            <ReportsView
              user={user}
              periods={periods}
              initialStatusFilter={reportInitialStatus}
            />
          )}
          {activeTab === 'payroll' && <PayrollView user={user} periods={periods} />}
          {activeTab === 'payments' && <PaymentsView user={user} periods={periods} />}
          {activeTab === 'archive' && (
            <ArchiveView user={user} onPeriodsUpdated={() => void refreshPeriods()} />
          )}
          {activeTab === 'settings' && <SettingsView user={user} />}
        </main>
      </div>

      {/* Notifications Drawer */}
      {showNotifs && (
        <div className="fixed inset-0 z-50 bg-slate-900/35 flex justify-end">
          <div className="flex-1" onClick={() => setShowNotifs(false)} />
          <div className="bg-white w-full max-w-md h-full border-l border-slate-200 flex flex-col shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Notifikasi Sistem</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua notifikasi sudah dibaca'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {user.role !== 'Viewer' && unreadCount > 0 && (
                  <button
                    type="button"
                    disabled={markingRead}
                    onClick={() => void handleMarkAllRead()}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Tandai dibaca</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotifs(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                  aria-label="Tutup panel notifikasi"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  Belum ada notifikasi aktivitas sistem.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 text-xs space-y-1.5 transition-colors ${
                      !n.is_read ? 'bg-slate-50/90' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-900 leading-snug">{n.title}</span>
                      {!n.is_read && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-900 text-white rounded shrink-0">
                          Baru
                        </span>
                      )}
                    </div>
                    <div className="text-slate-600 leading-relaxed break-words">{n.message}</div>
                    <div className="text-slate-400 font-mono tabular-nums text-[11px]">
                      {formatJakartaDateTime(n.created_at)} WIB
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
