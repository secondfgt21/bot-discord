# ComicPay — Architecture, Supabase Migration & VPS Deployment Guide

## 1. Unified Production Architecture (Ubuntu VPS 2 vCPU / 4 GB RAM)
```
Discord Server (Guild)
   │  (Gateway Events: MessageCreate / Update / Delete + Slash Commands)
   ▼
Unified Node.js Process (Express + discord.js + Single-Instance Scheduler)
   │  ▲
   │  │  Shared Business Logic (server/parser.ts + server/payrollService.ts)
   ▼  │
Supabase PostgreSQL (Drizzle ORM + 21 Normalized Tables + Advisory Locks)
   ▲
   │
Admin Browser ──► Nginx (HTTPS / Let's Encrypt) ──► Express (:3000) + Vite Dist
```

### Key Architectural Guarantees
1. **Single Process & Single Source of Truth**: Tidak ada backend atau bot kedua. `discord.js`, REST API `/api/*`, frontend static dist, dan scheduler berjalan efisien dalam satu proses Node.js (`MemoryMax=1500M`), sangat ringan untuk VPS 4 GB RAM.
2. **Database & ORM**: Menggunakan Supabase PostgreSQL via `pg.Pool` dan Drizzle ORM (`server/schema.ts`, migrasi SQL di `drizzle/`). SQLite telah dihapus sepenuhnya.
3. **Idempotency & Soft Duplicates**: `discord_message_id` unik sebagai idempotency key. Duplikat lintas pesan pada `(guild_id, project_id, chapter_number, member_id, role)` ditandai `duplicate_flag = true` dengan status `pending`.
4. **Tarif Snapshot & Audit Trail**: `Translator = Rp3.000`, `Editor = Rp3.000`, `Solo = Rp6.000` (role tersendiri). Perubahan tarif hanya memengaruhi laporan baru. Periode `CLOSED` menolak mutasi langsung dan mewajibkan `payroll_adjustments` atau `reopen` oleh `Owner`.
5. **Keamanan & Akun Owner Pertama**: Tidak ada registrasi publik dan tidak ada password default bawaan. Pembuatan Owner pertama dilakukan melalui `npm run create-owner` (SSH) atau Setup Wizard satu-kali (`POST /api/auth/setup-owner` dengan opsional `SETUP_TOKEN`), yang otomatis terkunci permanen setelah 1 Owner terdaftar.

---

## 2. Supabase Migration Steps
1. Buat project baru di [Supabase](https://supabase.com/dashboard) (disarankan region Singapore `ap-southeast-1` agar latensi ke Indonesia rendah).
2. Buka **Project Settings → Database → Connection string (URI)** dan salin ke `DATABASE_URL` di `.env`.
3. Jalankan migrasi Drizzle ke Supabase PostgreSQL:
```bash
npm run db:migrate
```
4. Jalankan seed tarif & alias role default:
```bash
npm run db:seed
```
5. Buat akun Owner pertama via CLI:
```bash
npm run create-owner
```

---

## 3. Discord Developer Portal Setup
1. Buka [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → **Bot**.
2. Aktifkan **Privileged Gateway Intents**:
   - **Message Content Intent**: WAJIB AKTIF.
   - **Server Members Intent**: AKTIF.
3. Salin Bot Token ke `DISCORD_BOT_TOKEN` di `.env`.
4. Invite bot via **OAuth2 → URL Generator** dengan scopes `bot`, `applications.commands` dan permissions `View Channels`, `Read Message History`, `Send Messages`, `Use Application Commands`.
5. Salin `Guild ID` ke `DISCORD_GUILD_ID` di `.env`.

---

## 4. VPS Ubuntu 24.04 LTS Deployment (Systemd + Nginx + Let's Encrypt)

```bash
# 1. Install Node.js 22, Nginx, Certbot, PostgreSQL client (untuk pg_dump), rclone, gnupg
sudo apt update && sudo apt install -y curl nginx certbot python3-certbot-nginx postgresql-client rclone gnupg
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Siapkan direktori aplikasi & environment
sudo mkdir -p /opt/comicpay /var/log/comicpay
sudo chown -R $USER:$USER /opt/comicpay /var/log/comicpay
cd /opt/comicpay
# (Clone repository ke /opt/comicpay)
cp .env.example .env
chmod 600 .env
nano .env

# 3. Install dependencies, build frontend, migrasi Supabase & seed tarif default
npm ci
npm run build
npm run db:migrate
npm run db:seed
npm run create-owner

# 4. Pasang Systemd service (single process)
sudo cp deployment/systemd/comicpay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now comicpay
sudo systemctl status comicpay

# 5. Konfigurasi Nginx & Let's Encrypt HTTPS
sudo cp deployment/nginx/comicpay.nginx.conf /etc/nginx/sites-available/comicpay
sudo sed -i 's/your-dashboard-domain.com/payroll.domainanda.com/g' /etc/nginx/sites-available/comicpay
sudo ln -sf /etc/nginx/sites-available/comicpay /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d payroll.domainanda.com

# 6. Pasang Logrotate & Daily Encrypted PostgreSQL Backup Cron (02:00 WIB)
sudo cp deployment/logrotate/comicpay /etc/logrotate.d/comicpay
chmod +x scripts/backup.sh scripts/restore.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/comicpay/scripts/backup.sh >> /var/log/comicpay/backup.log 2>&1") | crontab -
```

### Docker Compose (Alternatif)
```bash
docker compose up -d --build
```
Menjalankan 1 container `comicpay-app` dengan batas `mem_limit: 1536m`, `cpus: "1.5"`, menyisakan RAM > 2.4 GB untuk OS & Nginx pada VPS 4 GB RAM.
