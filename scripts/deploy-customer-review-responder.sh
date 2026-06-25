#!/usr/bin/env bash
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

ROOT="$(n8n_flow_root)"
load_dotenv "$ROOT"

PUBLIC_URL="$(n8n_public_url)"
WF_ID="CustomerReviewResponderV1"
WEBHOOK="${CRR_WEBHOOK_URL:-${PUBLIC_URL}/webhook/customer-review-responder}"
CONTAINER="$(n8n_container)"

echo "Building workflow..."
node "$ROOT/scripts/build-customer-review-responder-workflow.js"

IMPORT_FILE="$ROOT/workflows/customer-review-responder-import.json"
prepare_workflow_import "$ROOT/workflows/customer-review-responder.json" "$IMPORT_FILE" "$WF_ID"

echo "Copying to n8n container..."
docker cp "$IMPORT_FILE" "$CONTAINER:/files/customer-review-responder-import.json"

echo "Importing workflow..."
docker exec "$CONTAINER" n8n import:workflow --input=/files/customer-review-responder-import.json

echo "Activating workflow..."
"$LIB_DIR/activate-workflow.sh" "$WF_ID" --dedupe-name "Customer Review Responder"

echo "Testing webhook (may take up to 90s for AI + search)..."
sleep 15
curl -sf --max-time 120 -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  --data-binary "@$ROOT/docs/customer-review-responder-sample-request.json" | head -c 800 || echo "(webhook test skipped or timed out — run manual test in n8n)"

echo "Restarting Telegram poller..."
stop_duplicate_telegram_pollers
docker compose -f "$ROOT/docker-compose.yml" --profile telegram up -d telegram-bot 2>/dev/null || true
start_dedicated_telegram_bot telegram-bot-review TELEGRAM_BOT_TOKEN_REVIEW

echo ""
echo "Done. Workflow ID: $WF_ID"
echo "Webhook: $WEBHOOK"
echo "Telegram: plain messages → Customer Review Responder | /rag or /ask → RAG Knowledge Agent"
