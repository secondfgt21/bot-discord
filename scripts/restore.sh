#!/usr/bin/env bash
set -euo pipefail

# Restore & verify encrypted PostgreSQL backup to target database
# Usage: ./scripts/restore.sh comicpay_20261119_020000.sql.gz.gpg <TARGET_DATABASE_URL>

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <backup_filename.sql.gz.gpg> <target_postgres_url>"
  exit 1
fi

BACKUP_NAME="$1"
TARGET_DB_URL="$2"
ENV_FILE="${ENV_FILE:-/opt/comicpay/.env}"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE wajib diisi}"
: "${BACKUP_REMOTE_TARGET:?BACKUP_REMOTE_TARGET wajib diisi}"

TMP_DIR="/tmp/comicpay-restore"
mkdir -p "${TMP_DIR}"
chmod 700 "${TMP_DIR}"

rclone copy "${BACKUP_REMOTE_TARGET}/${BACKUP_NAME}" "${TMP_DIR}/"
gpg --batch --yes --decrypt --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
  -o "${TMP_DIR}/dump.sql.gz" "${TMP_DIR}/${BACKUP_NAME}"

gunzip -c "${TMP_DIR}/dump.sql.gz" | psql -v ON_ERROR_STOP=1 "${TARGET_DB_URL}"
rm -rf "${TMP_DIR}"

echo "[Restore] PostgreSQL database restored & verified."
