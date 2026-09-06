#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:?Usage: $0 hadi.sa [email]}"
EMAIL="${2:?Usage: $0 hadi.sa admin@example.com}"
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --hsts --staple-ocsp --email "$EMAIL" --agree-tos --no-eff-email
systemctl enable --now certbot.timer || true
