# n8n Flow — VGI Skill Universe

AI automation platform built on **n8n**, **Qdrant**, **OpenAI** / **OpenRouter**, **Telegram**, **Google Drive**, and **SMTP**.

Seven production workflows ship with one-command deploy. Dedicated Telegram bots cover knowledge Q&A, Drive document Q&A, resume analysis, HR, and more — each with its own @BotFather token.

Runs on **macOS** and **Windows** via Docker Desktop + Node.js.

---

## What this project does

| Capability | How |
|------------|-----|
| **Knowledge-base Q&A** | Ingest PDFs/docs → embed in Qdrant → semantic search + LLM answers |
| **Per-user Drive Q&A** | User sends a Drive URL → bot indexes their files → answers from those files only |
| **Product review research** | Text, URL, or photo → web search → sentiment report |
| **Appointment booking** | 188 services across 26 categories via conversational Telegram flow |
| **Marketing content** | Multi-platform copy (blog, LinkedIn, Twitter, email) |
| **Portfolio analysis** | Live quotes, fundamentals, news → BUY/HOLD/SELL signals |
| **Resume analysis** | ATS scoring, skill extraction, job-fit matching |
| **HR recruitment** | Job creation → screening → interviews → offers → onboarding |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Telegram users                                                         │
└──────┬──────────────────┬─────────────────────┬────────────────────────┘
       │                  │                     │
       ▼                  ▼                     ▼
┌──────────────┐  ┌───────────────┐   ┌────────────────────┐
│ Shared bot   │  │ Knowledge     │   │ Drive Assistant    │
│ (multi-flow) │  │ Assistant bot │   │ bot (per-user      │
│              │  │ (global KB)   │   │  Drive docs)       │
└──────┬───────┘  └───────┬───────┘   └─────────┬──────────┘
       │                  │                     │
       │    telegram-poller.js    telegram-dedicated-poller.js
       │                  │              drive-rag-bot.js
       │                  │                     │
       │          ┌───────┴───────┐             │
       │          ▼               ▼             │
       │   Resume Analyzer   HR / Review /      │
       │   (PDF upload)      Booking / etc.     │
       └──────────────────┼─────────────────────┘
                          ▼
              ┌───────────────────────┐
              │  n8n workflows        │
              │  (webhooks)           │
              └───────────┬───────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        ┌──────────┐          ┌─────────────┐
        │  Qdrant  │          │ OpenAI /    │
        │  vectors │          │ OpenRouter  │
        └──────────┘          └─────────────┘
```

**Google Drive (admin):** `google-drive-sync` polls a configured folder and auto-ingests into the global knowledge base.

**Google Drive (users):** `@Vgi_drive_assistant_bot` downloads and indexes each user's shared file/folder into Qdrant scoped by `user_id` (Telegram chat id).

---

## Workflows

| Workflow | Purpose | Deploy |
|----------|---------|--------|
| **RAG Knowledge Agent** | Ingest → chunk → embed → Qdrant → Q&A (web, email, Telegram) | `npm run deploy:rag` |
| **Customer Review Responder** | Product ID + web review research + sentiment | `npm run deploy:review` |
| **Appointment Booking Agent** | Conversational booking (188 services, 26 categories) | `npm run deploy:booking` |
| **Marketing Content Agent** | Multi-platform marketing copy + export | `npm run deploy:aux` |
| **Portfolio Market Report** | Holdings analysis + AI signals | `npm run deploy:aux` |
| **Resume Analysis Agent** | ATS + AI job-fit for PDF resumes | `npm run deploy:aux` |
| **HR Recruitment Agent** | Full hiring pipeline stages | `npm run deploy:aux` |

| Template (manual import) | Webhook |
|--------------------------|---------|
| Stock Market Agent | `POST /webhook/stock-market-agent` |

Deploy everything:

```bash
npm run deploy:all
```

---

## Prerequisites

| Requirement | macOS / Linux | Windows |
|-------------|---------------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | ✓ | ✓ |
| [Node.js 18+](https://nodejs.org/) | ✓ | ✓ |
| [Git for Windows](https://git-scm.com/download/win) (for deploy scripts) | — | ✓ |
| OpenAI or OpenRouter API key | ✓ | ✓ |

Optional: Telegram bot tokens, Google service account, SMTP, Serper, Finnhub / Alpha Vantage / Marketaux.

---

## Quick start

### 1. Configure environment

**macOS / Linux:**

```bash
cp .env.example .env
# Edit .env — minimum:
#   OPENAI_API_KEY=sk-...
#   N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   TELEGRAM_BOT_TOKEN=...          # @BotFather — shared bot
```

**Windows (PowerShell):**

```powershell
copy .env.example .env
# Generate encryption key:
#   -join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
```

### 2. Start the stack

```bash
npm start          # macOS / Linux / Windows
# or: ./start.sh | .\start.cmd | .\start.ps1
```

Starts **n8n**, **Qdrant**, **Google Drive sync**, **shared Telegram bot**, and any dedicated bots whose tokens are set in `.env`.

### 3. Deploy workflows

```bash
npm run deploy:all
npm run setup:bots    # optional — set bot names and /command menus via BotFather API
```

### 4. Open n8n

[http://localhost:5678](http://localhost:5678)

---

## npm commands

| Command | Description |
|---------|-------------|
| `npm start` | Start all Docker services + Telegram bots |
| `npm stop` | Stop everything (including Telegram profiles) |
| `npm run status` | Show running containers |
| `npm run setup:bots` | Configure Telegram display names and command menus |
| `npm run deploy:rag` | Build + deploy RAG Knowledge Agent |
| `npm run deploy:review` | Deploy Customer Review Responder |
| `npm run deploy:booking` | Deploy Appointment Booking Agent |
| `npm run deploy:aux` | Deploy Marketing, Portfolio, Resume, HR |
| `npm run deploy:all` | Deploy all workflows |
| `npm run help` | List all commands |

Legacy shell scripts (`./scripts/docker-up.sh`, `./scripts/deploy-*.sh`) call the same Node CLI.

---

## Telegram bots

### Bot map (env variable → purpose)

Each bot needs its **own** token from [@BotFather](https://t.me/BotFather). Never reuse the same token on two pollers — Telegram allows only one `getUpdates` connection per token. If a token env var is empty, `npm start` **stops** that bot container automatically.

| Telegram bot | Env variable | Poller | Purpose |
|--------------|--------------|--------|---------|
| **@vgiskilluniversebot** | `TELEGRAM_BOT_TOKEN` | `telegram-poller.js` | Shared multi-service router |
| **@vgi_knowledge_assistant_bot** | `TELEGRAM_BOT_TOKEN_RAG` | `telegram-dedicated-poller.js` (rag) | Global knowledge-base Q&A |
| **@Vgi_drive_assistant_bot** | `TELEGRAM_BOT_TOKEN_DRIVE_RAG` | `drive-rag-bot.js` | Per-user Google Drive Q&A |
| **@vgi_resume_assistant_bot** | `TELEGRAM_BOT_TOKEN_RESUME` | `telegram-dedicated-poller.js` (resume) | PDF resume ATS + AI job-fit |
| **@vgi_hr_bot** *(suggested)* | `TELEGRAM_BOT_TOKEN_HR` | `telegram-dedicated-poller.js` (hr) | HR recruitment pipeline |
| *(optional dedicated)* | `TELEGRAM_BOT_TOKEN_REVIEW` | dedicated (review) | Product review research |
| *(optional dedicated)* | `TELEGRAM_BOT_TOKEN_BOOKING` | dedicated (booking) | Appointment booking |
| *(optional dedicated)* | `TELEGRAM_BOT_TOKEN_MARKETING` | dedicated (marketing) | Marketing content |
| *(optional dedicated)* | `TELEGRAM_BOT_TOKEN_PORTFOLIO` | dedicated (portfolio) | Portfolio market report |

> **Resume vs HR:** `@vgi_resume_assistant_bot` must use `TELEGRAM_BOT_TOKEN_RESUME`, **not** `TELEGRAM_BOT_TOKEN_HR`. The HR poller only handles `/create_job` and other HR text commands — PDF resume analysis belongs on the Resume bot.

After adding tokens to `.env`:

```bash
npm run setup:bots   # set display names + /command menus
npm start            # start matching containers
```

Suggested BotFather usernames are printed at the end of `scripts/setup-telegram-bots.sh`.

### Shared bot (`TELEGRAM_BOT_TOKEN`)

Routes all workflows from one chat. Poller: `scripts/telegram-poller.js`.

| Message | Routed to |
|---------|-----------|
| Plain text / `/ask` / `/rag` | RAG Knowledge Agent (global KB) |
| `/review`, product photos, URLs, review keywords | Customer Review Responder |
| `/book`, `/appointment`, `/cancel`, active booking session | Appointment Booking Agent |
| `/content <topic>` or marketing keywords | Marketing Content Agent |
| `/report`, `/portfolio` | Portfolio Market Report |
| PDF resume upload or `/scan <filename>` | Resume Analysis Agent |
| Google Drive URL | Redirect → use @Vgi_drive_assistant_bot |

**Commands:** `/start`, `/help`, `/ask`, `/review`, `/book`, `/cancel`, `/content`, `/report`, `/scan`

### Knowledge Assistant (`TELEGRAM_BOT_TOKEN_RAG`)

Dedicated global knowledge-base bot. Poller: `telegram-dedicated-poller.js` (kind: `rag`).

- Ask anything: `What is RAG?` or `/ask What is RAG?`
- Searches ingested PDFs in `files/knowledge/`, `files/pdf/`, and admin Google Drive sync

### Drive Assistant (`TELEGRAM_BOT_TOKEN_DRIVE_RAG`)

Per-user Drive document Q&A. Poller: `scripts/drive-rag-bot.js`.

**User flow:**

1. Share Drive file/folder with service account: `vgi-skill-universe@variphi-4d952.iam.gserviceaccount.com` (Viewer)
2. Send Drive URL to @Vgi_drive_assistant_bot (or `/drive <url>`)
3. Wait for: `✅ Your Drive folder is ready!`
4. Ask questions — answers come **only** from that user's documents

**Commands:** `/drive <url>`, `/status`, `/resync`, `/help`

**Setup:**

```bash
# .env
TELEGRAM_BOT_TOKEN_DRIVE_RAG=your-token-from-botfather
GOOGLE_SERVICE_ACCOUNT_FILE=/data/service-account-key.json   # place JSON at files/service-account-key.json
```

### Resume Analyzer (`TELEGRAM_BOT_TOKEN_RESUME`)

Dedicated resume analysis bot — typically **@vgi_resume_assistant_bot**. Poller: `telegram-dedicated-poller.js` (kind: `resume`).

**User flow:**

1. Send a **PDF resume** directly in chat (recommended), or
2. Place PDFs in `files/resumes/` and run `/scan <filename>` (e.g. `/scan Shivam Kumar.pdf`)
3. Bot replies with ATS score, skills, and job-fit analysis (~30–90 seconds)

**Commands:** `/start`, `/help`, `/scan`

```bash
# .env
TELEGRAM_BOT_TOKEN_RESUME=your-resume-bot-token
TELEGRAM_RESUME_TIMEOUT_MS=600000   # optional — long analyses
```

Deploy the workflow: `npm run deploy:aux` (includes Resume Analysis Agent).

### HR Recruitment (`TELEGRAM_BOT_TOKEN_HR`)

Separate bot for the hiring pipeline — suggested username **@vgi_hr_bot**. Poller: `telegram-dedicated-poller.js` (kind: `hr`).

- `/create_job <title>` — create a job opening (dry run)
- Does **not** analyze PDF resumes — use the Resume Analyzer bot for that

```bash
# .env
TELEGRAM_BOT_TOKEN_HR=your-hr-bot-token
TELEGRAM_CHAT_ID_HR=          # optional allowlist (empty = public)
```

### Other dedicated bots (optional)

| Bot | Token env | Service |
|-----|-----------|---------|
| Review | `TELEGRAM_BOT_TOKEN_REVIEW` | `telegram-bot-review` |
| Booking | `TELEGRAM_BOT_TOKEN_BOOKING` | `telegram-bot-booking` |
| Marketing | `TELEGRAM_BOT_TOKEN_MARKETING` | `telegram-bot-marketing` |
| Portfolio | `TELEGRAM_BOT_TOKEN_PORTFOLIO` | `telegram-bot-portfolio` |

---

## Docker services

| Service | Profile | Description |
|---------|---------|-------------|
| `n8n` | default | Workflow engine (`./files` → `/files`) |
| `qdrant` | default | Vector database |
| `google-drive-sync` | default | Admin Drive folder → auto-ingest to global KB |
| `telegram-bot` | `telegram` | Shared multi-workflow router |
| `telegram-bot-rag` | `telegram-rag-legacy` | Knowledge Assistant |
| `telegram-bot-drive-rag` | `telegram-dedicated` | Drive Assistant |
| `telegram-bot-resume` | `telegram-dedicated` | Resume Analyzer (PDF upload) |
| `telegram-bot-hr` | `telegram-dedicated` | HR Recruitment |
| `telegram-bot-review` / `-booking` / `-marketing` / `-portfolio` | `telegram-dedicated` | Other optional dedicated bots |

```bash
npm start                              # full stack
npm stop                               # stop everything

docker compose up -d                   # core only (n8n + qdrant + drive-sync)
docker compose --profile telegram up -d telegram-bot-drive-rag   # one bot
```

Container names follow your folder name (e.g. `n8n-flow-v11-n8n-1`). Override with `N8N_CONTAINER` in `.env`.

---

## Configuration

Copy `.env.example` → `.env`. Key variables:

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | `openai` (default) or `openrouter` |
| `OPENAI_API_KEY` | Chat, embeddings, vision |
| `OPENAI_MODEL` | Default chat model (`gpt-4o-mini`) |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | RAG vectors (default `text-embedding-3-small` / `1536`) |
| `OPENROUTER_API_KEY` | Alternate provider |
| `N8N_ENCRYPTION_KEY` | Required — n8n credential encryption |
| `N8N_PUBLIC_URL` | Host URL (default `http://localhost:5678`) |
| `TELEGRAM_BOT_TOKEN` | Shared multi-workflow bot |
| `TELEGRAM_BOT_TOKEN_RAG` | Knowledge Assistant (`@vgi_knowledge_assistant_bot`) |
| `TELEGRAM_BOT_TOKEN_DRIVE_RAG` | Drive Assistant (`@Vgi_drive_assistant_bot`) |
| `TELEGRAM_BOT_TOKEN_RESUME` | Resume Analyzer (`@vgi_resume_assistant_bot`) |
| `TELEGRAM_BOT_TOKEN_HR` | HR Recruitment (separate bot, e.g. `@vgi_hr_bot`) |
| `TELEGRAM_BOT_TOKEN_REVIEW` / `_BOOKING` / `_MARKETING` / `_PORTFOLIO` | Other optional dedicated bots |
| `TELEGRAM_CHAT_ID` | Optional allowlist for shared + dedicated bots (empty = public) |
| `TELEGRAM_CHAT_ID_HR` | Optional allowlist for HR bot only |
| `TELEGRAM_RESUME_TIMEOUT_MS` | Resume workflow timeout (default 600000 ms) |
| `GOOGLE_DRIVE_FOLDER_ID` | Admin auto-ingest folder |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Path to service account JSON |
| `SERPER_API_KEY` | Better web search for Review Responder |
| `SMTP_*` / `EMAIL_*` | Email notifications |
| `BRAND_NAME` | Shown in welcome messages |

See `.env.example` for the full list.

### AI providers

| Provider | Variables |
|----------|-----------|
| OpenAI (default) | `OPENAI_API_KEY`, `OPENAI_MODEL`, `EMBEDDING_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |

If you change `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS`, re-ingest documents.

---

## RAG Knowledge Agent

Document ingestion and semantic Q&A: extract → chunk → embed → Qdrant → retrieve → LLM → Web / Email / Telegram.

- **Workflow:** `workflows/rag-knowledge-agent.json` (built by `scripts/build-rag-workflow.js`)
- **ID:** `RagKnowledgeAgentV5`
- **Webhook:** `POST /webhook/rag-knowledge-agent`
- **Telegram:** `POST /webhook/rag-knowledge-agent-telegram`
- **Samples:** `docs/rag-knowledge-agent-sample-ingest.json`, `docs/rag-knowledge-agent-sample-query.json`

```bash
npm run deploy:rag
```

### RAG CLI

```bash
./scripts/rag-cli.sh setup
./scripts/rag-cli.sh ingest-file files/knowledge/sample-product-guide.txt
./scripts/rag-cli.sh ask "What integrations are supported?"
./scripts/rag-cli.sh ingest-and-ask files/pdf/doc.pdf "Summarize this document"
./scripts/rag-cli.sh reingest-pdfs
```

### Admin Google Drive auto-ingest

Upload PDFs to a configured Drive folder — synced every ~30s into the **global** knowledge base.

1. Set `GOOGLE_DRIVE_FOLDER_ID` in `.env`
2. Place service account JSON at `files/service-account-key.json`
3. Share the folder with the service account email (Viewer)
4. `npm start`

Details: [docs/google-drive-sync.md](docs/google-drive-sync.md)

---

## Customer Review Responder

Product identification from text or image → multi-source review search → AI sentiment report.

- **Webhook:** `POST /webhook/customer-review-responder`
- **Telegram:** `POST /webhook/customer-review-responder-telegram`
- **Sample:** `docs/customer-review-responder-sample-request.json`

```bash
npm run deploy:review
```

---

## Appointment Booking Agent

Conversational booking for healthcare, travel, events, dining, and more.

```
Category → Service → Date → Time → Contact → Confirm
```

- **188 services** in `scripts/appointment-services.js`
- **Requirements** in `scripts/appointment-requirements.js`
- **Sessions:** `files/appointments/sessions.json`
- **Webhook:** `POST /webhook/appointment-booking-agent`

```bash
npm run deploy:booking
```

| Command | Action |
|---------|--------|
| `/book` | Start booking |
| `/cancel` | Reset session |

---

## Marketing, Portfolio, Resume, HR

Deployed together:

```bash
npm run deploy:aux
```

| Agent | Dedicated bot | Telegram trigger | Webhook |
|-------|---------------|------------------|---------|
| Marketing | `TELEGRAM_BOT_TOKEN_MARKETING` | `/content <topic>` | `/webhook/marketing-content` |
| Portfolio | `TELEGRAM_BOT_TOKEN_PORTFOLIO` | `/report` | `/webhook/portfolio-market-report` |
| Resume | `TELEGRAM_BOT_TOKEN_RESUME` | PDF upload or `/scan <filename>` | `/webhook/resume-analysis-agent` |
| HR | `TELEGRAM_BOT_TOKEN_HR` | `/create_job <title>` | `/webhook/hr-recruitment` |

The shared bot (`TELEGRAM_BOT_TOKEN`) can also trigger Marketing, Portfolio, and Resume via the same commands.

**Resume:** Upload a PDF in Telegram (best), or place files in `files/resumes/` and use `/scan Kumail Rizvi.pdf`. Requires `OPENAI_API_KEY` (or OpenRouter) in `.env`.

**HR stages:** `create_job` → `process_application` → `evaluate_assessment` → `schedule_interview` → `interview_feedback` → `final_selection` → `onboarding`

---

## Project structure

```
n8n-flow-v11/
├── package.json                 # npm scripts (cross-platform)
├── start.sh / start.cmd / start.ps1
├── stop.cmd / stop.ps1
├── docker-compose.yml
├── .env.example
├── workflows/                   # n8n workflow JSON (built + deployed)
├── docs/                        # sample payloads, Drive sync guide
├── scripts/
│   ├── run.js                   # cross-platform CLI entry
│   ├── docker-up.sh / docker-down.sh
│   ├── deploy-*.sh              # workflow deploy (uses bash)
│   ├── setup-telegram-bots.sh
│   ├── drive-rag-bot.js         # Drive Assistant poller
│   ├── telegram-poller.js       # shared multi-workflow router
│   ├── telegram-dedicated-poller.js
│   ├── google-drive-sync.js     # admin Drive → global KB
│   ├── rag-cli.sh
│   ├── build-*.js / sync-*.js   # workflow generators
│   └── lib/
│       ├── docker-cli.js        # cross-platform Docker orchestration
│       ├── drive-rag-query.js   # shared Drive Q&A helpers
│       ├── google-drive.js      # Drive API + ingest
│       ├── telegram-aux-routes.js
│       ├── qdrant-docs.js
│       └── rag/                 # embeddings, query, channels
└── files/
    ├── knowledge/               # RAG source documents
    ├── pdf/                     # auto-ingested on deploy
    ├── resumes/                 # resume /scan folder
    ├── appointments/            # booking state
    ├── drive-rag-sessions.json  # per-user Drive connections
    └── service-account-key.json # Google (gitignored)
```

---

## Development

Regenerate workflow JSON after editing build scripts:

```bash
node scripts/build-rag-workflow.js
node scripts/build-customer-review-responder-workflow.js
node scripts/build-appointment-booking-workflow.js
node scripts/sync-marketing-workflow-code.js
node scripts/sync-portfolio-holdings-code.js
node scripts/sync-resume-workflow-code.js
```

Redeploy with the matching `npm run deploy:*` command.

Restart Telegram pollers after code or `.env` token changes:

```bash
npm start   # recreates bots whose tokens changed; stops bots with empty tokens

docker compose --profile telegram-dedicated restart telegram-bot-resume
docker compose --profile telegram-dedicated restart telegram-bot-drive-rag
docker compose --profile telegram restart telegram-bot
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `npm run deploy:*` fails on Windows | Install [Git for Windows](https://git-scm.com/download/win) (Git Bash) |
| Container name not found | Set `N8N_CONTAINER` in `.env`; scripts auto-detect by default |
| Webhook 404 | `npm run deploy:all` or `./scripts/lib/activate-workflow.sh <workflow_id>` |
| Telegram poll conflict | One token = one poller. Use separate tokens per bot |
| Resume bot: no reply after PDF upload | Token must be on `TELEGRAM_BOT_TOKEN_RESUME`, not `_HR`. Run `npm start` and re-send the PDF |
| Resume bot: `/scan` shows HR help | HR poller was on the resume token — move token to `TELEGRAM_BOT_TOKEN_RESUME` |
| Resume bot: "restricted" message | Clear `TELEGRAM_CHAT_ID` in `.env` for public access, or add your chat id |
| Resume `/scan`: file not found | Upload PDF directly, or copy file to `files/resumes/` first |
| Drive bot: "Connect folder first" after sync error | Send `/resync` or re-send Drive URL; session may need `ready: true` |
| Drive bot: sync failed `fetch failed` | Check n8n is healthy: `npm run status`; retry `/resync` |
| Drive Q&A: topic not in user's file | Expected — bot only answers from **that user's** Drive docs |
| RAG "What is RAG?" on Drive bot | Use @vgi_knowledge_assistant_bot for global KB |
| `/book` hijacks plain text | Send `/cancel` to exit booking session |
| Booking date treated as Drive URL | Fixed — dates no longer match Drive ID pattern |
| OpenAI billing / 401 | Check `OPENAI_API_KEY` in `.env` and billing status |
| Google Drive not syncing | Verify `files/service-account-key.json` and folder sharing |

**Logs:**

```bash
docker compose logs -f n8n
docker compose --profile telegram-dedicated logs -f telegram-bot-resume
docker compose --profile telegram-dedicated logs -f telegram-bot-drive-rag
docker compose --profile telegram logs -f telegram-bot
docker compose logs -f google-drive-sync
```

---

## Security

- Do **not** commit `.env`, `files/service-account-key.json`, or API keys.
- Rotate any exposed token immediately via @BotFather.
- Each Telegram bot token grants full bot control — store securely.

---

## License

Workflow JSON is provided as-is. [n8n fair-code license](https://n8n.io/sustainable-use-license/).
