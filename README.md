# ComicPay — Discord Payroll Management System

Sistem pencatatan pekerjaan translator, editor, dan solo komik melalui Discord dengan Admin Dashboard, Smart Report Parser deterministik, kalkulasi gaji integer Rupiah, manajemen pembayaran, periode bulanan `Asia/Jakarta`, audit log lengkap, serta paket deployment VPS Ubuntu 24.04 LTS.

## Arsitektur Production (Single Unified Process)
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript (`server.ts`)
- **Discord Bot**: `discord.js` v14 (berjalan terintegrasi di proses backend yang sama)
- **Database & ORM**: Supabase PostgreSQL + Drizzle ORM (`server/schema.ts`, `drizzle/`)
- **Scheduler**: Single-instance `Asia/Jakarta` scheduler (`pg_try_advisory_lock`)
- **Reverse Proxy & Process Manager**: Nginx + Let's Encrypt HTTPS + Systemd (opsi Docker Compose)

Semua komponen (Discord Bot, Backend API, Admin Dashboard, Scheduler) menggunakan satu database Supabase PostgreSQL dan satu sumber business logic (`server/payrollService.ts` + `server/parser.ts`).

## Setup Database & Inisialisasi Owner Pertama

1. Salin dan lengkapi `.env`:
```bash
cp .env.example .env
chmod 600 .env
```
Isi minimal `DATABASE_URL` (Supabase PostgreSQL), `JWT_SECRET` (min 32 karakter acak), `DISCORD_BOT_TOKEN`, dan `DISCORD_GUILD_ID`.

2. Install dependencies & jalankan migrasi + seed tarif default:
```bash
npm ci
npm run db:migrate
npm run db:seed
```
`npm run db:seed` hanya mengisi tarif default (`Translator = Rp3.000`, `Editor = Rp3.000`, `Solo = Rp6.000`) dan alias role (`ETL`, `Translator`, `TL`, `TS`, `Editor`, `Solo`). **Tidak ada data karyawan, komik, Discord ID, atau password default palsu.**

3. Buat akun **Owner pertama** secara aman via CLI:
```bash
npm run create-owner
```
Atau buka Admin Dashboard di browser saat pertama kali berjalan — sistem otomatis menampilkan **Setup Wizard Akun Owner Pertama** (dilindungi `SETUP_TOKEN` jika disetel di `.env`, dan otomatis terkunci permanen setelah Owner pertama dibuat).

## Menjalankan Aplikasi
```bash
# Development
npm run dev

# Production Build & Start
npm run build
NODE_ENV=production npm run start
```

## Menjalankan Automated Tests
```bash
npm test
```

## Dokumentasi Deployment VPS
Lihat `docs/ARCHITECTURE_AND_DEPLOYMENT.md` untuk panduan lengkap Supabase migration, Discord Developer Portal, Systemd, Nginx + Let's Encrypt HTTPS, serta backup terenkripsi PostgreSQL (`scripts/backup.sh` & `scripts/restore.sh`).
