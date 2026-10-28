#!/usr/bin/env bash
set -eo pipefail
umask 077

BACKUP_DIR="${STUDIO_BACKUP_DIR:-/var/backups/chicongphoto}"
ENV_FILE="${STUDIO_ENV_FILE:-/var/www/chicongphoto/.env}"
DATE=$(date +"%Y%m%d_%H%M%S")

mkdir -p "$BACKUP_DIR"

# Read DATABASE_URL from .env
if [ -f "$ENV_FILE" ]; then
  # Use Node's dotenv parser, including quoted values, spaces and comments.
  DATABASE_URL=$(node -e '
    const fs = require("fs");
    const {parseEnv} = require("node:util");
    process.stdout.write(parseEnv(fs.readFileSync(process.argv[1], "utf8")).DATABASE_URL || "");
  ' "$ENV_FILE")
fi

if [ -z "$DATABASE_URL" ]; then
  echo "[ERROR] $(date): DATABASE_URL not found in $ENV_FILE" >&2
  exit 1
fi

echo "[INFO] $(date): Bắt đầu sao lưu cơ sở dữ liệu Supabase..."

# Publish only a complete dump. Unique names also protect overlapping runs in
# the same second; an interrupted/failed run never looks like a usable backup.
TEMP_FILE=$(mktemp "$BACKUP_DIR/.db_${DATE}.XXXXXX")
trap 'rm -f -- "$TEMP_FILE"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
BACKUP_FILE="$BACKUP_DIR/db_${DATE}_${TEMP_FILE##*.}.sql.gz"
pg_dump --exclude-table-data='*.drive_comparison_cache' --exclude-table-data='*.drive_folder_preview_cache' "$DATABASE_URL" | gzip > "$TEMP_FILE"
gzip -t "$TEMP_FILE"
chmod 600 "$TEMP_FILE"
# Hard-link publication fails instead of overwriting an existing backup.
ln "$TEMP_FILE" "$BACKUP_FILE"

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[INFO] $(date): Sao lưu thành công: $BACKUP_FILE ($FILE_SIZE)"

# Retain last 14 days of backups
find "$BACKUP_DIR" -type f -name "db_*.sql.gz" -mtime +14 -delete
echo "[INFO] $(date): Đã dọn dẹp các bản backup cũ hơn 14 ngày."
