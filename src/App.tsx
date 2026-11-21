import React, { useEffect, useState } from 'react';
import {
  Archive,
  Bell,
  BookOpen,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
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
import { apiFetch, formatJakartaDateTime, getStoredToken, setStoredToken } from './lib/api.ts';
import type { AuthUser, Period } from './types.ts';

type TabKey =
  | 'overview'
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

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'employees', label: 'Employees', icon: Users },
  { key: 'projects', label: 'Comics & Channels', icon: BookOpen },
  { key: 'reports', label: 'Reports', icon: FileText },
  { key: 'payroll', label: 'Payroll', icon: Receipt },
  { key: 'payments', label: 'Payment History', icon: CreditCard },
  { key: 'archive', label: 'Monthly Archive', icon: Archive },
  { key: 'settings', label: 'Settings & Logs', icon: Settings },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [reportInitialStatus, setReportInitialStatus] = useState('');
  const [periods, setPeriods] = useState<Period[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  async function refreshPeriods() {
    const res = await apiFetch<{ periods: Period[] }>('/periods');
    setPeriods(res.periods);
  }

  async function refreshNotifications() {
    const res = await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>(
      '/notifications'
    );
    setNotifications(res.notifications);
    setUnreadCount(res.unreadCount);
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
  }

  async function handleMarkAllRead() {
    if (user?.role === 'Viewer') return;
    await apiFetch('/notifications/read-all', { method: 'POST' });
    await refreshNotifications();
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        Memuat sesi ComicPay...
      </div>
    );
  }

  if (!user) {
    return <LoginView onSuccess={(u) => setUser(u)} />;
  }

  const currentNav = NAV_ITEMS.find((n) => n.key === activeTab);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-white border-r border-slate-200 shrink-0">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            ComicPay
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.key !== 'reports') setReportInitialStatus('');
                  setActiveTab(item.key);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
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
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs">
          <div className="font-semibold text-slate-900 truncate">{user.fullName}</div>
          <div className="text-slate-500 truncate mt-0.5">{user.email}</div>
          <div className="text-slate-600 font-medium mt-1">Akses: {user.role}</div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 w-full px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-64 bg-white border-r border-slate-200 h-full flex flex-col">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
              <span className="text-lg font-bold text-slate-900">ComicPay</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-500 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${
                      active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 text-xs">
              <div className="font-semibold text-slate-900">{user.fullName} ({user.role})</div>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2 w-full px-3 py-2 text-xs font-medium bg-slate-100 rounded-lg"
              >
                Keluar
              </button>
            </div>
          </div>
          <div className="flex-1 bg-slate-900/40" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 cursor-pointer"
              aria-label="Buka navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-500 truncate">
              <span>ComicPay</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="font-medium text-slate-900">{currentNav?.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowNotifs((v) => !v);
                void refreshNotifications();
              }}
              className="relative px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Bell className="w-4 h-4" />
              <span>Notifikasi</span>
              {unreadCount > 0 && (
                <span className="font-mono tabular-nums text-rose-700 font-semibold">
                  ({unreadCount})
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
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex justify-end">
          <div className="bg-white w-full max-w-md h-full border-l border-slate-200 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Notifikasi Sistem</h2>
              <div className="flex items-center gap-3">
                {user.role !== 'Viewer' && unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleMarkAllRead()}
                    className="text-xs text-slate-600 underline cursor-pointer"
                  >
                    Tandai semua dibaca
                  </button>
                )}
                <button type="button" onClick={() => setShowNotifs(false)} className="text-slate-400 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">Belum ada notifikasi.</div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`p-4 text-xs space-y-1 ${!n.is_read ? 'bg-slate-50' : ''}`}>
                    <div className="font-semibold text-slate-900">{n.title}</div>
                    <div className="text-slate-600">{n.message}</div>
                    <div className="text-slate-400 font-mono">{formatJakartaDateTime(n.created_at)}</div>
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
