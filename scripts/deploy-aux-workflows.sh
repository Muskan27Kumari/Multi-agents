#!/usr/bin/env bash
# Import and activate Marketing, Portfolio, and Resume workflow templates.
set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/lib" && pwd)"
# shellcheck source=lib/common.sh
source "$LIB_DIR/common.sh"

ROOT="$(n8n_flow_root)"
load_dotenv "$ROOT"
CONTAINER="$(n8n_container)"

import_workflow() {
  local src="$1"
  local wf_id="$2"
  local dedupe_name="$3"
  local import_file="$ROOT/workflows/$(basename "$src" .json)-import.json"

  echo ""
  echo "=== $dedupe_name ($wf_id) ==="
  if [ "$(basename "$src")" = "portfolio-market-report.json" ]; then
    node "$ROOT/scripts/sync-portfolio-holdings-code.js"
  fi
  if [ "$(basename "$src")" = "marketing-content-agent.json" ]; then
    node "$ROOT/scripts/sync-marketing-workflow-code.js"
  fi
  if [ "$(basename "$src")" = "resume-analysis-agent.json" ]; then
    node "$ROOT/scripts/sync-resume-workflow-code.js"
  fi
  prepare_workflow_import "$src" "$import_file" "$wf_id"
  docker cp "$import_file" "$CONTAINER:/files/$(basename "$import_file")"
  docker exec "$CONTAINER" n8n import:workflow --input="/files/$(basename "$import_file")"
  "$LIB_DIR/activate-workflow.sh" "$wf_id" --dedupe-name "$dedupe_name"
  echo "✓ Activated $dedupe_name"
}

mkdir -p "$ROOT/files/resumes" "$ROOT/files/marketing"
docker exec "$CONTAINER" mkdir -p /files/resumes /files/marketing 2>/dev/null || true

import_workflow \
  "$ROOT/workflows/marketing-content-agent.json" \
  "MarketingContentAgentV1" \
  "Marketing Content Agent"

import_workflow \
  "$ROOT/workflows/portfolio-market-report.json" \
  "PortfolioMarketReportV1" \
  "Portfolio Market Report"

import_workflow \
  "$ROOT/workflows/resume-analysis-agent.json" \
  "ResumeAnalysisAgentV1" \
  "Resume Analysis Agent"

import_workflow \
  "$ROOT/workflows/hr-recruitment-agent.json" \
  "HrRecruitmentAgentV1" \
  "HR Recruitment Agent"

PUBLIC_URL="$(n8n_public_url)"
echo ""
echo "Workflows active. Webhooks:"
echo "  POST ${PUBLIC_URL}/webhook/marketing-content"
echo "  POST ${PUBLIC_URL}/webhook/portfolio-market-report"
echo "  POST ${PUBLIC_URL}/webhook/resume-analysis-agent"
echo "  POST ${PUBLIC_URL}/webhook/hr-recruitment"
echo ""
echo "Dedicated Telegram bots (if tokens set):"
echo "  ./scripts/setup-telegram-bots.sh"
