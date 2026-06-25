#!/usr/bin/env bash
# Activate and publish an n8n workflow via SQLite (stops n8n briefly).
# Usage: activate-workflow.sh <workflow_id> [--dedupe-name "Workflow Name"]
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$LIB_DIR/common.sh"

WORKFLOW_ID="${1:-}"
DEDUPE_NAME=""
shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --dedupe-name)
      DEDUPE_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$WORKFLOW_ID" ]; then
  echo "Usage: activate-workflow.sh <workflow_id> [--dedupe-name \"Workflow Name\"]" >&2
  exit 1
fi

ROOT="$(n8n_flow_root)"
load_dotenv "$ROOT"
COMPOSE_FILE="$ROOT/docker-compose.yml"
CONTAINER="$(n8n_container)"
DB_PATH="/home/node/.n8n/database.sqlite"
TMP_DB="/tmp/n8n-db-activate-${WORKFLOW_ID}.sqlite"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required on the host to activate workflows." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container not running: $CONTAINER" >&2
  exit 1
fi

echo "Activating workflow $WORKFLOW_ID ..."
docker compose -f "$COMPOSE_FILE" stop n8n >/dev/null
docker cp "$CONTAINER:$DB_PATH" "$TMP_DB"

if [ -n "$DEDUPE_NAME" ]; then
  sqlite3 "$TMP_DB" "UPDATE workflow_entity SET active = 0, isArchived = 1 WHERE name = '$DEDUPE_NAME' AND id != '$WORKFLOW_ID';"
fi
sqlite3 "$TMP_DB" "UPDATE workflow_entity SET active = 1, isArchived = 0 WHERE id = '$WORKFLOW_ID';"

docker cp "$TMP_DB" "$CONTAINER:$DB_PATH"
docker run --rm -u root --volumes-from "$CONTAINER" alpine \
  chown 1000:1000 "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm" 2>/dev/null || \
  docker run --rm -u root --volumes-from "$CONTAINER" alpine chown 1000:1000 "$DB_PATH"
docker compose -f "$COMPOSE_FILE" start n8n >/dev/null

wait_for_n8n || true
docker exec "$CONTAINER" n8n publish:workflow --id="$WORKFLOW_ID" 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" restart n8n >/dev/null

if wait_for_n8n; then
  echo "Workflow $WORKFLOW_ID is active and published."
  exit 0
fi

echo "n8n did not become ready after activation." >&2
exit 1
