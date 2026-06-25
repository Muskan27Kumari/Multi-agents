#!/usr/bin/env bash
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

ROOT="$(n8n_flow_root)"
load_dotenv "$ROOT"

PUBLIC_URL="$(n8n_public_url)"
WEBHOOK="${RAG_WEBHOOK_URL:-${PUBLIC_URL}/webhook/rag-knowledge-agent}"
TG_WEBHOOK_LOCAL="${RAG_TELEGRAM_WEBHOOK_URL:-${PUBLIC_URL}/webhook/rag-knowledge-agent-telegram}"
QDRANT_URL="${QDRANT_URL:-http://qdrant:6333}"
WF_ID="RagKnowledgeAgentV5"
CONTAINER="$(n8n_container)"

echo "Building workflow..."
node "$ROOT/scripts/build-rag-workflow.js"

IMPORT_FILE="$ROOT/workflows/rag-knowledge-agent-import.json"
prepare_workflow_import "$ROOT/workflows/rag-knowledge-agent.json" "$IMPORT_FILE" "$WF_ID"

echo "Ensuring sample knowledge file..."
mkdir -p "$ROOT/files/knowledge" "$ROOT/files/query-history"
docker exec "$CONTAINER" mkdir -p /files/knowledge /files/query-history 2>/dev/null || true

SAMPLE_CONTENT='Acme Automation Platform — Product Guide

Overview
Acme Automation Platform helps teams build AI-powered workflows without writing boilerplate code.

Supported Integrations
- Email: SMTP delivery for reports and RAG answers
- Telegram: bot notifications for alerts and Q&A responses
- Slack: team alerts and approval flows
- Google Sheets: export reports and audit logs
- Webhooks: trigger workflows from any HTTP client'

if [ ! -f "$ROOT/files/knowledge/sample-product-guide.txt" ]; then
  printf '%s\n' "$SAMPLE_CONTENT" > "$ROOT/files/knowledge/sample-product-guide.txt"
fi
docker exec "$CONTAINER" mkdir -p /files/knowledge 2>/dev/null || true

echo "Copying to n8n container..."
docker cp "$IMPORT_FILE" "$CONTAINER:/files/rag-import.json"

echo "Importing workflow..."
docker exec "$CONTAINER" n8n import:workflow --input=/files/rag-import.json

echo "Activating workflow..."
"$LIB_DIR/activate-workflow.sh" "$WF_ID"

if ! wait_for_webhook "$WEBHOOK"; then
  echo "Warning: main webhook still returns 404 after 60s. Check: docker logs $CONTAINER | tail -30" >&2
fi

if ! wait_for_webhook "$TG_WEBHOOK_LOCAL" '{"update_id":1,"message":{"message_id":1,"from":{"id":1,"is_bot":false},"chat":{"id":1,"type":"private"},"text":"/start"}}' 15; then
  echo "Warning: Telegram webhook still returns 404. Re-run activate-workflow.sh $WF_ID" >&2
fi

if ! docker exec "$CONTAINER" printenv OPENROUTER_API_KEY 2>/dev/null | grep -q .; then
  echo "Warning: OPENROUTER_API_KEY is not set in the n8n container. Add it to .env and run: docker compose up -d" >&2
fi

echo "Ingesting knowledge-base documents (skip if already embedded)..."
SEEN_HASHES_FILE="$(mktemp)"
trap 'rm -f "$SEEN_HASHES_FILE"' EXIT

hash_already_seen() {
  local h="$1"
  [ -f "$SEEN_HASHES_FILE" ] && grep -qx "$h" "$SEEN_HASHES_FILE" 2>/dev/null
}

mark_hash_seen() {
  echo "$1" >> "$SEEN_HASHES_FILE"
}

ingest_one() {
  local title="$1"
  local host_path="$2"
  local container_path="$3"
  [ -f "$host_path" ] || return 0

  local content_hash doc_id
  content_hash=$(node "$ROOT/scripts/lib/document-id.js" content-hash "$host_path")
  if hash_already_seen "$content_hash"; then
    echo "  ⊘ skip duplicate content: $title"
    return 0
  fi
  if ! node "$ROOT/scripts/lib/document-id.js" should-ingest "$host_path" 2>/dev/null; then
    echo "  ⊘ skip (already embedded): $title"
    mark_hash_seen "$content_hash"
    return 0
  fi

  doc_id=$(node "$ROOT/scripts/lib/document-id.js" from-file "$host_path")
  echo "  → $title"
  curl -sf --max-time 900 -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"ingest\",\"document_title\":\"$title\",\"document_id\":\"$doc_id\",\"document_file_path\":\"$container_path\",\"collection_name\":\"knowledge_base\",\"chunk_size\":1000,\"chunk_overlap\":200,\"enable_pdf_ocr\":true,\"enable_pdf_image_analysis\":true,\"pdf_ocr_max_tokens\":${PDF_OCR_MAX_TOKENS:-450},\"qdrant_url\":\"${QDRANT_URL}\"}" \
    | head -c 200 || echo " (ingest failed or timed out)"
  echo ""
  mark_hash_seen "$content_hash"
}

ingest_one "Product Guide" "$ROOT/files/knowledge/sample-product-guide.txt" "/files/knowledge/sample-product-guide.txt"
for pdf in "$ROOT/files/pdf/"*.pdf "$ROOT/files/knowledge/google-drive/"*.pdf; do
  [ -f "$pdf" ] || continue
  base="$(basename "$pdf" .pdf)"
  if [[ "$pdf" == "$ROOT/files/knowledge/google-drive/"* ]]; then
    ingest_one "$base" "$pdf" "/files/knowledge/google-drive/$(basename "$pdf")"
  else
    ingest_one "$base" "$pdf" "/files/pdf/$(basename "$pdf")"
  fi
done

echo "Testing query..."
curl -s -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d @"$ROOT/docs/rag-knowledge-agent-sample-query.json" | head -c 600
echo ""

if docker exec "$CONTAINER" printenv TELEGRAM_BOT_TOKEN 2>/dev/null | grep -q .; then
  echo "Starting Telegram bot poller..."
  stop_duplicate_telegram_pollers
  docker compose -f "$ROOT/docker-compose.yml" --profile telegram up -d telegram-bot
  echo "Telegram bot is running. Message your bot in Telegram to get answers."
else
  echo "Skipping Telegram bot (TELEGRAM_BOT_TOKEN not set in n8n container)."
fi
start_dedicated_telegram_bot telegram-bot-rag TELEGRAM_BOT_TOKEN_RAG

mkdir -p "$ROOT/files/knowledge/google-drive"
if [ -f "$ROOT/files/service-account-key.json" ] && [ -n "${GOOGLE_DRIVE_FOLDER_ID:-}" ]; then
  echo "Starting Google Drive sync..."
  docker compose -f "$ROOT/docker-compose.yml" up -d google-drive-sync
  echo "Google Drive sync is running. Upload PDFs or documents to your Drive folder — they ingest automatically."
elif [ -f "$ROOT/files/service-account-key.json" ]; then
  echo "Skipping Google Drive sync (set GOOGLE_DRIVE_FOLDER_ID in .env). See docs/google-drive-sync.md"
else
  echo "Skipping Google Drive sync (files/service-account-key.json not found)."
  echo "See docs/google-drive-sync.md to enable auto-ingest from Google Drive."
fi

echo "Done. Open ${PUBLIC_URL} and use workflow ID $WF_ID"
