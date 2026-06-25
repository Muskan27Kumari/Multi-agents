#!/usr/bin/env bash
# Configure Telegram bot display names and validate tokens.
# New bots must be created in @BotFather first — this script cannot mint tokens.
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

ROOT="$(n8n_flow_root)"
load_dotenv "$ROOT"

tg_api() {
  local token="$1"
  local method="$2"
  shift 2
  curl -sf -X POST "https://api.telegram.org/bot${token}/${method}" "$@"
}

set_bot_commands() {
  local token="$1"
  local commands_json="$2"
  tg_api "$token" setMyCommands -H "Content-Type: application/json" -d "$commands_json" >/dev/null 2>&1 || true
}

configure_bot_profile() {
  local token="$1"
  local name="$2"
  local short_desc="$3"
  local description="$4"
  local label="$5"
  local commands_json="${6:-}"

  if [ -z "$token" ]; then
    echo "⊘ $label — token not set, skipping"
    return 1
  fi

  echo "→ Configuring $label..."
  if ! me=$(tg_api "$token" getMe 2>/dev/null); then
    echo "✗ $label — invalid token or network error"
    return 1
  fi
  username=$(echo "$me" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'].get('username',''))" 2>/dev/null || echo "?")
  tg_api "$token" setMyName -d "name=${name}" >/dev/null || true
  tg_api "$token" setMyShortDescription -d "short_description=${short_desc}" >/dev/null || true
  tg_api "$token" setMyDescription -d "description=${description}" >/dev/null || true
  if [ -n "$commands_json" ]; then
    set_bot_commands "$token" "$commands_json"
  fi
  echo "✓ $label — https://t.me/${username} (@${username})"
  return 0
}

SHARED_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"What this bot can do"},{"command":"ask","description":"Ask knowledge base"},{"command":"review","description":"Research product reviews"},{"command":"book","description":"Book an appointment"},{"command":"cancel","description":"Cancel booking session"},{"command":"content","description":"Generate marketing content"},{"command":"report","description":"Portfolio market report"},{"command":"scan","description":"Analyze resumes folder"}]}'
RAG_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"ask","description":"Ask a question"}]}'
REVIEW_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"review","description":"Research product reviews"}]}'
BOOKING_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"book","description":"Start booking"},{"command":"cancel","description":"Cancel booking session"}]}'
MARKETING_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"content","description":"Generate content for a topic"}]}'
PORTFOLIO_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"report","description":"Run portfolio market report"}]}'
RESUME_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"scan","description":"Scan resumes folder"}]}'
HR_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"create_job","description":"Create a job opening"}]}'
DRIVE_RAG_COMMANDS='{"commands":[{"command":"start","description":"Welcome and help"},{"command":"help","description":"How to use this bot"},{"command":"drive","description":"Connect a Google Drive folder"},{"command":"status","description":"Show connected folder"},{"command":"resync","description":"Re-index your documents"}]}'

echo "=== VGI Telegram Bot Setup ==="
echo ""

# Shared multi-workflow bot
configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN:-}" \
  "VGI Skill Universe" \
  "Knowledge Q&A, reviews, booking, marketing, portfolio, and resume analysis." \
  "Welcome to VGI Skill Universe.

• /ask or any question — knowledge base (PDFs, docs, Drive)
• Photo, link, or /review — product review research
• /book and /cancel — appointment booking
• /content <topic> — marketing content drafts
• /report — portfolio market analysis
• /scan — resume ATS + AI analysis

Type /help anytime." \
  "Shared bot (TELEGRAM_BOT_TOKEN)" \
  "$SHARED_COMMANDS" || true

# Dedicated bots (optional)
configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_RAG:-}" \
  "VGI Knowledge Assistant" \
  "Ask questions from your documents, PDFs, and learning materials." \
  "Welcome to VGI Knowledge Assistant.

Send any question and I will search your knowledge base and reply with an answer grounded in your materials.

Examples:
• What are the key points in this PDF?
• Summarize the onboarding guide." \
  "RAG bot (TELEGRAM_BOT_TOKEN_RAG)" \
  "$RAG_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_REVIEW:-}" \
  "VGI Review Analyzer" \
  "Research customer reviews for any product — text, link, or photo." \
  "Welcome to VGI Review Analyzer.

Send a product name, marketplace link, or photo with a caption and I will research reviews across the web and deliver a sentiment report.

Examples:
• iPhone 15 reviews
• https://amazon.in/dp/..." \
  "Review bot (TELEGRAM_BOT_TOKEN_REVIEW)" \
  "$REVIEW_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_BOOKING:-}" \
  "VGI Appointment Booking" \
  "Book healthcare visits, tickets, hotels, restaurants, and 180+ services." \
  "Welcome to VGI Appointment Booking.

Type /book to start scheduling.
Type /cancel to reset your session.

We support healthcare, travel, hotels, events, food & dining, and more." \
  "Booking bot (TELEGRAM_BOT_TOKEN_BOOKING)" \
  "$BOOKING_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_MARKETING:-}" \
  "VGI Marketing Content" \
  "Generate blog, LinkedIn, Twitter, and email drafts from any topic." \
  "Welcome to VGI Marketing Content.

Send a topic or type /content <topic> to generate multi-platform marketing drafts.

Examples:
• /content How AI agents automate marketing
• Product launch ideas for B2B SaaS" \
  "Marketing bot (TELEGRAM_BOT_TOKEN_MARKETING)" \
  "$MARKETING_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_PORTFOLIO:-}" \
  "VGI Portfolio Report" \
  "AI-powered BUY/HOLD/SELL signals for your stock portfolio." \
  "Welcome to VGI Portfolio Report.

Type /report to analyze the sample portfolio (AAPL, MSFT, NVDA).

You will receive market data, news, and AI trading signals via Telegram." \
  "Portfolio bot (TELEGRAM_BOT_TOKEN_PORTFOLIO)" \
  "$PORTFOLIO_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_RESUME:-}" \
  "VGI Resume Analyzer" \
  "ATS scoring and AI job-fit analysis for resumes in your folder." \
  "Welcome to VGI Resume Analyzer.

Send a PDF resume directly — I will analyze it (ATS score, skills, job fit).

Or type /scan <filename> to analyze a resume from the shared folder.

Examples:
• Send Anand Singh.pdf as a document
• /scan Shivam Kumar.pdf" \
  "Resume bot (TELEGRAM_BOT_TOKEN_RESUME)" \
  "$RESUME_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_HR:-}" \
  "VGI HR Recruitment" \
  "Create job openings and run HR recruitment pipeline stages." \
  "Welcome to VGI HR Recruitment.

Type /create_job <title> to create a job opening.

Pipeline updates are delivered here when stages complete." \
  "HR bot (TELEGRAM_BOT_TOKEN_HR)" \
  "$HR_COMMANDS" || true

configure_bot_profile \
  "${TELEGRAM_BOT_TOKEN_DRIVE_RAG:-}" \
  "VGI Drive Assistant" \
  "Connect a Google Drive link and ask questions answered only from your documents." \
  "Welcome to VGI Drive Assistant.

1. Share your Google Drive file or folder with our service account (Viewer access)
2. Send your Drive URL (or /drive <url>)
3. Wait until you see: Your Drive folder is ready!
4. Ask any question about your documents

Commands: /drive, /status, /resync, /help" \
  "Drive RAG bot (TELEGRAM_BOT_TOKEN_DRIVE_RAG)" \
  "$DRIVE_RAG_COMMANDS" || true

echo ""
echo "=== BotFather — create dedicated bots (one-time) ==="
echo ""
echo "Message @BotFather on Telegram, then /newbot for each:"
echo ""
echo "  1. VGI Knowledge Assistant     → username: vgi_knowledge_assistant_bot     → TELEGRAM_BOT_TOKEN_RAG"
echo "  2. VGI Review Analyzer         → username: vgi_reviews_assistant_bot       → TELEGRAM_BOT_TOKEN_REVIEW"
echo "  3. VGI Appointment Booking     → username: vgi_booking_assistant_bot → TELEGRAM_BOT_TOKEN_BOOKING"
echo "  4. VGI Marketing Content       → username: vgi_marketing_assistant_bot         → TELEGRAM_BOT_TOKEN_MARKETING"
echo "  5. VGI Portfolio Report        → username: vgi_portfolio_assistant_bot        → TELEGRAM_BOT_TOKEN_PORTFOLIO"
echo "  6. VGI Resume Analyzer         → username: vgi_resume_assistant_bot → TELEGRAM_BOT_TOKEN_RESUME"
echo "  7. VGI HR Recruitment          → username: vgi_hr_bot                → TELEGRAM_BOT_TOKEN_HR"
echo "  8. VGI Drive Assistant          → username: Vgi_drive_assistant_bot → TELEGRAM_BOT_TOKEN_DRIVE_RAG"
echo ""
echo "Paste each token into .env, then run:"
echo "  ./scripts/setup-telegram-bots.sh"
echo "  ./scripts/deploy-aux-workflows.sh   # import marketing, portfolio, resume workflows"
echo "  ./scripts/docker-up.sh"
echo ""

configured=0
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_RAG:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_REVIEW:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_BOOKING:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_MARKETING:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_PORTFOLIO:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_RESUME:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_HR:-}" ] && configured=$((configured + 1))
[ -n "${TELEGRAM_BOT_TOKEN_DRIVE_RAG:-}" ] && configured=$((configured + 1))
echo "Configured tokens: ${configured}/9"

if [ -n "${TELEGRAM_BOT_TOKEN_RAG:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_REVIEW:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_BOOKING:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_MARKETING:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_PORTFOLIO:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_RESUME:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_HR:-}" ] || [ -n "${TELEGRAM_BOT_TOKEN_DRIVE_RAG:-}" ]; then
  echo "Starting dedicated bot containers..."
  start_all_dedicated_telegram_bots
fi
