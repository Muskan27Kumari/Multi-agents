/**
 * Shared Drive Q&A session + query helpers (used by drive-rag-bot and main telegram-poller).
 */
const fs = require('fs');
const path = require('path');

const GENERIC_OUT_OF_SCOPE_RE =
  /I can only answer questions that are covered in our knowledge base/i;

const DRIVE_OUT_OF_SCOPE_RE =
  /couldn't find.*(?:clear answer|answer).*drive documents/i;

function sessionsFile() {
  const dataDir = process.env.TELEGRAM_DATA_DIR
    || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', '..', 'files'));
  return process.env.DRIVE_RAG_SESSIONS_FILE
    || path.join(dataDir, 'drive-rag-sessions.json');
}

function readDriveSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(sessionsFile(), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function getDriveSession(chatId) {
  return readDriveSessions()[String(chatId)] || null;
}

function hasReadyDriveSession(chatId) {
  const session = getDriveSession(chatId);
  return Boolean(session?.ready && !session?.syncing);
}

/** Plain text that should be answered from Drive docs (not booking menu picks or slash commands). */
function looksLikeDriveQuestion(text) {
  const raw = String(text || '').trim();
  if (!raw || /^\/\w/.test(raw)) return false;
  if (/^\d{1,2}$/.test(raw)) return false;
  if (!/[a-zA-Z?]/.test(raw)) return false;
  return raw.length >= 3;
}

function driveStatusText(session) {
  if (!session?.ready) {
    return 'No Drive folder connected yet.\n\nOpen @vgi_knowledge_assistant_bot and send your Google Drive URL.';
  }
  const lines = [
    'Connected Drive documents',
    `URL: ${session.drive_url || session.drive_resource?.url || '(unknown)'}`,
    `Documents: ${session.ingested_count ?? 0} · Chunks: ${session.total_chunks ?? 0}`,
  ];
  if (session.last_sync_at) lines.push(`Last sync: ${session.last_sync_at}`);
  lines.push('', 'Ask a question in plain text or use /ask <question>.');
  return lines.join('\n');
}

function envOr(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

function queryWebhookUrl() {
  const { internalN8nUrl } = require('./env');
  return String(
    process.env.RAG_WEBHOOK_URL || `${internalN8nUrl()}/webhook/rag-knowledge-agent`
  ).trim();
}

function buildDriveQueryPayload(chatId, question) {
  return {
    action: 'query',
    question,
    user_id: String(chatId),
    filter_results_by_user_id: true,
    kb_only: true,
    enable_fallback: false,
    enable_web_search: false,
    enable_query_history: false,
    collection_name: 'knowledge_base',
    channel: 'drive_rag',
    rag_score_threshold: 0.10,
    top_k: 8,
    notify_telegram: false,
    notify_email: false,
    telegram_bot_token: '',
    telegram_chat_id: '',
    qdrant_url: String(process.env.QDRANT_URL || 'http://qdrant:6333').trim(),
    metadata: { source: 'user_drive', drive_rag: true },
    openrouter_model: envOr('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
    openrouter_api_key: envOr('OPENROUTER_API_KEY'),
    openai_api_key: envOr('OPENAI_API_KEY'),
    embedding_model: envOr('EMBEDDING_MODEL', 'text-embedding-3-small'),
    embedding_dimensions: Number(process.env.EMBEDDING_DIMENSIONS || 1536),
  };
}

function formatDriveAnswer(data) {
  let answer = String(data.answer || data.telegram_text || '').trim();
  answer = answer.replace(/^Source: [^\n]+\n\n?/i, '').trim();
  return answer;
}

function shouldSendDriveAnswer(data, answer) {
  if (!answer) return false;
  if (data.out_of_scope === true) return false;
  if (GENERIC_OUT_OF_SCOPE_RE.test(answer) || DRIVE_OUT_OF_SCOPE_RE.test(answer)) return false;
  if (data.operation_mode === 'document_rag') return true;
  if (Number(data.retrieval_count || 0) > 0) return true;
  return false;
}

function driveOutOfScopeMessage(session, question = '') {
  const count = Number(session?.ingested_count || 0);
  const topic = String(question || '').trim().replace(/[?.!]+$/g, '');
  const docLabel = session?.drive_resource?.type === 'file'
    ? 'your connected file'
    : 'your connected Drive folder';

  if (!count) {
    return 'Connect a Google Drive folder first — send your folder URL or type /drive <url>.';
  }

  const lines = [
    topic
      ? `"${topic}" doesn't appear to be covered in ${docLabel}.`
      : `I couldn't find an answer in ${docLabel}.`,
    '',
    'This bot answers only from documents you connected here (e.g. React Notes.pdf).',
    '',
    'For the general knowledge base (RAG, Python, Vector DB, etc.), use @vgiskilluniversebot:',
    '• /ask What is RAG?',
    '• Or type your question directly',
    '',
    'To query your Drive file, ask about topics in that document, e.g.:',
    '• Why is React fast?',
    '• What is JSX?',
  ];
  return lines.join('\n');
}

async function queryDriveDocuments(chatId, question, timeoutMs) {
  const ms = Number(timeoutMs || process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 300000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(queryWebhookUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDriveQueryPayload(chatId, question)),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  sessionsFile,
  getDriveSession,
  hasReadyDriveSession,
  looksLikeDriveQuestion,
  driveStatusText,
  buildDriveQueryPayload,
  formatDriveAnswer,
  shouldSendDriveAnswer,
  driveOutOfScopeMessage,
  queryDriveDocuments,
};
