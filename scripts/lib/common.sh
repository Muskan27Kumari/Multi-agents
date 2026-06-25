#!/usr/bin/env bash
# Shared helpers for deploy / activation scripts.

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-env.sh
source "$LIB_DIR/load-env.sh"

n8n_flow_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

n8n_compose_file() {
  local root="${1:-$(n8n_flow_root)}"
  echo "$root/docker-compose.yml"
}

# Resolve the running n8n container for this project (folder name may differ from "n8n-flow").
n8n_container() {
  if [ -n "${N8N_CONTAINER:-}" ]; then
    echo "$N8N_CONTAINER"
    return 0
  fi

  local root compose_file name
  root="$(n8n_flow_root)"
  compose_file="$(n8n_compose_file "$root")"

  name=$(docker compose -f "$compose_file" ps --format '{{.Name}}' n8n 2>/dev/null | head -n1)
  if [ -n "$name" ]; then
    echo "$name"
    return 0
  fi

  name=$(docker ps --filter "label=com.docker.compose.service=n8n" \
    --filter "label=com.docker.compose.project.config_files=$compose_file" \
    --format '{{.Names}}' 2>/dev/null | head -n1)
  if [ -n "$name" ]; then
    echo "$name"
    return 0
  fi

  echo "n8n-flow-n8n-1"
}

wait_for_n8n() {
  local url="${1:-$(n8n_public_url 2>/dev/null || echo "http://localhost:5678")}"
  local attempts="${2:-30}"
  for _ in $(seq 1 "$attempts"); do
    if curl -sf "${url%/}/healthz" >/dev/null 2>&1 || curl -sf "${url%/}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_for_webhook() {
  local webhook="$1"
  local payload="${2:-{\"action\":\"query\",\"question\":\"ping\"}}"
  local attempts="${3:-30}"
  for _ in $(seq 1 "$attempts"); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$webhook" \
      -H "Content-Type: application/json" \
      -d "$payload" 2>/dev/null || echo "000")
    if [ "$code" != "404" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

prepare_workflow_import() {
  local workflow_path="$1"
  local import_path="$2"
  local workflow_id="$3"
  node "$(
    cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
  )/prepare-import.js" "$workflow_path" "$import_path" "$workflow_id"
}

# Only one Telegram getUpdates poller may run per bot token.
stop_duplicate_telegram_pollers() {
  local root compose_file current_id cid name
  root="$(n8n_flow_root)"
  compose_file="$(n8n_compose_file "$root")"
  current_id=$(docker compose -f "$compose_file" --profile telegram ps -q telegram-bot 2>/dev/null | head -n1)

  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    [ "$cid" = "$current_id" ] && continue
    name=$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's/^\///')
    echo "Stopping duplicate Telegram poller: ${name:-$cid}"
    docker stop "$cid" >/dev/null 2>&1 || true
    docker rm "$cid" >/dev/null 2>&1 || true
  done < <(docker ps -q --no-trunc --filter "label=com.docker.compose.service=telegram-bot" 2>/dev/null)
}

stop_duplicate_drive_rag_pollers() {
  local root compose_file drive_token current_id cid name
  root="$(n8n_flow_root)"
  load_dotenv "$root"
  drive_token="${TELEGRAM_BOT_TOKEN_DRIVE_RAG:-}"
  [ -n "$drive_token" ] || return 0
  compose_file="$(n8n_compose_file "$root")"
  current_id=$(docker compose -f "$compose_file" --profile telegram-dedicated ps -q telegram-bot-drive-rag 2>/dev/null | head -n1)

  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    [ "$cid" = "$current_id" ] && continue
    name=$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's/^\///')
    echo "Stopping duplicate Drive Q&A poller: ${name:-$cid}"
    docker stop "$cid" >/dev/null 2>&1 || true
    docker rm "$cid" >/dev/null 2>&1 || true
  done < <(docker ps -q --no-trunc --filter "label=com.docker.compose.service=telegram-bot-drive-rag" 2>/dev/null)
}

# Start optional dedicated Telegram bots when their token env vars are set.
start_dedicated_telegram_bot() {
  local service="$1"
  local token_var="$2"
  local profile="${3:-telegram-dedicated}"
  local token root compose_file
  token="${!token_var:-}"
  root="$(n8n_flow_root)"
  compose_file="$(n8n_compose_file "$root")"
  if [ -z "$token" ]; then
    if docker compose -f "$compose_file" --profile "$profile" ps -q "$service" 2>/dev/null | grep -q .; then
      echo "Stopping $service (no $token_var)"
      docker compose -f "$compose_file" --profile "$profile" stop "$service" 2>/dev/null || true
      docker compose -f "$compose_file" --profile "$profile" rm -f "$service" 2>/dev/null || true
    fi
    return 0
  fi
  echo "Starting dedicated Telegram bot: $service"
  docker compose -f "$compose_file" --profile "$profile" up -d --force-recreate "$service"
}

stop_drive_rag_bot() {
  local root compose_file
  root="$(n8n_flow_root)"
  compose_file="$(n8n_compose_file "$root")"
  if docker compose -f "$compose_file" ps -q telegram-bot-drive-rag 2>/dev/null | grep -q .; then
    echo "Stopping telegram-bot-drive-rag (restoring Knowledge Assistant on this token)"
    docker compose -f "$compose_file" --profile telegram-dedicated stop telegram-bot-drive-rag 2>/dev/null || true
    docker compose -f "$compose_file" --profile telegram-dedicated rm -f telegram-bot-drive-rag 2>/dev/null || true
  fi
}

stop_legacy_rag_bot() {
  local root compose_file
  root="$(n8n_flow_root)"
  compose_file="$(n8n_compose_file "$root")"
  if docker compose -f "$compose_file" ps -q telegram-bot-rag 2>/dev/null | grep -q .; then
    echo "Stopping legacy telegram-bot-rag (conflicts with Drive Q&A bot)"
    docker compose -f "$compose_file" --profile telegram-rag-legacy stop telegram-bot-rag 2>/dev/null || true
    docker compose -f "$compose_file" --profile telegram-rag-legacy rm -f telegram-bot-rag 2>/dev/null || true
  fi
}

start_all_dedicated_telegram_bots() {
  local root drive_token rag_token
  root="$(n8n_flow_root)"
  load_dotenv "$root"
  drive_token="${TELEGRAM_BOT_TOKEN_DRIVE_RAG:-}"
  rag_token="${TELEGRAM_BOT_TOKEN_RAG:-}"

  # Same token on both vars — only one poller may run (Knowledge Assistant wins).
  if [ -n "$rag_token" ] && [ -n "$drive_token" ] && [ "$rag_token" = "$drive_token" ]; then
    stop_drive_rag_bot
  fi

  if [ -n "$rag_token" ] && { [ -z "$drive_token" ] || [ "$rag_token" != "$drive_token" ]; }; then
    start_dedicated_telegram_bot telegram-bot-rag TELEGRAM_BOT_TOKEN_RAG telegram-rag-legacy
  fi

  if [ -n "$drive_token" ] && { [ -z "$rag_token" ] || [ "$rag_token" != "$drive_token" ]; }; then
    if [ -n "$rag_token" ] && [ "$rag_token" = "$drive_token" ]; then
      stop_legacy_rag_bot
    fi
    stop_duplicate_drive_rag_pollers
    start_dedicated_telegram_bot telegram-bot-drive-rag TELEGRAM_BOT_TOKEN_DRIVE_RAG
  fi
  start_dedicated_telegram_bot telegram-bot-review TELEGRAM_BOT_TOKEN_REVIEW
  start_dedicated_telegram_bot telegram-bot-booking TELEGRAM_BOT_TOKEN_BOOKING
  start_dedicated_telegram_bot telegram-bot-marketing TELEGRAM_BOT_TOKEN_MARKETING
  start_dedicated_telegram_bot telegram-bot-portfolio TELEGRAM_BOT_TOKEN_PORTFOLIO
  start_dedicated_telegram_bot telegram-bot-resume TELEGRAM_BOT_TOKEN_RESUME
  start_dedicated_telegram_bot telegram-bot-hr TELEGRAM_BOT_TOKEN_HR
}
