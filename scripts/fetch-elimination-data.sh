#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "${API_KEY:-}" ]]; then
  echo "API_KEY environment variable is not set." >&2
  echo "Provide your Torn API key via API_KEY to fetch elimination data." >&2
  exit 1
fi

if [[ -n "${FF_API_KEY:-}" ]]; then
  echo "Using FFScouter key from FF_API_KEY for battle stat estimates." >&2
elif [[ -n "${FFSCOUTER_API_KEY:-}" ]]; then
  echo "Using FFScouter key from FFSCOUTER_API_KEY for battle stat estimates." >&2
else
  echo "No FFScouter key provided; battle stat estimates will be placeholders." >&2
fi

if [[ -n "${REQUEST_DELAY_SECONDS:-}" ]]; then
  echo "Request delay set to ${REQUEST_DELAY_SECONDS}s between calls." >&2
fi

cd "$ROOT_DIR"
node "$SCRIPT_DIR/generate-elimination.js"
