#!/usr/bin/env bash
set -euo pipefail

# Daily encrypted Supabase PostgreSQL backup to remote off-site storage
# Usage: Cron 0 2 * * * /opt/comicpay/scripts/backup.sh

ENV_FILE="${ENV_FILE:-/opt/comicpay/.env}"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL wajib diisi di .env}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE wajib diisi di .env}"
: "${BACKUP_REMOTE_TARGET:?BACKUP_REMOTE_TARGET wajib diisi di .env}"

TIMESTAMP=$(TZ="Asia/Jakarta" date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/tmp/comicpay-backups"
RAW_FILE="${BACKUP_DIR}/comicpay_${TIMESTAMP}.sql.gz"
ENC_FILE="${RAW_FILE}.gpg"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

echo "[Backup] Dumping Supabase PostgreSQL at ${TIMESTAMP}..."
pg_dump "${DATABASE_URL}" --no-owner --no-acl --format=plain | gzip > "${RAW_FILE}"

if [ ! -s "${RAW_FILE}" ]; then
  echo "[Backup] Error: PostgreSQL dump kosong!"
  rm -f "${RAW_FILE}"
  exit 1
fi

echo "[Backup] Encrypting dump..."
gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
  -o "${ENC_FILE}" "${RAW_FILE}"

rm -f "${RAW_FILE}"

echo "[Backup] Uploading to off-site remote ${BACKUP_REMOTE_TARGET}..."
rclone copy "${ENC_FILE}" "${BACKUP_REMOTE_TARGET}/"
rclone delete --min-age "${BACKUP_RETENTION_DAYS:-30}d" "${BACKUP_REMOTE_TARGET}/"

rm -f "${ENC_FILE}"
echo "[Backup] Completed safely."
