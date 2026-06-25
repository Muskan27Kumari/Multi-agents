#!/usr/bin/env bash
# RAG Knowledge Agent — production CLI (no Base64).
# Uses document_file_path or document_text only.
#
# Usage:
#   ./scripts/rag-cli.sh setup
#   ./scripts/rag-cli.sh ingest-file <path-to-pdf|txt|md|docx> [--title "Title"] [--id doc-id] [--force]
#   ./scripts/rag-cli.sh ingest-text --title "Title" --text "content..." 
#   ./scripts/rag-cli.sh ask "Your question?"
#   ./scripts/rag-cli.sh ingest-and-ask <file> "Your question?"
#   ./scripts/rag-cli.sh test [ingest|query|ingest-then-query]
#   ./scripts/rag-cli.sh reingest-pdfs
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB_DIR="$ROOT/scripts/lib"
# shellcheck source=lib/load-env.sh
source "$LIB_DIR/load-env.sh"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"
load_dotenv "$ROOT"
CONTAINER="$(n8n_container)"

PUBLIC_URL="$(n8n_public_url)"
WEBHOOK="${RAG_WEBHOOK_URL:-${PUBLIC_URL}/webhook/rag-knowledge-agent}"
QDRANT_URL="${QDRANT_URL:-http://qdrant:6333}"
KNOWLEDGE_DIR="$ROOT/files/knowledge"

# Notification: omit from request = auto (on when SMTP/Telegram configured in .env)
RAG_NOTIFY_EMAIL="${RAG_NOTIFY_EMAIL:-auto}"
RAG_NOTIFY_TELEGRAM="${RAG_NOTIFY_TELEGRAM:-auto}"

parse_notify_flags() {
  NOTIFY_EMAIL="$RAG_NOTIFY_EMAIL"
  NOTIFY_TELEGRAM="$RAG_NOTIFY_TELEGRAM"
  while [ $# -gt 0 ]; do
    case "$1" in
      --notify-email) NOTIFY_EMAIL=true; shift ;;
      --notify-telegram) NOTIFY_TELEGRAM=true; shift ;;
      --no-notify) NOTIFY_EMAIL=false; NOTIFY_TELEGRAM=false; shift ;;
      --) shift; break ;;
      -*) echo "Unknown option: $1" >&2; exit 1 ;;
      *) break ;;
    esac
  done
  REMAINING_ARGS=("$@")
}

post_json() {
  local label="$1"
  local payload="$2"
  echo "POST $WEBHOOK ($label)"
  local response
  response=$(curl -sS -w "\n%{http_code}" -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$payload")
  local http_code
  http_code=$(echo "$response" | tail -n1)
  local body
  body=$(echo "$response" | sed '$d')
  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq . 2>/dev/null || echo "$body"
  else
    echo "$body"
  fi
  if [ "$http_code" -ge 400 ] 2>/dev/null; then
    echo "HTTP $http_code" >&2
    return 1
  fi
  if echo "$body" | grep -q '"success":false'; then
    return 1
  fi
}

resolve_container_path() {
  local abs="$1"
  local rel="${abs#$ROOT/files/}"
  if [ "$rel" = "$abs" ]; then
    echo ""
    return
  fi
  echo "/files/$rel"
}

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-|-$//g' | cut -c1-64
}

cmd_setup() {
  echo "Starting Docker (Qdrant + n8n)..."
  docker compose -f "$ROOT/docker-compose.yml" up -d

  if ! docker exec "$CONTAINER" printenv OPENROUTER_API_KEY 2>/dev/null | grep -q .; then
    echo "Warning: OPENROUTER_API_KEY is not set in the n8n container." >&2
    echo "Add OPENROUTER_API_KEY to .env then run: docker compose up -d" >&2
  fi

  echo "Building and deploying workflow..."
  "$ROOT/scripts/deploy-rag-workflow.sh"
  echo ""
  echo "Ready. Try:"
  echo "  ./scripts/rag-cli.sh ingest-file files/knowledge/sample-product-guide.txt"
  echo "  ./scripts/rag-cli.sh ask \"What integrations are supported?\""
  if docker exec "$CONTAINER" printenv TELEGRAM_BOT_TOKEN 2>/dev/null | grep -q .; then
    echo "  Or message your Telegram bot directly — the poller forwards questions automatically."
  fi
}

cmd_ingest_file() {
  local src=""
  local title=""
  local doc_id=""
  local enable_ocr="true"
  local force_ingest="false"
  parse_notify_flags "$@"
  set -- "${REMAINING_ARGS[@]}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --id) doc_id="$2"; shift 2 ;;
      --force) force_ingest="true"; shift ;;
      --no-ocr) enable_ocr="false"; shift ;;
      -*) echo "Unknown option: $1" >&2; exit 1 ;;
      *)
        if [ -z "$src" ]; then src="$1"; else echo "Unexpected argument: $1" >&2; exit 1; fi
        shift
        ;;
    esac
  done

  if [ -z "$src" ]; then
    echo "Usage: $0 ingest-file <path> [--title \"Title\"] [--id doc-id] [--force] [--no-ocr]" >&2
    exit 1
  fi

  if [ ! -f "$src" ]; then
    echo "File not found: $src" >&2
    exit 1
  fi

  local abs
  abs="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
  local ext="${abs##*.}"
  ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')

  case "$ext" in
    txt|md|markdown|pdf|docx) ;;
    *)
      echo "Unsupported extension .$ext (use txt, md, pdf, docx)" >&2
      exit 1
      ;;
  esac

  local container_path
  container_path="$(resolve_container_path "$abs")"

  if [ -z "$container_path" ]; then
    mkdir -p "$KNOWLEDGE_DIR"
    local dest="$KNOWLEDGE_DIR/$(basename "$abs")"
    if [ "$abs" != "$(cd "$(dirname "$dest")" && pwd)/$(basename "$dest")" ]; then
      cp "$abs" "$dest"
      echo "Copied to $dest"
    fi
    container_path="/files/knowledge/$(basename "$abs")"
  fi

  local base
  base="$(basename "$abs" ".$ext")"
  [ -z "$title" ] && title="$base"
  if [ -z "$doc_id" ]; then
    doc_id=$(node "$ROOT/scripts/lib/document-id.js" from-file "$abs")
  fi

  if [ "$force_ingest" != "true" ]; then
    if ! node "$ROOT/scripts/lib/document-id.js" should-ingest "$abs" 2>/dev/null; then
      echo "Already embedded (content hash). Use --force to re-ingest."
      exit 0
    fi
  fi

  local payload
  payload=$(node -e "
    const flags = {};
    if (process.argv[5] !== 'auto') flags.notify_email = process.argv[5] === 'true';
    if (process.argv[6] !== 'auto') flags.notify_telegram = process.argv[6] === 'true';
    console.log(JSON.stringify({
      action: 'ingest',
      document_title: process.argv[1],
      document_id: process.argv[2],
      document_file_path: process.argv[3],
      collection_name: 'knowledge_base',
      chunk_size: 800,
      chunk_overlap: 150,
      enable_pdf_ocr: process.argv[4] === 'true',
      enable_pdf_image_analysis: process.argv[4] === 'true',
      ocr_vision_model: process.env.OCR_VISION_MODEL || process.env.OPENROUTER_MODEL || '',
      max_pdf_ocr_images: Number(process.env.MAX_PDF_OCR_IMAGES || 25),
      pdf_ocr_max_tokens: Number(process.env.PDF_OCR_MAX_TOKENS || 700),
      qdrant_url: process.env.QDRANT_URL || 'http://qdrant:6333',
      force_reingest: process.argv[7] === 'true',
      ...flags,
    }));
  " "$title" "$doc_id" "$container_path" "$enable_ocr" "$NOTIFY_EMAIL" "$NOTIFY_TELEGRAM" "$force_ingest")

  post_json "ingest-file" "$payload"
}

cmd_ingest_text() {
  local title=""
  local text=""
  local doc_id=""
  parse_notify_flags "$@"
  set -- "${REMAINING_ARGS[@]}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --title) title="$2"; shift 2 ;;
      --text) text="$2"; shift 2 ;;
      --id) doc_id="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if [ -z "$title" ] || [ -z "$text" ]; then
    echo "Usage: $0 ingest-text --title \"Title\" --text \"content...\"" >&2
    exit 1
  fi

  [ -z "$doc_id" ] && doc_id="$(slugify "$title")"

  local payload
  payload=$(node -e "
    const flags = {};
    if (process.argv[4] !== 'auto') flags.notify_email = process.argv[4] === 'true';
    if (process.argv[5] !== 'auto') flags.notify_telegram = process.argv[5] === 'true';
    console.log(JSON.stringify({
      action: 'ingest',
      document_title: process.argv[1],
      document_id: process.argv[2],
      document_text: process.argv[3],
      collection_name: 'knowledge_base',
      chunk_size: 800,
      chunk_overlap: 150,
      qdrant_url: process.env.QDRANT_URL || 'http://qdrant:6333',
      ...flags,
    }));
  " "$title" "$doc_id" "$text" "$NOTIFY_EMAIL" "$NOTIFY_TELEGRAM")

  post_json "ingest-text" "$payload"
}

cmd_ask() {
  parse_notify_flags "$@"
  set -- "${REMAINING_ARGS[@]}"
  local question="$*"
  if [ -z "$question" ]; then
    echo "Usage: $0 ask [--notify-email] [--notify-telegram] \"Your question?\"" >&2
    exit 1
  fi

  local payload
  payload=$(node -e "
    const flags = {};
    if (process.argv[2] !== 'auto') flags.notify_email = process.argv[2] === 'true';
    if (process.argv[3] !== 'auto') flags.notify_telegram = process.argv[3] === 'true';
    console.log(JSON.stringify({
      action: 'query',
      question: process.argv[1],
      collection_name: 'knowledge_base',
      top_k: 5,
      rag_score_threshold: 0.35,
      enable_fallback: true,
      enable_web_search: true,
      web_search_provider: 'duckduckgo',
      openrouter_model: process.env.OPENROUTER_MODEL || '',
      qdrant_url: process.env.QDRANT_URL || 'http://qdrant:6333',
      ...flags,
    }));
  " "$question" "$NOTIFY_EMAIL" "$NOTIFY_TELEGRAM")

  post_json "ask" "$payload"
}

cmd_ingest_and_ask() {
  parse_notify_flags "$@"
  set -- "${REMAINING_ARGS[@]}"
  if [ $# -lt 2 ]; then
    echo "Usage: $0 ingest-and-ask [--notify-email] [--notify-telegram] <file> \"Your question?\"" >&2
    exit 1
  fi
  local file="$1"
  shift
  local question="$*"

  cmd_ingest_file "$([ "$NOTIFY_EMAIL" = true ] && echo --notify-email) $([ "$NOTIFY_TELEGRAM" = true ] && echo --notify-telegram) $file"
  echo "--- waiting 4s for indexing ---"
  sleep 4
  cmd_ask $([ "$NOTIFY_EMAIL" = true ] && echo --notify-email) $([ "$NOTIFY_TELEGRAM" = true ] && echo --notify-telegram) "$question"
}

post_sample_payload() {
  local label="$1"
  local file="$2"
  if [ ! -f "$file" ]; then
    echo "Missing payload file: $file" >&2
    exit 1
  fi
  echo "POST $WEBHOOK ($label)"
  curl -sS -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    --data-binary "@$file"
  echo ""
}

cmd_test() {
  local action="${1:-ingest}"
  case "$action" in
    ingest)
      post_sample_payload "ingest" "$ROOT/docs/rag-knowledge-agent-sample-ingest.json"
      ;;
    query)
      post_sample_payload "query" "$ROOT/docs/rag-knowledge-agent-sample-query.json"
      ;;
    ingest-then-query)
      post_sample_payload "ingest" "$ROOT/docs/rag-knowledge-agent-sample-ingest.json"
      echo "--- waiting 3s for indexing ---"
      sleep 3
      post_sample_payload "query" "$ROOT/docs/rag-knowledge-agent-sample-query.json"
      ;;
    *)
      echo "Usage: $0 test [ingest|query|ingest-then-query]" >&2
      exit 1
      ;;
  esac
}

cmd_reingest_pdfs() {
  local ocr_model="${OCR_VISION_MODEL:-${OPENROUTER_MODEL:-}}"
  local max_images="${MAX_PDF_OCR_IMAGES:-25}"
  local max_tokens="${PDF_OCR_MAX_TOKENS:-700}"
  local state_file="$ROOT/files/google-drive-sync-state.json"

  ingest_pdf() {
    local title="$1"
    local path="$2"
    local doc_id="${3:-}"
    echo "→ $title"
    local payload
    payload=$(node -e "
      console.log(JSON.stringify({
        action: 'ingest',
        document_title: process.argv[1],
        document_id: process.argv[2] || undefined,
        document_file_path: process.argv[3],
        collection_name: 'knowledge_base',
        chunk_size: 1000,
        chunk_overlap: 200,
        enable_pdf_ocr: true,
        enable_pdf_image_analysis: true,
        ocr_vision_model: process.argv[4],
        max_pdf_ocr_images: Number(process.argv[5]),
        pdf_ocr_max_tokens: Number(process.argv[6]),
        qdrant_url: process.env.QDRANT_URL || 'http://qdrant:6333',
      }));
    " "$title" "$doc_id" "$path" "$ocr_model" "$max_images" "$max_tokens")

    local response
    if ! response=$(curl -sf --max-time 900 -X POST "$WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$payload"); then
      echo "  ✗ ingest request failed" >&2
      return 1
    fi
    node -e "
      const j=JSON.parse(process.argv[1]);
      const errCount=(j.pdf_image_analysis_failures||0);
      console.log('  chunks:',j.chunks_count,'images:',j.pdf_images_detected,'described:',j.pdf_images_described,'failures:',errCount);
      if(errCount>0) console.log('  vision errors:',JSON.stringify(j.pdf_image_analysis_errors||[]));
    " "$response"
  }

  echo "Re-ingesting PDFs with vision (model=$ocr_model, max_images=$max_images) ..."
  if [ -d "$ROOT/files/knowledge/google-drive" ] && compgen -G "$ROOT/files/knowledge/google-drive/"*.pdf >/dev/null 2>&1; then
    for pdf in "$ROOT/files/knowledge/google-drive/"*.pdf; do
      [ -f "$pdf" ] || continue
      local base doc_id=""
      base="$(basename "$pdf" .pdf)"
      if [ -f "$state_file" ]; then
        doc_id=$(node -e "
          const fs=require('fs');
          const name=process.argv[1];
          const state=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
          for(const f of Object.values(state.files||{})){
            if(f.name===name){console.log(f.document_id||'');process.exit(0);}
          }
        " "$(basename "$pdf")" "$state_file" 2>/dev/null || true)
      fi
      ingest_pdf "$base" "/files/knowledge/google-drive/$(basename "$pdf")" "$doc_id"
    done
  else
    for pdf in "$ROOT/files/pdf/"*.pdf; do
      [ -f "$pdf" ] || continue
      ingest_pdf "$(basename "$pdf" .pdf)" "/files/pdf/$(basename "$pdf")"
    done
  fi
  echo "Done. Ask image-related questions about ingested PDFs."
}

usage() {
  cat <<EOF
RAG Knowledge Agent CLI (no Base64 — file path & text only)

Commands:
  setup
      Start Docker, build workflow, deploy, smoke-test webhook

  ingest-file <path> [--title "Title"] [--id doc-id] [--force] [--no-ocr]
      Ingest PDF/TXT/MD/DOCX via document_file_path (skips if already embedded)
      Files outside ./files/ are copied to ./files/knowledge/

  dedupe [--apply]
      Remove duplicate embeddings (same title, multiple document_ids). Dry-run by default.

  ingest-text --title "Title" --text "content..."
      Ingest raw text via document_text (no file)

  ask "Your question?"
      Query the knowledge base (no upload)
      Add --notify-email and/or --notify-telegram to send notifications

  ingest-and-ask [--notify-email] [--notify-telegram] <file> "Your question?"
      Ingest a file then ask a question

  test [ingest|query|ingest-then-query]
      POST sample JSON payloads from docs/

  reingest-pdfs
      Re-ingest PDFs with vision OCR (google-drive or files/pdf/)

Environment:
  RAG_WEBHOOK_URL   default: \${N8N_PUBLIC_URL}/webhook/rag-knowledge-agent
  QDRANT_URL        default: http://qdrant:6333
  OPENROUTER_MODEL, OCR_VISION_MODEL, EMBEDDING_MODEL from .env

Examples:
  $0 setup
  $0 ingest-file files/knowledge/sample-product-guide.txt
  $0 ingest-file ~/Downloads/report.pdf --title "Q4 Report"
  $0 ingest-text --title "Notes" --text "Our platform supports Slack and email."
  $0 ask "What integrations are supported?"
  $0 ask --notify-email "What integrations are supported?"
  $0 ask --notify-email --notify-telegram "Summarize the product guide"
  $0 ingest-and-ask files/knowledge/sample-product-guide.txt "What is Acme Automation?"
  $0 test query
  $0 reingest-pdfs
EOF
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    setup) cmd_setup ;;
    ingest-file) cmd_ingest_file "$@" ;;
    ingest-text) cmd_ingest_text "$@" ;;
    ask) cmd_ask "$@" ;;
    ingest-and-ask) cmd_ingest_and_ask "$@" ;;
    test) cmd_test "${1:-ingest}" ;;
    reingest-pdfs) cmd_reingest_pdfs ;;
    dedupe) node "$ROOT/scripts/lib/document-id.js" dedupe "$@" ;;
    help|-h|--help|"") usage ;;
    *)
      echo "Unknown command: $cmd" >&2
      usage
      exit 1
      ;;
  esac
}

main "$@"
