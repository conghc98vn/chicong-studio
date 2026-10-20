#!/usr/bin/env bash
set -eo pipefail
umask 077

BACKUP_DIR="/var/backups/chicongphoto"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/db_$DATE.sql.gz"

mkdir -p "$BACKUP_DIR"

# Read DATABASE_URL from .env
if [ -f /var/www/chicongphoto/.env ]; then
  # Extract connection string without surrounding quotes
  DATABASE_URL=$(node -e '
    const fs = require("fs");
    const content = fs.readFileSync("/var/www/chicongphoto/.env", "utf8");
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match) {
      let val = match[1].trim();
      if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("\x27") && val.endsWith("\x27"))) {
        val = val.slice(1, -1);
      }
      process.stdout.write(val);
    }
  ')
fi

if [ -z "$DATABASE_URL" ]; then
  echo "[ERROR] $(date): DATABASE_URL not found in /var/www/chicongphoto/.env" >&2
  exit 1
fi

echo "[INFO] $(date): Bắt đầu sao lưu cơ sở dữ liệu Supabase..."

# Run pg_dump and compress with gzip
pg_dump --exclude-table-data='*.drive_comparison_cache' --exclude-table-data='*.drive_folder_preview_cache' "$DATABASE_URL" | gzip > "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[INFO] $(date): Sao lưu thành công: $BACKUP_FILE ($FILE_SIZE)"

# Retain last 14 days of backups
find "$BACKUP_DIR" -type f -name "db_*.sql.gz" -mtime +14 -delete
echo "[INFO] $(date): Đã dọn dẹp các bản backup cũ hơn 14 ngày."
