#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: $0 backups/hadi-db-YYYYMMDD-HHMMSS.dump"; exit 1; fi
cd "$(dirname "$0")/.."
set -a; source .env; set +a
read -r -p 'WARNING: this replaces database data. Type RESTORE to continue: ' CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || exit 1
cat "$1" | docker compose exec -T db pg_restore -U "${POSTGRES_USER:-hadi}" -d "${POSTGRES_DB:-hadi}" --clean --if-exists --no-owner
