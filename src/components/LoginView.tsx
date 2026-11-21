import React, { useEffect, useState } from 'react';
import { Lock, LogIn, ShieldCheck } from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api.ts';
import type { AuthUser } from '../types.ts';

interface LoginViewProps {
  onSuccess: (user: AuthUser) => void;
}

interface SetupStatusResponse {
  needsSetup: boolean;
  requiresSetupToken: boolean;
}

export function LoginView({ onSuccess }: LoginViewProps) {
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [requiresSetupToken, setRequiresSetupToken] = useState(false);

  // Login fields (always empty — zero hardcoded default credentials)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Initial Owner Setup fields
  const [fullName, setFullName] = useState('');
  const [guildName, setGuildName] = useState('');
  const [discordGuildId, setDiscordGuildId] = useState('');
  const [setupToken, setSetupToken] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<SetupStatusResponse>('/auth/setup-status');
        setNeedsSetup(res.needsSetup);
        setRequiresSetupToken(res.requiresSetupToken);
      } catch {
        setNeedsSetup(false);
      } finally {
        setCheckingSetup(false);
      }
    })();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(data.token);
      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupOwner(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/auth/setup-owner', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          password,
          guildName: guildName || 'ComicPay Studio',
          discordGuildId: discordGuildId || undefined,
          setupToken: requiresSetupToken ? setupToken : undefined,
        }),
      });
      setStoredToken(data.token);
      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat akun Owner pertama.');
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-sm text-slate-500">Memeriksa status sistem ComicPay...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <div className="mb-7">
          <div className="flex items-center gap-2.5 text-slate-900 mb-3">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              {needsSetup ? <ShieldCheck className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            </div>
            <span className="text-xl font-bold tracking-tight">ComicPay</span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {needsSetup ? 'Inisialisasi Akun Owner Pertama' : 'Masuk ke Admin Dashboard'}
          </h1>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
            {needsSetup
              ? 'Belum ada admin terdaftar. Buat akun Owner pertama untuk mengunci setup awal dan mengaktifkan tarif default (Translator Rp3.000, Editor Rp3.000, Solo Rp6.000).'
              : 'Akses dibatasi untuk akun yang dibuat oleh Owner. Registrasi publik dinonaktifkan.'}
          </p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
            {error}
          </div>
        )}

        {needsSetup ? (
          <form onSubmit={handleSetupOwner} className="space-y-4">
            <div>
              <label htmlFor="setup-guild-name" className="block text-sm font-medium text-slate-700 mb-1">
                Nama Studio / Server
              </label>
              <input
                id="setup-guild-name"
                type="text"
                required
                value={guildName}
                onChange={(e) => setGuildName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="Nama Studio Scanlation"
              />
            </div>

            <div>
              <label htmlFor="setup-guild-id" className="block text-sm font-medium text-slate-700 mb-1">
                Discord Guild ID <span className="text-slate-400 font-normal">(opsional)</span>
              </label>
              <input
                id="setup-guild-id"
                type="text"
                inputMode="numeric"
                value={discordGuildId}
                onChange={(e) => setDiscordGuildId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="Angka Snowflake Server Discord"
              />
            </div>

            <div>
              <label htmlFor="setup-name" className="block text-sm font-medium text-slate-700 mb-1">
                Nama Lengkap Owner
              </label>
              <input
                id="setup-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="Nama Owner"
              />
            </div>

            <div>
              <label htmlFor="setup-email" className="block text-sm font-medium text-slate-700 mb-1">
                Email Owner
              </label>
              <input
                id="setup-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="owner@domainanda.com"
              />
            </div>

            <div>
              <label htmlFor="setup-password" className="block text-sm font-medium text-slate-700 mb-1">
                Password Kuat
              </label>
              <input
                id="setup-password"
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="Min 12 karakter (huruf besar, kecil, angka)"
              />
            </div>

            {requiresSetupToken && (
              <div>
                <label htmlFor="setup-token" className="block text-sm font-medium text-slate-700 mb-1">
                  Setup Token Server
                </label>
                <input
                  id="setup-token"
                  type="password"
                  required
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                  placeholder="Nilai SETUP_TOKEN dari .env VPS"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{loading ? 'Menginisialisasi...' : 'Buat Akun Owner Pertama'}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email Admin
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="nama@studio.com"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="••••••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Memverifikasi...' : 'Masuk Dashboard'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
