#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd /Users/mikeserver/Desktop/luckynekoAI

TUNNEL_TOKEN="eyJhIjoiOGYyMTM5OWFlZThlNDkwNGM0MjkzY2QzOGVhYmZhYmIiLCJ0IjoiNDVlZDQ2NWYtYzNhMi00MDhlLTg1MjMtMzdkMTJhMmJiNWEwIiwicyI6Ik16VTVZMlExT1dVdFkyUmpOaTAwTVdVeUxUa3dOVGd0TWpKa05ERXpNREk0WXpjdyJ9"

cleanup() {
  local exit_code=$?

  if [[ -n "${APP_PID:-}" ]]; then
    kill "${APP_PID}" 2>/dev/null || true
  fi

  if [[ -n "${TUNNEL_PID:-}" ]]; then
    kill "${TUNNEL_PID}" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

if [ ! -d node_modules ]; then
  /opt/homebrew/bin/npm ci
fi

/opt/homebrew/bin/npm run start &
APP_PID=$!

# Give Next a moment to bind before exposing it.
sleep 3

/opt/homebrew/bin/cloudflared tunnel run --token "${TUNNEL_TOKEN}" &
TUNNEL_PID=$!

wait "${APP_PID}" "${TUNNEL_PID}"
