#!/usr/bin/env bash
# Load project .env into the current shell (does not override existing exports).

load_dotenv() {
  local root="${1:-}"
  local env_file="${root}/.env"
  [ -n "$root" ] || return 0
  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -n "$line" ] || continue
    case "$line" in
      *=*)
        local key="${line%%=*}"
        local val="${line#*=}"
        key="$(echo "$key" | sed -e 's/[[:space:]]*$//')"
        val="$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        val="${val%\"}"
        val="${val#\"}"
        val="${val%\'}"
        val="${val#\'}"
        if [ -z "${!key:-}" ]; then
          export "$key=$val"
        fi
        ;;
    esac
  done < "$env_file"
}

n8n_public_url() {
  local base="${N8N_PUBLIC_URL:-${WEBHOOK_URL:-http://localhost:5678}}"
  base="${base%/}"
  echo "${base:-http://localhost:5678}"
}

n8n_internal_url() {
  local base="${N8N_INTERNAL_URL:-http://n8n:5678}"
  base="${base%/}"
  echo "${base:-http://n8n:5678}"
}
