#!/usr/bin/env node
/**
 * Standalone Drive Q&A bot — users connect a Google Drive folder, then ask questions
 * answered only from documents in that folder.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN_DRIVE_RAG  — bot token from @BotFather
 *   GOOGLE_SERVICE_ACCOUNT_FILE   — service account JSON (folder must be shared with it)
 *   N8N_INGEST_WEBHOOK            — RAG ingest webhook (default: n8n internal)
 *   RAG_WEBHOOK_URL               — RAG query webhook
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const { safeFetch } = require('./lib/safe-fetch');
globalThis.fetch = safeFetch;

const { loadEnv, internalN8nUrl } = require('./lib/env');
const {
  extractDriveResource,
  isDriveUrl,
  loadCredentials,
  getAccessToken,
  syncDriveToRag,
} = require('./lib/google-drive');
const { qdrantDeleteByUserId } = require('./lib/qdrant-docs');
const {
  buildDriveQueryPayload,
  formatDriveAnswer,
  shouldSendDriveAnswer,
  driveOutOfScopeMessage,
} = require('./lib/drive-rag-query');

loadEnv(path.join(__dirname, '..'));

const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN_DRIVE_RAG || '').trim();
const CHAT_ALLOWLIST = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const CREDENTIALS_FILE = String(
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE || path.join(__dirname, '..', 'files', 'service-account-key.json')
).trim();
const INGEST_WEBHOOK = String(
  process.env.N8N_INGEST_WEBHOOK || `${internalN8nUrl()}/webhook/rag-knowledge-agent`
).trim();
const QUERY_WEBHOOK = String(
  process.env.RAG_WEBHOOK_URL || `${internalN8nUrl()}/webhook/rag-knowledge-agent`
).trim();
const QDRANT_URL = String(process.env.QDRANT_URL || 'http://qdrant:6333').trim();
const DATA_DIR = process.env.TELEGRAM_DATA_DIR
  || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'files'));
const SESSIONS_FILE = process.env.DRIVE_RAG_SESSIONS_FILE
  || path.join(DATA_DIR, 'drive-rag-sessions.json');
const OFFSET_FILE = process.env.TELEGRAM_OFFSET_FILE
  || path.join(DATA_DIR, 'telegram-poller-offset-drive-rag.json');
const FILES_ROOT = String(
  process.env.FILES_MOUNT_ROOT || (
    DATA_DIR.startsWith('/data') ? '/data' : path.join(__dirname, '..', 'files')
  )
).trim();
const POLL_TIMEOUT = Number(process.env.TELEGRAM_POLL_TIMEOUT || 30);
const QUERY_TIMEOUT_MS = Number(process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 300000);
const RECURSIVE = String(process.env.GOOGLE_DRIVE_RECURSIVE || 'true').toLowerCase() !== 'false';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN_DRIVE_RAG is required');
  process.exit(1);
}

let serviceAccountEmail = '';

function envOr(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

function readSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeSessions(sessions) {
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ ...sessions, updated_at: new Date().toISOString() }, null, 2));
}

function getSession(chatId) {
  return readSessions()[String(chatId)] || null;
}

function saveSession(chatId, patch) {
  const sessions = readSessions();
  const key = String(chatId);
  sessions[key] = { ...(sessions[key] || {}), ...patch, chat_id: key };
  writeSessions(sessions);
  return sessions[key];
}

function welcomeText() {
  const custom = String(process.env.TELEGRAM_DRIVE_RAG_WELCOME || process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');

  const shareHint = serviceAccountEmail
    ? `\n\nBefore connecting, share your Drive folder with:\n${serviceAccountEmail}\n(Viewer access is enough.)`
    : '';

  return [
    'VGI Drive Assistant',
    '',
    'Send a Google Drive file or folder URL, then ask questions — answers come only from your documents.',
    '',
    'How to use:',
    '1. Share your Drive file/folder with our service account (see below)',
    '2. Paste your Drive URL here (or /drive <url>)',
    '3. Wait for: ✅ Your Drive folder is ready!',
    '4. Ask anything about your documents',
    '',
    'Commands:',
    '• /drive <url> — connect a Drive folder',
    '• /status — show connected folder',
    '• /resync — re-index your folder',
    '• /help — show this guide',
    shareHint,
  ].join('\n');
}

function helpText() {
  return welcomeText();
}

function statusText(session) {
  if (!session?.ready) {
    return 'No Drive folder connected yet.\n\nSend a Google Drive folder URL or type /drive <url> to get started.';
  }
  const lines = [
    'Connected Drive folder',
    `URL: ${session.drive_url || session.drive_resource?.url || '(unknown)'}`,
    `Type: ${session.drive_resource?.type || 'folder'}`,
    `Documents ingested: ${session.ingested_count ?? 0}`,
    `Skipped: ${session.skipped_count ?? 0}`,
    `Total chunks: ${session.total_chunks ?? 0}`,
  ];
  if (session.last_sync_at) {
    lines.push(`Last sync: ${session.last_sync_at}`);
  }
  if (session.failed_count) {
    lines.push(`Failed: ${session.failed_count}`);
  }
  lines.push('', 'Send a question anytime, or /resync to refresh your documents.');
  return lines.join('\n');
}

function extractDriveInput(text) {
  const raw = String(text || '').trim();
  const driveCmd = raw.match(/^\/drive(?:@\w+)?\s+(.+)$/i);
  if (driveCmd) return driveCmd[1].trim();
  if (isDriveUrl(raw)) return raw;
  return null;
}

function readOffset() {
  try {
    const data = JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8'));
    return Number(data.offset || 0);
  } catch {
    return 0;
  }
}

function writeOffset(offset) {
  fs.mkdirSync(path.dirname(OFFSET_FILE), { recursive: true });
  fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset, updated_at: new Date().toISOString() }, null, 2));
}

function isSessionQueryable(session) {
  if (!session) return false;
  if (session.ready) return true;
  const chunks = Number(session.total_chunks || 0);
  const docs = Number(session.ingested_count || 0) + Number(session.skipped_count || 0);
  return chunks > 0 && docs > 0 && !session.syncing;
}

async function telegramApi(method, params = {}, retries = 3) {
  const url = new URL(`https://api.telegram.org/bot${TOKEN}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.description || `Telegram API ${method} failed`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  throw lastErr;
}

async function sendMessage(chatId, text) {
  try {
    await telegramApi('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000) });
  } catch (err) {
    console.error(`sendMessage failed for ${chatId}: ${err.message || err}`);
  }
}

async function ensurePollingMode() {
  while (true) {
    try {
      const info = await telegramApi('getWebhookInfo');
      if (info.result?.url) {
        console.log(`Removing Telegram webhook (${info.result.url}) to enable polling...`);
      }
      await telegramApi('deleteWebhook', { drop_pending_updates: false });
      return;
    } catch (err) {
      console.error(`Telegram API unreachable (${err.message || err}). Retrying in 15s...`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}

async function ensureExclusivePoller() {
  const ragToken = String(process.env.TELEGRAM_BOT_TOKEN_RAG || '').trim();
  if (ragToken && ragToken === TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN_RAG matches this bot — misconfigured token.');
    process.exit(1);
  }
}

function buildQueryPayload(chatId, question) {
  return buildDriveQueryPayload(chatId, question);
}

async function queryKnowledgeBase(chatId, question) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(QUERY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQueryPayload(chatId, question)),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `Query failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function syncUserDrive(chatId, driveInput, { forceReingest = false } = {}) {
  const resource = extractDriveResource(driveInput);
  if (!resource) {
    await sendMessage(chatId, 'Could not parse that Drive URL.\n\nSend a folder link like:\nhttps://drive.google.com/drive/folders/YOUR_FOLDER_ID');
    return;
  }

  const credentials = loadCredentials(CREDENTIALS_FILE);
  serviceAccountEmail = credentials.client_email;

  const prev = getSession(chatId);
  const folderChanged = prev?.drive_resource?.id !== resource.id || prev?.drive_resource?.type !== resource.type;

  if (folderChanged || forceReingest) {
    await sendMessage(chatId, 'Clearing previous documents from your knowledge base…');
    try {
      const removed = await qdrantDeleteByUserId(chatId);
      if (removed > 0) {
        console.log(`Removed ${removed} chunks for user ${chatId}`);
      }
    } catch (err) {
      console.error(`Failed to clear user docs: ${err.message || err}`);
    }
  }

  saveSession(chatId, {
    drive_url: driveInput,
    drive_resource: resource,
    ready: false,
    syncing: true,
    service_account_email: credentials.client_email,
  });

  await sendMessage(
    chatId,
    [
      'Connecting to your Google Drive…',
      '',
      `Make sure the folder is shared with:\n${credentials.client_email}`,
      '',
      'Downloading and indexing your documents. This may take a few minutes for PDFs.',
    ].join('\n')
  );

  const downloadDir = path.join(FILES_ROOT, 'knowledge', 'user-drive', String(chatId));
  const state = { files: {} };
  let lastProgressAt = 0;

  try {
    const token = await getAccessToken(credentials);
    const result = await syncDriveToRag({
      token,
      resource,
      userId: String(chatId),
      downloadDir,
      filesRoot: FILES_ROOT,
      ingestWebhook: INGEST_WEBHOOK,
      qdrantUrl: QDRANT_URL,
      recursive: RECURSIVE,
      state,
      rootFolderId: resource.type === 'folder' ? resource.id : '',
      forceReingest: folderChanged || forceReingest,
      onProgress: async (progress) => {
        const now = Date.now();
        if (progress.phase === 'start' && now - lastProgressAt > 8000) {
          lastProgressAt = now;
          const label = progress.file?.name || 'document';
          try {
            await telegramApi('sendMessage', {
              chat_id: chatId,
              text: `Processing ${progress.index}/${progress.total}: ${label}…`,
            });
          } catch (err) {
            console.error(`Progress message failed: ${err.message || err}`);
          }
        }
      },
    });

    const ready = result.ingested > 0 || (result.skipped > 0 && result.failed === 0);
    saveSession(chatId, {
      drive_url: driveInput,
      drive_resource: resource,
      ready,
      syncing: false,
      ingested_count: result.ingested,
      skipped_count: result.skipped,
      failed_count: result.failed,
      total_chunks: result.totalChunks,
      total_files: result.total,
      last_sync_at: new Date().toISOString(),
      sync_errors: result.errors,
      service_account_email: credentials.client_email,
    });

    if (result.total === 0) {
      await sendMessage(chatId, 'No supported documents found in that Drive folder.\n\nSupported: PDF, Word, PowerPoint, text, Markdown, CSV, and Google Docs/Sheets/Slides.');
      return;
    }

    if (result.ingested === 0 && result.skipped === 0) {
      const errSample = result.errors[0]?.error || 'Unknown error';
      await sendMessage(chatId, `Could not ingest any documents.\n\nError: ${errSample.slice(0, 300)}\n\nCheck that the folder is shared with ${credentials.client_email} and try /resync.`);
      return;
    }

    const lines = [
      '✅ Your Drive folder is ready!',
      '',
      `Indexed: ${result.ingested} document(s) (${result.totalChunks} chunks)`,
    ];
    if (result.skipped) lines.push(`Skipped (unchanged): ${result.skipped}`);
    if (result.failed) lines.push(`Failed: ${result.failed}`);
    lines.push(
      '',
      'You can now ask questions about your files — answers come only from this folder.',
      '',
      'Examples:',
      '• Summarize the main topics',
      '• How does [topic] work?',
      '• What are the key points in section 3?',
    );
    await sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    const prev = getSession(chatId);
    const hadIndex = Number(prev?.total_chunks || 0) > 0
      && (Number(prev?.ingested_count || 0) + Number(prev?.skipped_count || 0)) > 0;
    saveSession(chatId, { ready: hadIndex, syncing: false });
    const msg = String(err.message || err);
    console.error(`Sync failed for ${chatId}: ${msg}`);
    if (/403|404|not found|permission/i.test(msg)) {
      await sendMessage(
        chatId,
        `Could not access that Drive folder.\n\nShare it with:\n${credentials.client_email}\n\nThen send the folder URL again.`
      );
    } else {
      await sendMessage(chatId, `Sync failed: ${msg.slice(0, 400)}\n\nTry /resync or check your folder URL.`);
    }
  }
}

async function handleQuestion(chatId, question) {
  const session = getSession(chatId);
  if (!isSessionQueryable(session)) {
    await sendMessage(
      chatId,
      'Connect a Google Drive folder first.\n\nSend your folder URL or type /drive <url>, then ask questions once indexing finishes.'
    );
    return;
  }

  await sendMessage(chatId, '🔍 Searching your Drive documents…');
  try {
    const data = await queryKnowledgeBase(chatId, question);
    const answer = formatDriveAnswer(data);

    if (shouldSendDriveAnswer(data, answer)) {
      await sendMessage(chatId, answer);
      console.log(`✓ Answered ${chatId}: ${question.slice(0, 60)} (hits=${data.retrieval_count ?? 0})`);
      return;
    }

    await sendMessage(chatId, driveOutOfScopeMessage(session, question));
    console.log(`✓ No match for ${chatId}: ${question.slice(0, 60)} (hits=${data.retrieval_count ?? 0})`);
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    await sendMessage(
      chatId,
      timedOut
        ? 'The request took too long. Please try a shorter or more specific question.'
        : `Sorry, I could not process your question: ${String(err.message || err).slice(0, 200)}`
    );
    console.error(`Query error for ${chatId}: ${err.message || err}`);
  }
}

async function forwardUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat?.id || '');
  const rawText = String(msg.text || '').trim();
  if (!chatId || !rawText) return;

  if (CHAT_ALLOWLIST && chatId !== CHAT_ALLOWLIST) {
    await sendMessage(chatId, 'This bot is currently restricted. Please contact the administrator.');
    return;
  }

  const lower = rawText.toLowerCase();
  if (lower.startsWith('/start') || lower === '/help') {
    try {
      const creds = loadCredentials(CREDENTIALS_FILE);
      serviceAccountEmail = creds.client_email;
    } catch {
      // credentials missing — welcome still explains setup
    }
    await sendMessage(chatId, welcomeText());
    return;
  }

  if (lower === '/status') {
    await sendMessage(chatId, statusText(getSession(chatId)));
    return;
  }

  if (lower === '/resync') {
    const session = getSession(chatId);
    if (!session?.drive_url) {
      await sendMessage(chatId, 'No folder connected yet. Send a Drive folder URL or /drive <url>.');
      return;
    }
    await syncUserDrive(chatId, session.drive_url, { forceReingest: true });
    return;
  }

  const driveInput = extractDriveInput(rawText);
  if (driveInput) {
    console.log(`→ [drive-rag] ${chatId}: connect ${driveInput.slice(0, 80)}`);
    await syncUserDrive(chatId, driveInput);
    return;
  }

  const session = getSession(chatId);
  if (session?.syncing) {
    await sendMessage(chatId, '⏳ Still indexing your Drive files… please wait until you see “Your Drive folder is ready!”');
    return;
  }

  if (rawText.startsWith('/')) {
    await sendMessage(chatId, 'Unknown command. Type /help for usage.');
    return;
  }

  console.log(`→ [drive-rag] ${chatId}: ${rawText.replace(/\s+/g, ' ').slice(0, 80)}`);
  await handleQuestion(chatId, rawText);
}

async function initOffset() {
  if (fs.existsSync(OFFSET_FILE)) return readOffset();
  const data = await telegramApi('getUpdates', { timeout: 0 });
  const updates = data.result || [];
  const offset = updates.length ? updates[updates.length - 1].update_id + 1 : 0;
  writeOffset(offset);
  if (updates.length) {
    console.log(`Skipped ${updates.length} queued message(s). Send a new message to interact.`);
  }
  return offset;
}

async function pollForever() {
  let offset = await initOffset();
  console.log(`Drive RAG bot → ingest: ${INGEST_WEBHOOK}`);
  console.log(`Drive RAG bot → query: ${QUERY_WEBHOOK}`);
  console.log(`Sessions: ${SESSIONS_FILE} (offset=${offset})`);

  try {
    const creds = loadCredentials(CREDENTIALS_FILE);
    serviceAccountEmail = creds.client_email;
    console.log(`Service account: ${serviceAccountEmail}`);
  } catch (err) {
    console.error(`Warning: ${err.message || err}`);
  }

  while (true) {
    try {
      const data = await telegramApi('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: JSON.stringify(['message']),
      });

      for (const update of data.result || []) {
        offset = update.update_id + 1;
        writeOffset(offset);
        await forwardUpdate(update);
      }
    } catch (err) {
      const msg = String(err.message || err);
      console.error(`Poll error: ${msg}`);
      const delay = /conflict/i.test(msg) ? 30000 : 5000;
      if (/conflict/i.test(msg)) {
        console.error('Another process is polling this bot token. Only one poller per token is allowed.');
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

(async () => {
  await ensurePollingMode();
  await ensureExclusivePoller();
  await pollForever();
})();
