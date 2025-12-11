#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "${API_KEY:-}" ]]; then
  echo "API_KEY environment variable is not set." >&2
  echo "Provide your Torn API key via API_KEY to fetch elimination data." >&2
  exit 1
fi

cd "$ROOT_DIR"
node "$SCRIPT_DIR/generate-elimination.js"
