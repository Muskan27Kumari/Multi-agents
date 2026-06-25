/**
 * Channel payload adapters — normalize webhook and Telegram update payloads.
 */
module.exports.adaptChannelPayloadCode = `const raw = $input.first().json;
const out = { ...raw, channel: 'webhook' };

if (raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)) {
  for (const [k, v] of Object.entries(raw.body)) {
    if (out[k] === undefined || out[k] === '' || out[k] === null) out[k] = v;
  }
}

// Default API keys from env when not in payload
if (!String(out.openrouter_api_key || '').trim()) {
  const envKey = String($env.OPENROUTER_API_KEY || '').trim();
  if (envKey) out.openrouter_api_key = envKey;
}
if (!String(out.qdrant_url || '').trim()) {
  const envQdrant = String($env.QDRANT_URL || '').trim();
  if (envQdrant) out.qdrant_url = envQdrant;
}

return [{ json: out }];`;

module.exports.adaptTelegramPayloadCode = `const raw = $input.first().json;
const token = String(
  raw.telegram_bot_token || raw.body?.telegram_bot_token
  || $env.TELEGRAM_BOT_TOKEN || ''
).trim();
const allowedChatId = String($env.TELEGRAM_CHAT_ID || '').trim();
const qdrantUrl = String($env.QDRANT_URL || '').trim().replace(/\\/$/, '');

function skip(reason) {
  return [{ json: { telegram_skip: true, channel: 'telegram', skip_reason: reason } }];
}

function reply(text, chatId) {
  return [{
    json: {
      action: 'telegram_reply',
      channel: 'telegram',
      notify_telegram: true,
      notify_email: false,
      telegram_bot_token: token,
      telegram_chat_id: chatId,
      telegram_text: text,
    },
  }];
}

let update = raw;
if (raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)) {
  if (raw.body.update_id != null || raw.body.message) update = raw.body;
}
if (typeof raw.body === 'string' && raw.body.trim()) {
  try {
    const parsed = JSON.parse(raw.body);
    if (parsed && (parsed.update_id != null || parsed.message)) update = parsed;
  } catch (e) { /* ignore */ }
}

const msg = update?.message;
if (!msg) return skip('no_message');
if (msg.from?.is_bot) return skip('bot_message');

const chatId = String(msg.chat?.id || '').trim();
if (!token) return skip('missing_bot_token');
if (!chatId) return skip('missing_chat_id');

if (allowedChatId && chatId !== allowedChatId) {
  return reply('This bot is restricted to an authorized chat.', chatId);
}

const text = String(msg.text || '').trim();
if (!text) {
  return reply('Send me a question in plain text — I\\'ll search your learning materials and reply here.', chatId);
}

function normalizeGreeting(text) {
  return String(text || '').trim().toLowerCase().replace(/[!?.…,]+$/g, '').replace(/\\s+/g, ' ');
}

function isGreeting(text) {
  const t = normalizeGreeting(text);
  if (!t) return false;
  const greetings = new Set([
    'hi', 'hello', 'hey', 'hiya', 'howdy', 'greetings', 'sup', 'yo',
    'good morning', 'good afternoon', 'good evening', 'good day',
    'morning', 'afternoon', 'evening',
    'hi there', 'hello there', 'hey there',
  ]);
  if (greetings.has(t)) return true;
  return /^h+i+$/.test(t)
    || /^he+l+o+$/.test(t)
    || /^he+y+$/.test(t)
    || /^(hi|hello|hey|hola)(\\s+there)?$/.test(t)
    || /^good\\s+(morning|afternoon|evening|day)$/.test(t);
}

function vgiSkillUniverseGreeting() {
  const custom = String($env.TELEGRAM_RAG_WELCOME || '').trim();
  if (custom) return custom.replace(/\\\\n/g, '\\n');
  const brand = String($env.BRAND_NAME || 'VGI Skill Universe!').trim().toUpperCase();
  return [
    'Welcome to ' + brand,
    '',
    '🤖 Ask me anything from your learning materials!',
    '',
    'I can answer questions using PDFs, tutorials, documents, and Google Drive content.',
    '',
    'Examples:',
    '• What are the key points in this PDF?',
    '• Explain this concept in simple terms.',
    '• Create a summary of this document.',
    '• What does this section mean?',
    '• Generate interview questions from this material.',
    '• Compare the topics covered in these documents.',
    '',
    '💬 Send your question to get started.',
  ].join('\\n');
}

const lower = text.toLowerCase();
if (lower === '/start' || lower.startsWith('/start ') || lower === '/help' || isGreeting(text)) {
  return reply(vgiSkillUniverseGreeting(), chatId);
}

function isDriveUrl(text) {
  const t = String(text || '').trim();
  return /drive\\.google\\.com\\/(drive\\/folders\\/|file\\/d\\/)/i.test(t)
    || /^\\/drive(?:@\\w+)?\\b/i.test(t);
}

// Drive folder/file links are handled by the Drive Q&A bot — never run a KB query on the URL text
if (isDriveUrl(text)) {
  return skip('drive_url');
}

// Bare /ask or /rag with no question — prompt instead of querying the KB
if (/^\\/(?:ask|rag)(?:@\\w+)?\\s*$/i.test(text)) {
  return reply(
    'Send your question after /ask.\\n\\nExample: /ask Why is React fast?\\n\\nOr type your question directly without /ask.',
    chatId
  );
}

const driveRagToken = String($env.TELEGRAM_BOT_TOKEN_DRIVE_RAG || '').trim();
const isDriveBot = Boolean(driveRagToken && token === driveRagToken);

// Drive Q&A bot: always scope queries to this user's ingested Drive documents
if (isDriveBot) {
  return [{
    json: {
      action: 'query',
      channel: 'drive_rag',
      question: text,
      user_id: chatId,
      filter_results_by_user_id: true,
      kb_only: true,
      enable_fallback: false,
      enable_query_history: false,
      notify_telegram: true,
      notify_email: false,
      telegram_bot_token: token,
      telegram_chat_id: chatId,
      metadata: { drive_rag: true, telegram_chat_id: chatId, source: 'user_drive' },
      collection_name: 'knowledge_base',
      rag_score_threshold: 0.10,
      top_k: 8,
      openrouter_model: String($env.OPENROUTER_MODEL || '').trim(),
      openrouter_api_key: String($env.OPENROUTER_API_KEY || '').trim().replace(/^Bearer\\s+/i, ''),
      openai_api_key: String($env.OPENAI_API_KEY || '').trim().replace(/^Bearer\\s+/i, ''),
      qdrant_url: qdrantUrl,
    },
  }];
}

return [{
  json: {
    action: 'query',
    channel: 'telegram',
    question: text,
    kb_only: true,
    enable_fallback: false,
    enable_query_history: false,
    notify_telegram: true,
    notify_email: false,
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    telegram_user_id: String(msg.from?.id || msg.from?.username || chatId),
    metadata: { telegram_user_id: String(msg.from?.id || ''), telegram_chat_id: chatId },
    collection_name: 'knowledge_base',
    rag_score_threshold: 0.15,
    openrouter_model: String($env.OPENROUTER_MODEL || '').trim(),
    openrouter_api_key: String($env.OPENROUTER_API_KEY || '').trim().replace(/^Bearer\\s+/i, ''),
    qdrant_url: qdrantUrl,
  },
}];`;

module.exports.returnTelegramReplyCode = `const item = $input.first().json;
return [{
  json: {
    success: true,
    action: 'telegram_reply',
    channel: 'telegram',
    telegram_sent: item.telegram_sent === true,
    telegram_error: item.telegram_error || null,
    completed_at: new Date().toISOString(),
  },
}];`;
