#!/usr/bin/env bash
# CI 专用：bun install 遇 registry 瞬时 ConnectionRefused 时重试。
set -euo pipefail

max="${BUN_INSTALL_RETRIES:-5}"
for attempt in $(seq 1 "$max"); do
  if bun install --frozen-lockfile "$@"; then
    exit 0
  fi
  echo "::warning::bun install --frozen-lockfile failed (attempt ${attempt}/${max})"
  if [ "$attempt" -lt "$max" ]; then
    sleep $((attempt * 20))
  fi
done
exit 1
