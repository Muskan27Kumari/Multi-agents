#!/usr/bin/env node
/**
 * Polls a Google Drive folder and ingests new/updated files into the RAG knowledge base.
 *
 * Setup:
 * 1. Create a Google Cloud service account with Drive API enabled.
 * 2. Save the JSON key to files/service-account-key.json (or set GOOGLE_SERVICE_ACCOUNT_FILE).
 * 3. Share the Drive folder with the service account email (Viewer access is enough).
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const { loadEnv, internalN8nUrl } = require('./lib/env');
const {
  loadCredentials,
  getAccessToken,
  syncDriveToRag,
} = require('./lib/google-drive');

loadEnv(path.join(__dirname, '..'));

const FOLDER_ID = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
const CREDENTIALS_FILE = String(
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE || path.join(__dirname, '..', 'files', 'service-account-key.json')
).trim();
const INGEST_WEBHOOK = String(
  process.env.N8N_INGEST_WEBHOOK || `${internalN8nUrl()}/webhook/rag-knowledge-agent`
).trim();
const POLL_SECONDS = Number(process.env.GOOGLE_DRIVE_POLL_INTERVAL_SECONDS || 30);
const RECURSIVE = String(process.env.GOOGLE_DRIVE_RECURSIVE || 'true').toLowerCase() !== 'false';
const STATE_FILE = String(
  process.env.GOOGLE_DRIVE_STATE_FILE || path.join(__dirname, '..', 'files', 'google-drive-sync-state.json')
).trim();
const FILES_ROOT = String(
  process.env.FILES_MOUNT_ROOT || (
    String(process.env.GOOGLE_DRIVE_DOWNLOAD_DIR || '').startsWith('/data')
      ? '/data'
      : path.join(__dirname, '..', 'files')
  )
).trim();
const DOWNLOAD_DIR = String(
  process.env.GOOGLE_DRIVE_DOWNLOAD_DIR || path.join(FILES_ROOT, 'knowledge', 'google-drive')
).trim();
const QDRANT_URL = String(process.env.QDRANT_URL || 'http://qdrant:6333').trim();

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { files: {} };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2));
}

function validateConfig() {
  if (!FOLDER_ID) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set. Add it to .env and restart.');
  }
}

async function syncOnce(token, state) {
  const resource = { type: 'folder', id: FOLDER_ID, url: FOLDER_ID };
  const result = await syncDriveToRag({
    token,
    resource,
    downloadDir: DOWNLOAD_DIR,
    filesRoot: FILES_ROOT,
    ingestWebhook: INGEST_WEBHOOK,
    qdrantUrl: QDRANT_URL,
    recursive: RECURSIVE,
    state,
    rootFolderId: FOLDER_ID,
    onProgress: ({ phase, file, index, total, chunks, error }) => {
      if (phase === 'start') {
        console.log(`→ Checking: ${file.name} (${file.mimeType}) [${index}/${total}]`);
      } else if (phase === 'done') {
        console.log(`  ✓ ${chunks ?? '?'} chunks → ${file.name}`);
      } else if (phase === 'skip' && file) {
        console.log(`Skip ${file.name}: ${progress.reason || 'unchanged'}`);
      } else if (phase === 'error') {
        console.error(`  ✗ ${file.name}: ${error}`);
      }
    },
  });

  writeState(state);
  console.log(`Sync done: ${result.ingested} ingested, ${result.skipped} unchanged/skipped, ${result.total} total in folder`);
}

async function main() {
  console.log('Google Drive sync starting...');
  console.log(`  Folder: ${FOLDER_ID || '(not set)'}`);
  console.log(`  Credentials: ${CREDENTIALS_FILE}`);
  console.log(`  Ingest webhook: ${INGEST_WEBHOOK}`);
  console.log(`  Poll interval: ${POLL_SECONDS}s`);
  console.log(`  Recursive subfolders: ${RECURSIVE}`);

  let state = readState();
  let credentials = null;

  while (true) {
    try {
      validateConfig();
      if (!credentials) {
        credentials = loadCredentials(CREDENTIALS_FILE);
        console.log(`  Service account: ${credentials.client_email}`);
      }
      const token = await getAccessToken(credentials);
      await syncOnce(token, state);
    } catch (err) {
      const msg = String(err.message || err);
      if (
        msg.includes('GOOGLE_DRIVE_FOLDER_ID is not set')
        || msg.includes('Service account file not found')
        || msg.includes('Invalid service account')
      ) {
        credentials = null;
        console.error(msg);
        console.error('Waiting for configuration. See docs/google-drive-sync.md');
      } else {
        console.error(`Sync error: ${msg}`);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
