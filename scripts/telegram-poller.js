#!/usr/bin/env node
/**
 * Polls Telegram getUpdates and forwards messages to n8n Telegram webhooks.
 * Use this when n8n runs on localhost (Telegram cannot call HTTP webhooks directly).
 *
 * Routing (unless N8N_TELEGRAM_WEBHOOK overrides everything):
 *   - Questions & plain text → RAG Knowledge Agent (knowledge-base Q&A)
 *   - /ask or /rag → RAG Knowledge Agent
 *   - Photos, product links, or review intent → Customer Review Responder
 *   - /review or /reviews → Customer Review Responder
 *   - /book, /appointment, /cancel, or active booking session → Appointment Booking Agent
 *   - /content or marketing content intent → Marketing Content Agent
 *   - /report or portfolio report intent → Portfolio Market Report
 *   - /scan → Resume Analysis Agent
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
const { isDriveUrl } = require('./lib/google-drive');
const {
  unwrapN8nBody,
  isMarketingIntent,
  isPortfolioIntent,
  formatMarketingTelegram,
  formatPortfolioTelegram,
  formatResumeTelegram,
  portfolioWorkflowFailed,
  portfolioWorkflowOwnsTelegram,
  sharedBotWelcomeText,
  stripReviewCommand,
  isBareReviewCommand,
  reviewPromptText,
  isResumeScanIntent,
  parseScanTarget,
  resumeScanHelpText,
  isResumeDocument,
  buildMarketingPayload,
  buildPortfolioPayload,
  buildResumePayload,
  buildUploadedResumePayload,
  listResumeFilePaths,
} = require('./lib/telegram-aux-routes');

loadEnv(path.join(__dirname, '..'));

const INTERNAL_N8N = internalN8nUrl();
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const DRIVE_RAG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN_DRIVE_RAG || '').trim();
if (DRIVE_RAG_TOKEN && TOKEN === DRIVE_RAG_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN matches Drive Q&A bot — use telegram-bot-drive-rag only.');
  process.exit(1);
}
// When set, only this chat id is served. Leave unset for a public bot.
const CHAT_ALLOWLIST = String(process.env.TELEGRAM_CHAT_ID || '').trim();
function welcomeText() {
  return sharedBotWelcomeText();
}
const WEBHOOK_LEGACY = String(process.env.N8N_TELEGRAM_WEBHOOK || '').trim();
const WEBHOOK_REVIEW = String(
  process.env.N8N_TELEGRAM_WEBHOOK_REVIEW
  || `${INTERNAL_N8N}/webhook/customer-review-responder-telegram`
).trim();
const WEBHOOK_RAG = String(
  process.env.N8N_TELEGRAM_WEBHOOK_RAG
  || `${INTERNAL_N8N}/webhook/rag-knowledge-agent-telegram`
).trim();
const WEBHOOK_BOOKING = String(
  process.env.N8N_TELEGRAM_WEBHOOK_BOOKING
  || `${INTERNAL_N8N}/webhook/appointment-booking-agent-telegram`
).trim();
const WEBHOOK_MARKETING = String(
  process.env.N8N_TELEGRAM_WEBHOOK_MARKETING
  || `${INTERNAL_N8N}/webhook/marketing-content`
).trim();
const WEBHOOK_PORTFOLIO = String(
  process.env.N8N_TELEGRAM_WEBHOOK_PORTFOLIO
  || `${INTERNAL_N8N}/webhook/portfolio-market-report`
).trim();
const WEBHOOK_RESUME = String(
  process.env.N8N_TELEGRAM_WEBHOOK_RESUME
  || `${INTERNAL_N8N}/webhook/resume-analysis-agent`
).trim();
const PORTFOLIO_TIMEOUT_MS = Number(
  process.env.TELEGRAM_PORTFOLIO_TIMEOUT_MS || process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 600000
);
const RESUME_TIMEOUT_MS = Number(
  process.env.TELEGRAM_RESUME_TIMEOUT_MS || process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 600000
);
const DATA_DIR = process.env.TELEGRAM_DATA_DIR
  || (fs.existsSync('/data/telegram-poller-offset.json') || fs.existsSync('/data/appointments')
    ? '/data'
    : path.join(__dirname, '..', 'files'));
const SESSIONS_FILE = process.env.APPOINTMENT_SESSIONS_FILE
  || path.join(DATA_DIR, 'appointments', 'sessions.json');
const BOOKINGS_FILE = process.env.APPOINTMENT_BOOKINGS_FILE
  || path.join(DATA_DIR, 'appointments', 'bookings.json');
const REVIEW_SESSIONS_FILE = process.env.REVIEW_SESSIONS_FILE
  || path.join(DATA_DIR, 'review-sessions.json');
const POLL_TIMEOUT = Number(process.env.TELEGRAM_POLL_TIMEOUT || 30);
const WEBHOOK_TIMEOUT_MS = Number(process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 300000);
const OFFSET_FILE = process.env.TELEGRAM_OFFSET_FILE
  || path.join(__dirname, '..', 'files', 'telegram-poller-offset.json');

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
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

async function telegramApi(method, params = {}) {
  const url = new URL(`https://api.telegram.org/bot${TOKEN}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data;
}

function readAppointmentJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // ignore corrupt state files
  }
  return fallback;
}

function loadBookingSessions() {
  const data = readAppointmentJson(SESSIONS_FILE, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function loadBookingAppointments() {
  const data = readAppointmentJson(BOOKINGS_FILE, { appointments: [] });
  return Array.isArray(data.appointments) ? data.appointments : [];
}

function clearBookingSession(chatId) {
  try {
    const sessions = loadBookingSessions();
    delete sessions[String(chatId || '')];
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error(`Failed to clear booking session: ${e.message || e}`);
  }
}

function hasActiveBookingSession(chatId) {
  try {
    const sessions = loadBookingSessions();
    const key = String(chatId || '');
    const session = sessions[key];
    if (!session?.step || session.step === 'idle') return false;
    const updatedAt = session.updated_at ? new Date(session.updated_at).getTime() : 0;
    const maxAge = 30 * 60 * 1000;
    if (updatedAt && Date.now() - updatedAt > maxAge) {
      delete sessions[key];
      try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
      } catch {
        // ignore
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function loadReviewSessions() {
  const data = readAppointmentJson(REVIEW_SESSIONS_FILE, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function setReviewSession(chatId, active) {
  const sessions = loadReviewSessions();
  const key = String(chatId || '');
  if (active) {
    sessions[key] = { waiting: true, started_at: Date.now() };
  } else {
    delete sessions[key];
  }
  try {
    fs.mkdirSync(path.dirname(REVIEW_SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(REVIEW_SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error(`Failed to save review session: ${e.message || e}`);
  }
}

function hasActiveReviewSession(chatId) {
  const session = loadReviewSessions()[String(chatId || '')];
  if (!session?.waiting) return false;
  if (Date.now() - Number(session.started_at || 0) > 30 * 60 * 1000) {
    setReviewSession(chatId, false);
    return false;
  }
  return true;
}

function isBookingIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const command = lower.split(/\s+/)[0].replace(/@\w+$/, '');
  if (['/book', '/appointment', '/cancel'].includes(command)) return true;
  if (lower === 'book appointment') return true;
  return false;
}

function isReviewIntent(text, hasImage) {
  if (hasImage) return true;
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/^\/review(s)?\b/i.test(raw)) return true;
  if (/https?:\/\//i.test(raw)) return true;
  if (/\b(reviews?|customer\s+feedback|buyer\s+feedback|buyer\s+opinions?|user\s+opinions?|opinions?\s+on|worth\s+buying|ratings?)\b/i.test(raw)) {
    return true;
  }
  if (/\b(amazon|flipkart|amzn\.|ebay|myntra|ajio|meesho)\b/i.test(raw)) return true;
  return false;
}

function isWorkflowCommand(text) {
  const raw = String(text || '').trim().toLowerCase();
  const cmd = raw.split(/\s+/)[0].replace(/@\w+$/, '');
  return [
    '/report',
    '/portfolio',
    '/content',
    '/rag',
    '/ask',
    '/review',
    '/reviews',
    '/book',
    '/appointment',
    '/cancel',
    '/scan',
  ].includes(cmd);
}

function pickRoute(text, hasImage = false, chatId = '', hasResumeDoc = false) {
  const raw = String(text || '').trim();
  if (WEBHOOK_LEGACY) {
    return { webhook: WEBHOOK_LEGACY, text: raw, kind: 'legacy' };
  }

  if (hasResumeDoc) {
    return {
      webhook: WEBHOOK_RESUME,
      text: raw,
      kind: 'resume',
      jsonPayload: true,
      uploadedResume: true,
    };
  }

  // Slash commands for other workflows must win over an in-progress booking session.
  if (/^\/report\b/i.test(raw) || /^\/portfolio\b/i.test(raw) || isPortfolioIntent(raw)) {
    return {
      webhook: WEBHOOK_PORTFOLIO,
      text: raw,
      kind: 'portfolio',
      jsonPayload: true,
    };
  }
  if (/^\/content\b/i.test(raw) || isMarketingIntent(raw)) {
    return {
      webhook: WEBHOOK_MARKETING,
      text: raw,
      kind: 'marketing',
      jsonPayload: true,
    };
  }
  if (/^\/scan\b/i.test(raw) || isResumeScanIntent(raw)) {
    if (!parseScanTarget(raw)) {
      return { kind: 'resume_scan_help' };
    }
    return {
      webhook: WEBHOOK_RESUME,
      text: raw,
      kind: 'resume',
      jsonPayload: true,
    };
  }
  if (/^\/rag\b/i.test(raw) || /^\/ask\b/i.test(raw)) {
    const question = raw.replace(/^\/\w+(?:@\w+)?\s*/i, '').trim();
    if (!question) {
      return { kind: 'ask_prompt' };
    }
    return {
      webhook: WEBHOOK_RAG,
      text: question,
      kind: 'rag',
    };
  }
  if (isBareReviewCommand(raw)) {
    return { kind: 'review_prompt' };
  }
  if (/^\/review(s)?\b/i.test(raw)) {
    return {
      webhook: WEBHOOK_REVIEW,
      text: stripReviewCommand(raw),
      kind: 'review',
    };
  }

  // Review (URL, photo, product name, or /review follow-up) must win over an in-progress booking session.
  if (hasActiveReviewSession(chatId) && !isWorkflowCommand(raw)) {
    return { webhook: WEBHOOK_REVIEW, text: raw, kind: 'review' };
  }
  if (isReviewIntent(raw, hasImage)) {
    return { webhook: WEBHOOK_REVIEW, text: stripReviewCommand(raw) || raw, kind: 'review' };
  }

  if (isBookingIntent(raw) || (!isWorkflowCommand(raw) && hasActiveBookingSession(chatId))) {
    return { webhook: WEBHOOK_BOOKING, text: raw, kind: 'booking' };
  }

  if (isDriveUrl(raw) || /^\/drive\b/i.test(raw)) {
    return { kind: 'drive_url_skip' };
  }

  return { webhook: WEBHOOK_RAG, text: raw, kind: 'rag' };
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

async function sendUserMessage(chatId, text) {
  try {
    await telegramApi('sendMessage', { chat_id: chatId, text });
  } catch (sendErr) {
    console.error(`Failed to send user message: ${sendErr.message || sendErr}`);
  }
}

function messageHasImage(msg) {
  if (!msg) return false;
  if (Array.isArray(msg.photo) && msg.photo.length) return true;
  if (msg.document && /^image\//i.test(String(msg.document.mime_type || ''))) return true;
  return false;
}

async function forwardUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const rawText = String(msg.text || msg.caption || '').trim();
  const hasImage = messageHasImage(msg);
  const hasResumeDoc = isResumeDocument(msg);
  if (!rawText && !hasImage && !hasResumeDoc) return;

  const chatId = String(msg.chat?.id || '');
  if (CHAT_ALLOWLIST && chatId !== CHAT_ALLOWLIST) {
    console.log(`Skipping chat ${chatId} (not in TELEGRAM_CHAT_ID allowlist)`);
    await sendUserMessage(chatId, 'This bot is currently restricted. Please contact the administrator.');
    return;
  }

  const lowerText = rawText.toLowerCase();
  if (lowerText.startsWith('/start') || lowerText === '/help') {
    const param = rawText.slice(6).trim();
    if (param) {
      const agentDetails = {
        'rag-knowledge-agent': {
          name: 'RAG Knowledge Agent',
          desc: 'Turn your PDFs, docs, and wikis into a chat interface that answers with exact citations from your sources.'
        },
        'marketing-content-agent': {
          name: 'Marketing Content Agent',
          desc: 'Generates on-brand social posts, blog drafts, and ad copy across channels from a single content brief.'
        },
        'stock-market-agent': {
          name: 'Stock Market Agent',
          desc: 'Watches your portfolio, news, and technical signals to surface daily insights and unusual-move alerts.'
        },
        'hr-recruitment-agent': {
          name: 'HR Recruitment Agent',
          desc: 'Screens incoming CVs against your JD, shortlists the top 10, and schedules screening calls automatically.'
        },
        'customer-review-responder': {
          name: 'Customer Review Responder',
          desc: 'Drafts on-brand replies to Google, Yelp, and Amazon reviews — every reply approved by you before posting.'
        },
        'appointment-booking-agent': {
          name: 'Appointment Booking Agent',
          desc: 'Books, reschedules, and reminds — across WhatsApp, voice, and web — synced to your team\'s calendars.'
        }
      };

      const agent = agentDetails[param];
      if (agent) {
        await sendUserMessage(chatId, `🤖 Welcome to VGI Skill Universe!\n\nYou have requested: ${agent.name}.\n\nDescription: ${agent.desc}\n\nType your message or question to begin.`);
        console.log(`✓ Sent agent-specific welcome for ${param} to ${chatId}`);
        return;
      }
    }
    await sendUserMessage(chatId, welcomeText());
    console.log(`✓ Sent welcome to ${chatId}`);
    return;
  }

  const route = pickRoute(rawText, hasImage, chatId, hasResumeDoc);

  if (/^\/cancel\b/i.test(rawText) && hasActiveReviewSession(chatId)) {
    setReviewSession(chatId, false);
    await sendUserMessage(chatId, 'Review request cancelled. Send /review when you want to research a product.');
    console.log(`✓ Cleared review session for ${chatId}`);
    return;
  }

  if (/^\/cancel\b/i.test(rawText) && hasActiveBookingSession(chatId)) {
    clearBookingSession(chatId);
    await sendUserMessage(chatId, 'Booking cancelled. Ask a question about the knowledge base, or type /book to start again.');
    console.log(`✓ Cleared booking session for ${chatId}`);
    return;
  }

  if (route.kind === 'review_prompt') {
    setReviewSession(chatId, true);
    await sendUserMessage(chatId, reviewPromptText());
    console.log(`✓ Sent review prompt to ${chatId}`);
    return;
  }

  if (route.kind === 'drive_url_skip') {
    await sendUserMessage(
      chatId,
      'Google Drive Q&A is handled by @Vgi_drive_assistant_bot.\n\nOpen that bot and send your Drive URL there.'
    );
    console.log(`✓ Redirected drive URL to Drive Q&A bot for ${chatId}`);
    return;
  }

  if (route.kind === 'ask_prompt') {
    await sendUserMessage(
      chatId,
      'Send your question after /ask.\n\nExample: `/ask What is RAG?`\n\nOr type your question directly — I\'ll search the knowledge base.'
    );
    console.log(`✓ Sent /ask prompt to ${chatId}`);
    return;
  }

  if (route.kind === 'resume_scan_help') {
    await sendUserMessage(chatId, resumeScanHelpText());
    console.log(`✓ Sent resume scan help to ${chatId}`);
    return;
  }

  const preview = hasResumeDoc && !rawText
    ? `[resume:${String(msg.document?.file_name || 'document').slice(0, 40)}]`
    : hasImage && !rawText
      ? '[photo]'
      : String(route.text || rawText).replace(/\s+/g, ' ').slice(0, 80);
  console.log(`→ [${route.kind}] ${chatId}: ${preview}`);

  if (route.kind === 'review') {
    setReviewSession(chatId, false);
  }

  if (route.kind === 'resume' && route.jsonPayload && !route.uploadedResume) {
    const scanTarget = parseScanTarget(rawText);
    if (!scanTarget) {
      await sendUserMessage(chatId, resumeScanHelpText());
      console.log(`✓ Sent resume scan help to ${chatId}`);
      return;
    }
    if (!listResumeFilePaths().length) {
      await sendUserMessage(
        chatId,
        'No resume PDFs found. Send a PDF directly, or add files to files/resumes/ and use /scan <filename>.'
      );
      return;
    }
    try {
      buildResumePayload(chatId, TOKEN, scanTarget);
    } catch (err) {
      await sendUserMessage(chatId, String(err.message || 'Resume not found.').slice(0, 500));
      return;
    }
  }

  if (route.kind === 'rag') {
    await sendUserMessage(chatId, '🔍 Searching knowledge base…');
  } else if (route.kind === 'booking') {
    if (isBookingIntent(rawText)) {
      await sendUserMessage(chatId, '📅 Starting appointment booking…');
    }
  } else if (route.kind === 'review') {
    const reviewText = String(route.text || rawText || '').trim();
    if (!reviewText && !hasImage) {
      setReviewSession(chatId, true);
      await sendUserMessage(chatId, reviewPromptText());
      console.log(`✓ Sent review prompt to ${chatId} (empty input)`);
      return;
    }
    if (hasImage) {
      await sendUserMessage(
        chatId,
        '🔍 Analyzing your product photo and researching reviews. This usually takes 30–90 seconds…'
      );
    } else {
      const isUrl = /https?:\/\//i.test(reviewText);
      await sendUserMessage(
        chatId,
        isUrl
          ? '🔗 Fetching product details from your link, then researching customer reviews…'
          : '🔍 Researching reviews and opinions. This usually takes 30–90 seconds…'
      );
    }
  } else if (route.kind === 'marketing') {
    await sendUserMessage(chatId, '✍️ Generating marketing content… This usually takes 1–2 minutes.');
  } else if (route.kind === 'portfolio') {
    await sendUserMessage(
      chatId,
      '📊 Running portfolio analysis (quotes, fundamentals, news, signals)… This may take 2–5 minutes.'
    );
  } else if (route.kind === 'resume') {
    await sendUserMessage(
      chatId,
      route.uploadedResume
        ? '📄 Analyzing your uploaded resume (ATS + AI)… This usually takes 30–90 seconds.'
        : '📄 Analyzing resume (ATS + AI)… This usually takes 30–90 seconds.'
    );
  }

  let payload;
  if (route.jsonPayload) {
    if (route.kind === 'marketing') {
      payload = buildMarketingPayload(chatId, rawText);
      if (!payload) {
        await sendUserMessage(chatId, 'Send a topic or type /content <topic> to generate marketing content.');
        return;
      }
    } else if (route.kind === 'portfolio') {
      payload = buildPortfolioPayload(chatId, TOKEN);
    } else if (route.kind === 'resume') {
      if (route.uploadedResume) {
        payload = await buildUploadedResumePayload(chatId, TOKEN, msg);
        if (!payload) {
          await sendUserMessage(chatId, 'Sorry, I could not read that file. Please send a PDF resume.');
          return;
        }
      } else {
        payload = buildResumePayload(chatId, TOKEN, parseScanTarget(rawText));
      }
    }
  } else {
    payload = {
      ...update,
      telegram_bot_token: TOKEN,
      message: msg.text != null
        ? { ...msg, text: route.text }
        : msg,
    };
    if (route.kind === 'booking') {
      payload.booking_sessions = loadBookingSessions();
      payload.booking_appointments = loadBookingAppointments();
    }
  }

  const timeoutMs = route.kind === 'portfolio'
    ? PORTFOLIO_TIMEOUT_MS
    : route.kind === 'resume'
      ? RESUME_TIMEOUT_MS
      : WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  };

  let res;
  let lastErr;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      res = await fetch(route.webhook, fetchOptions);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') break;
      if (attempt < maxAttempts) {
        console.error(`Webhook attempt ${attempt}/${maxAttempts} failed: ${err.message || err}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  clearTimeout(timer);

  if (lastErr) {
    const timedOut = lastErr.name === 'AbortError';
    let userMsg = 'Sorry, the bot could not reach the workflow. Please try again in a moment.';
    if (timedOut) {
      if (route.kind === 'portfolio') {
        userMsg = 'Sorry, the portfolio report took too long. Try /report again in a moment.';
      } else if (route.kind === 'resume') {
        userMsg = 'Sorry, resume analysis took too long. Try /scan again in a moment.';
      } else if (route.kind === 'marketing') {
        userMsg = 'Sorry, content generation took too long. Try a shorter topic or /content <topic>.';
      } else {
        userMsg = 'Sorry, the research took too long. Please try a more specific question (e.g. "Tesla Model 3 reviews" instead of "Car").';
      }
    }
    await sendUserMessage(chatId, userMsg);
    console.error(`Webhook error: ${lastErr.message || lastErr}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    const lower = body.toLowerCase();
    let userMsg = 'Sorry, your question could not be processed right now. Please try again.';
    if (route.kind === 'resume') {
      userMsg = 'Sorry, resume analysis failed. Ensure PDFs are in /files/resumes and OPENAI_API_KEY is set, then try /scan again.';
    } else if (lower.includes('could not identify the product from your photo') || lower.includes('resend the image with a caption')) {
      userMsg = '📷 I could not identify the product from your photo. Please resend with a caption naming the product (e.g. "realme P4 Power reviews").';
    } else if (lower.includes('402') || lower.includes('credit')) {
      userMsg = 'Sorry — the AI service returned a billing error. Check your OPENAI_API_KEY billing at platform.openai.com then try again.';
    } else if (lower.includes('401') || lower.includes('api key')) {
      userMsg = 'Sorry — the AI API key is missing or invalid. Check OPENAI_API_KEY in .env.';
    }
    await sendUserMessage(chatId, userMsg);
    console.error(`Webhook failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    return;
  }

  let body = {};
  try {
    body = await res.json();
  } catch (e) {
    console.error('Webhook returned non-JSON response');
    return;
  }

  if (route.kind === 'rag') {
    const sent = body.notifications?.telegram_sent === true || body.telegram_sent === true;
    const answer = String(body.answer || body.telegram_text || '').trim();
    if (sent) {
      console.log(`✓ RAG answer sent by workflow to ${chatId}`);
    } else if (answer) {
      await sendUserMessage(chatId, answer.slice(0, 4000));
      console.log(`✓ Delivered RAG answer to ${chatId} (poller fallback)`);
    } else if (body.skipped && body.telegram_reply) {
      console.log(`✓ RAG help message handled by workflow for ${chatId}`);
    } else {
      await sendUserMessage(chatId, 'Sorry, I could not find an answer. Try rephrasing or use /review for product reviews.');
      console.log(`✓ Sent RAG fallback to ${chatId}`);
    }
    return;
  }

  if (route.kind === 'review') {
    const sent = body.notifications?.telegram_sent === true || body.telegram_sent === true;
    const fallbackText = String(body.telegram_text || '').trim();
    if (sent) {
      console.log(`✓ Report sent by workflow to ${chatId}`);
    } else if (fallbackText) {
      await sendUserMessage(chatId, fallbackText.slice(0, 4000));
      console.log(`✓ Delivered response to ${chatId} (poller fallback)`);
    } else if (body.skipped && body.telegram_reply) {
      console.log(`✓ Help message handled by workflow for ${chatId}`);
    } else {
      const errHint = String(body.notifications?.telegram_error || body.telegram_error || '').trim();
      const userMsg = errHint
        ? `Sorry, the report could not be delivered (${errHint.slice(0, 120)}). Please try again or add a caption naming the product.`
        : '📷 I could not finish your photo review. Resend with a caption naming the product (e.g. "Mercedes A-Class reviews") — that works reliably.';
      await sendUserMessage(chatId, userMsg);
      console.log(`✓ Sent fallback help to ${chatId} (workflow returned no Telegram text)`);
    }
    return;
  }

  if (route.kind === 'booking') {
    const sent = body.notifications?.telegram_sent === true || body.telegram_sent === true;
    const fallbackText = String(body.telegram_text || '').trim();
    if (sent) {
      console.log(`✓ Booking message sent by workflow to ${chatId}`);
    } else if (fallbackText) {
      await sendUserMessage(chatId, fallbackText.slice(0, 4000));
      console.log(`✓ Delivered booking response to ${chatId} (poller fallback)`);
    } else if (body.skipped) {
      console.log(`✓ Booking workflow skipped for ${chatId} (${body.skip_reason || 'unknown'})`);
    } else {
      const errHint = String(body.notifications?.telegram_error || body.telegram_error || '').trim();
      const userMsg = errHint
        ? `Sorry, booking could not be completed (${errHint.slice(0, 120)}). Type /book to try again.`
        : 'Sorry, I could not process your booking request. Type /book to start over.';
      await sendUserMessage(chatId, userMsg);
      console.log(`✓ Sent booking fallback to ${chatId}`);
    }
    return;
  }

  if (route.kind === 'marketing') {
    const item = unwrapN8nBody(body);
    if (item.content || item.topic || item.campaign_name) {
      await sendUserMessage(chatId, formatMarketingTelegram(item));
      console.log(`✓ Delivered marketing summary to ${chatId}`);
    } else {
      await sendUserMessage(chatId, '✅ Marketing content generated! Check your email for the full report.');
      console.log(`✓ Sent marketing completion notice to ${chatId}`);
    }
    return;
  }

  if (route.kind === 'portfolio') {
    const item = unwrapN8nBody(body);
    if (portfolioWorkflowOwnsTelegram(payload, body, item)) {
      console.log(`✓ Portfolio report sent by workflow to ${chatId}`);
      return;
    }
    if (portfolioWorkflowFailed(body)) {
      await sendUserMessage(chatId, 'Sorry, the portfolio report could not be completed. Try /report again.');
      console.log(`✓ Portfolio workflow failed for ${chatId}`);
      return;
    }
    const text = String(
      body.telegram_text
      || item.telegram_text
      || item.slack_text
      || item.report_text
      || ''
    ).trim();
    if (text) {
      await sendUserMessage(chatId, text.slice(0, 4000));
      console.log(`✓ Delivered portfolio report to ${chatId} (poller fallback)`);
    } else if (item.holdings?.length) {
      await sendUserMessage(chatId, formatPortfolioTelegram(item));
      console.log(`✓ Delivered portfolio summary to ${chatId}`);
    } else {
      await sendUserMessage(chatId, '✅ Portfolio report generated. If you did not receive it, try /report again.');
      console.log(`✓ Sent portfolio fallback to ${chatId}`);
    }
    return;
  }

  if (route.kind === 'resume') {
    const item = unwrapN8nBody(body);
    if (portfolioWorkflowOwnsTelegram(payload, body, item)) {
      console.log(`✓ Resume report sent by workflow to ${chatId}`);
      return;
    }
    if (portfolioWorkflowFailed(body)) {
      await sendUserMessage(chatId, 'Sorry, resume analysis could not be completed. Try /scan again.');
      console.log(`✓ Resume workflow failed for ${chatId}`);
      return;
    }
    await sendUserMessage(chatId, formatResumeTelegram(item));
    console.log(`✓ Delivered resume summary to ${chatId}`);
  }
}

async function initOffset() {
  if (fs.existsSync(OFFSET_FILE)) return readOffset();
  const data = await telegramApi('getUpdates', { timeout: 0 });
  const updates = data.result || [];
  const offset = updates.length ? updates[updates.length - 1].update_id + 1 : 0;
  writeOffset(offset);
  if (updates.length) {
    console.log(`Skipped ${updates.length} queued message(s). Send a new question to get an answer.`);
  }
  return offset;
}

async function pollForever() {
  let offset = await initOffset();
  const target = WEBHOOK_LEGACY
    || `booking=${WEBHOOK_BOOKING} | review=${WEBHOOK_REVIEW} | marketing=${WEBHOOK_MARKETING} | portfolio=${WEBHOOK_PORTFOLIO} | resume=${WEBHOOK_RESUME} | rag=${WEBHOOK_RAG}`;
  console.log(`Polling Telegram → ${target} (offset=${offset})`);

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
        console.error('Another process is polling this bot token. Stop duplicate pollers (only one telegram-bot container).');
      }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

(async () => {
  await ensurePollingMode();
  await pollForever();
})();
