#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd /Users/mikeserver/Desktop/luckynekoAI

if [ ! -d node_modules ]; then
  /opt/homebrew/bin/npm ci
fi

exec /opt/homebrew/bin/npm run start
