#!/usr/bin/env bash
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

ROOT="$(n8n_flow_root)"
load_dotenv "$ROOT"

PUBLIC_URL="$(n8n_public_url)"
WF_ID="AppointmentBookingAgentV1"
WEBHOOK="${APPOINTMENT_WEBHOOK_URL:-${PUBLIC_URL}/webhook/appointment-booking-agent}"
TELEGRAM_WEBHOOK="${APPOINTMENT_TELEGRAM_WEBHOOK_URL:-${PUBLIC_URL}/webhook/appointment-booking-agent-telegram}"
CONTAINER="$(n8n_container)"

echo "Building workflow..."
node "$ROOT/scripts/build-appointment-booking-workflow.js"

IMPORT_FILE="$ROOT/workflows/appointment-booking-agent-import.json"
prepare_workflow_import "$ROOT/workflows/appointment-booking-agent.json" "$IMPORT_FILE" "$WF_ID"

echo "Copying to n8n container..."
docker cp "$IMPORT_FILE" "$CONTAINER:/files/appointment-booking-agent-import.json"

echo "Importing workflow..."
docker exec "$CONTAINER" n8n import:workflow --input=/files/appointment-booking-agent-import.json

echo "Activating workflow..."
"$LIB_DIR/activate-workflow.sh" "$WF_ID" --dedupe-name "Appointment Booking Agent"

echo "Testing webhook..."
sleep 8
curl -sf --max-time 30 -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  --data-binary "@$ROOT/docs/appointment-booking-agent-sample-request.json" | head -c 400 || echo "(webhook test skipped — check n8n is running)"

echo ""
echo "Restarting Telegram poller..."
stop_duplicate_telegram_pollers
docker compose -f "$ROOT/docker-compose.yml" --profile telegram up -d telegram-bot 2>/dev/null || true
start_dedicated_telegram_bot telegram-bot-booking TELEGRAM_BOT_TOKEN_BOOKING

echo ""
echo "Done. Workflow ID: $WF_ID"
echo "Webhook: $WEBHOOK"
echo "Telegram: /book → Appointment Booking Agent"
