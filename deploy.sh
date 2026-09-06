#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then echo 'ERROR: create .env from .env.example first.'; exit 1; fi
set -a; source .env; set +a
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing}"
: "${JWT_SECRET:?JWT_SECRET missing}"
if [[ ${#JWT_SECRET} -lt 64 ]]; then echo 'ERROR: JWT_SECRET must be at least 64 characters.'; exit 1; fi
if [[ ${#POSTGRES_PASSWORD} -lt 24 ]]; then echo 'ERROR: POSTGRES_PASSWORD must be at least 24 characters.'; exit 1; fi
docker compose up -d --build
echo 'Waiting for HADI health...'
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:${PORT:-3000}/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:${PORT:-3000}/health
if [[ -n "${BOOTSTRAP_OWNER_EMAIL:-}" && -n "${BOOTSTRAP_OWNER_PASSWORD:-}" ]]; then
  docker compose exec -T web npm run bootstrap
  echo 'Owner bootstrap completed. Remove BOOTSTRAP_OWNER_* values from .env after first use.'
fi
docker compose exec -T web npm run import-indicators
