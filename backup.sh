#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
# Database backup
DUMP="backups/hadi-db-${STAMP}.dump"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-hadi}" -d "${POSTGRES_DB:-hadi}" -Fc > "$DUMP"
# Uploaded evidence backup
UPLOAD="backups/hadi-uploads-${STAMP}.tar.gz"
docker run --rm -v hadi_uploads:/data -v "$PWD/backups":/backup alpine:3.20 tar -czf "/backup/$(basename "$UPLOAD")" -C /data .
sha256sum "$DUMP" "$UPLOAD" > "backups/SHA256SUMS-${STAMP}.txt"
# Keep 14 days locally
find backups -type f -mtime +14 -delete
echo "Backup complete: $STAMP"
