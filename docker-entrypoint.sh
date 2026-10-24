#!/bin/sh
set -eu

mkdir -p /app/data

if [ -z "${APP_TOKEN:-}" ]; then
  token_file=/app/data/.app-token
  if [ -s "$token_file" ]; then
    APP_TOKEN=$(cat "$token_file")
  else
    APP_TOKEN=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
    (umask 077 && printf '%s' "$APP_TOKEN" > "$token_file")
    printf 'Generated GreenReach workspace token (save this; shown only on first start): %s\n' "$APP_TOKEN"
  fi
  export APP_TOKEN
fi

exec node server/index.js
