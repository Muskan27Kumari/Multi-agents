# Google Drive → RAG Knowledge Base (auto-ingest)

Upload **PDFs or documents** to your Google Drive folder and they are automatically downloaded, chunked, embedded, and stored in Qdrant — no manual ingest step.

## How it works

```
Google Drive folder (GOOGLE_DRIVE_FOLDER_ID)
       ↓ (poll every GOOGLE_DRIVE_POLL_INTERVAL_SECONDS, default 30s)
google-drive-sync service
       ↓ download to files/knowledge/google-drive/
POST /webhook/rag-knowledge-agent  (action: ingest)
       ↓
Chunk → Embed → Qdrant knowledge_base
```

Supported file types:

- PDF (`.pdf`)
- Word (`.doc`, `.docx`)
- PowerPoint (`.pptx`)
- Plain text / Markdown / CSV / HTML / RTF
- Google Docs, Sheets, and Slides (exported automatically)

Subfolders inside your Drive folder are scanned when `GOOGLE_DRIVE_RECURSIVE=true` (default).

## One-time setup

### 1. Google Cloud service account

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Drive API**.
3. Create a service account → download JSON key.
4. Save as `files/service-account-key.json` (gitignored).

### 2. Share the Drive folder

1. Create or open a folder in Google Drive (this is your ingest inbox).
2. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/<FOLDER_ID>`
3. Share the folder with the service account `client_email` (from the JSON key) as **Viewer**.

### 3. Configure `.env`

```bash
GOOGLE_DRIVE_FOLDER_ID=your-folder-id
GOOGLE_DRIVE_FOLDER_URL=https://drive.google.com/drive/folders/your-folder-id
GOOGLE_SERVICE_ACCOUNT_FILE=/data/service-account-key.json
GOOGLE_DRIVE_POLL_INTERVAL_SECONDS=30
GOOGLE_DRIVE_RECURSIVE=true
N8N_INTERNAL_URL=http://n8n:5678
N8N_INGEST_WEBHOOK=          # optional; default: ${N8N_INTERNAL_URL}/webhook/rag-knowledge-agent
QDRANT_URL=http://qdrant:6333
```

### 4. Start

```bash
./scripts/docker-up.sh
./scripts/deploy-rag-workflow.sh
```

`google-drive-sync` starts with the main stack — no extra profile flag needed.

### 5. Upload and verify

1. Upload a PDF or document to your shared Drive folder (or a subfolder).
2. Within ~30 seconds, check logs:

```bash
docker compose logs -f google-drive-sync
```

3. Ask a question about the new document:

```bash
./scripts/rag-cli.sh ask "What does the document say about ...?"
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `GOOGLE_DRIVE_FOLDER_ID is not set` | Set in `.env`, then `docker compose up -d google-drive-sync` |
| Service account file not found | Place JSON at `files/service-account-key.json` |
| Drive API 404 | Share folder with service account email |
| File skipped as unsupported | Check supported types above; convert exotic formats to PDF |
| Ingest fails | Run `./scripts/deploy-rag-workflow.sh` to ensure RAG workflow is active |
| Updated file not re-ingested | Re-upload or edit the file in Drive (sync tracks `modifiedTime`) |
