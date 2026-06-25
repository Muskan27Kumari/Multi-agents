#!/usr/bin/env node
/**
 * Single-workflow Telegram poller for dedicated bots.
 * Does not replace scripts/telegram-poller.js — the shared multi-router bot is unchanged.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN       — this bot's token (set per container)
 *   N8N_TELEGRAM_WEBHOOK     — single n8n webhook URL (optional; defaults per kind)
 *   TELEGRAM_POLLER_KIND     — rag | review | booking | marketing | portfolio | resume
 *   TELEGRAM_OFFSET_FILE     — unique offset file per bot instance
 *   TELEGRAM_CHAT_ID         — optional allowlist (empty = public)
 *   TELEGRAM_WELCOME_TEXT    — optional custom /start text
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
  stripReviewCommand,
  isBareReviewCommand,
  reviewPromptText,
  buildResumePayload,
  buildUploadedResumePayload,
  isResumeDocument,
  isResumeScanIntent,
  parseScanTarget,
  resumeScanHelpText,
  listResumeFilePaths,
  portfolioWorkflowOwnsTelegram,
  portfolioWorkflowFailed,
} = require('./lib/telegram-aux-routes');
const { isDriveUrl } = require('./lib/google-drive');

loadEnv(path.join(__dirname, '..'));

const INTERNAL_N8N = internalN8nUrl();
const TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const KIND = String(process.env.TELEGRAM_POLLER_KIND || '').trim().toLowerCase();
const WEBHOOK = String(process.env.N8N_TELEGRAM_WEBHOOK || '').trim();
const CHAT_ALLOWLIST = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const DATA_DIR = process.env.TELEGRAM_DATA_DIR
  || (fs.existsSync('/data/telegram-poller-offset.json') || fs.existsSync('/data/appointments')
    ? '/data'
    : path.join(__dirname, '..', 'files'));
const SESSIONS_FILE = process.env.APPOINTMENT_SESSIONS_FILE
  || path.join(DATA_DIR, 'appointments', 'sessions.json');
const BOOKINGS_FILE = process.env.APPOINTMENT_BOOKINGS_FILE
  || path.join(DATA_DIR, 'appointments', 'bookings.json');
const POLL_TIMEOUT = Number(process.env.TELEGRAM_POLL_TIMEOUT || 30);
const WEBHOOK_TIMEOUT_MS = KIND === 'resume'
  ? Number(process.env.TELEGRAM_RESUME_TIMEOUT_MS || process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 600000)
  : Number(process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 300000);
const OFFSET_FILE = process.env.TELEGRAM_OFFSET_FILE
  || path.join(DATA_DIR, `telegram-poller-offset-${KIND || 'dedicated'}.json`);

const VALID_KINDS = ['rag', 'review', 'booking', 'marketing', 'portfolio', 'resume', 'hr'];
const JSON_PAYLOAD_KINDS = new Set(['marketing', 'portfolio', 'resume', 'hr']);

const DEFAULT_WEBHOOKS = {
  rag: `${INTERNAL_N8N}/webhook/rag-knowledge-agent-telegram`,
  review: `${INTERNAL_N8N}/webhook/customer-review-responder-telegram`,
  booking: `${INTERNAL_N8N}/webhook/appointment-booking-agent-telegram`,
  marketing: `${INTERNAL_N8N}/webhook/marketing-content`,
  portfolio: `${INTERNAL_N8N}/webhook/portfolio-market-report`,
  resume: `${INTERNAL_N8N}/webhook/resume-analysis-agent`,
  hr: `${INTERNAL_N8N}/webhook/hr-recruitment`,
};

const DEFAULT_PORTFOLIO_HOLDINGS = [
  { symbol: 'AAPL', shares: 10, avg_cost: 175.5 },
  { symbol: 'MSFT', shares: 5, avg_cost: 380.0 },
  { symbol: 'NVDA', shares: 3, avg_cost: 450.0 },
];

const DEFAULT_RESUME_JOB_TITLES = [
  {
    title: 'Software Engineer',
    required_skills: ['Python', 'JavaScript', 'API Integration', 'PostgreSQL'],
    preferred_skills: ['Docker', 'AWS'],
    min_experience_years: 3,
    job_description: 'Build backend services and integrations.',
  },
];

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}
const DRIVE_RAG_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN_DRIVE_RAG || '').trim();
if (DRIVE_RAG_TOKEN && TOKEN === DRIVE_RAG_TOKEN) {
  console.error(
    'TELEGRAM_BOT_TOKEN matches TELEGRAM_BOT_TOKEN_DRIVE_RAG. '
    + 'Only scripts/drive-rag-bot.js may poll this token.'
  );
  process.exit(1);
}
if (!VALID_KINDS.includes(KIND)) {
  console.error(`TELEGRAM_POLLER_KIND must be one of: ${VALID_KINDS.join(', ')}`);
  process.exit(1);
}

function usesJsonPayload() {
  return JSON_PAYLOAD_KINDS.has(KIND);
}

function envOr(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

const TARGET_WEBHOOK = WEBHOOK || DEFAULT_WEBHOOKS[KIND];

function ragWelcomeText() {
  const custom = String(process.env.TELEGRAM_RAG_WELCOME || process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  return [
    'Welcome to VGI Knowledge Assistant',
    '',
    'Send any question and I will search your knowledge base and reply with an answer grounded in your materials.',
    '',
    'Examples:',
    '• What is RAG?',
    '• What are the key points in this PDF?',
    '• Explain this concept in simple terms.',
    '',
    'Use /ask <question> or type your question directly.',
  ].join('\n');
}

function reviewWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  return [
    'Product Review Bot',
    '',
    'Type /review then send a product name, link, or photo.',
    '',
    'Examples:',
    '• iPhone 15 reviews',
    '• https://amazon.com/...',
    '',
    'Type /help anytime for this guide.',
  ].join('\n');
}

function bookingWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  const brand = String(process.env.BRAND_NAME || 'our clinic').trim();
  return [
    `Appointment Booking — ${brand}`,
    '',
    'Type /book to schedule an appointment, ticket, or service.',
    'Type /cancel to reset your current session.',
    '',
    'Type /help anytime for this guide.',
  ].join('\n');
}

function marketingWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  const brand = String(process.env.BRAND_NAME || 'Your Brand').trim();
  return [
    `Marketing Content — ${brand}`,
    '',
    'Send a topic or type /content <topic> to generate blog, LinkedIn, Twitter, and email drafts.',
    '',
    'Examples:',
    '• /content How AI agents automate marketing',
    '• Product launch ideas for B2B SaaS',
    '',
    'Generation usually takes 1–2 minutes.',
  ].join('\n');
}

function portfolioWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  return [
    'Portfolio Market Report',
    '',
    'Type /report to analyze the default sample portfolio (AAPL, MSFT, NVDA).',
    '',
    'You will receive BUY/HOLD/SELL signals with market data and AI analysis.',
    'This usually takes 2–5 minutes depending on holdings count.',
  ].join('\n');
}

function hrWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  return [
    'HR Recruitment Agent',
    '',
    'Commands:',
    '• /create_job <title> — create a job opening (dry run)',
    '',
    'Example: /create_job Senior Software Engineer',
    '',
    'Anyone can use this bot — pipeline updates are sent to your chat.',
  ].join('\n');
}

function hrHelpText() {
  return hrWelcomeText();
}

function resumeWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');
  return [
    'Resume Analysis Agent',
    '',
    'Send a PDF resume directly, or type /scan <filename> to analyze one resume from the shared folder.',
    '',
    'Examples:',
    '• /scan Kumail Rizvi.pdf',
    '• /scan Muskan Kumari',
    '',
    'Candidates are scored against default job titles and you receive a report here.',
    'Analysis usually takes 30–90 seconds per resume.',
  ].join('\n');
}

function welcomeText() {
  if (KIND === 'rag') return ragWelcomeText();
  if (KIND === 'review') return reviewWelcomeText();
  if (KIND === 'booking') return bookingWelcomeText();
  if (KIND === 'marketing') return marketingWelcomeText();
  if (KIND === 'portfolio') return portfolioWelcomeText();
  if (KIND === 'resume') return resumeWelcomeText();
  if (KIND === 'hr') return hrWelcomeText();
  return bookingWelcomeText();
}

function unwrapN8nBody(body) {
  if (Array.isArray(body) && body[0]?.json) return body[0].json;
  if (body?.data && Array.isArray(body.data) && body.data[0]?.json) return body.data[0].json;
  return body && typeof body === 'object' ? body : {};
}

function formatMarketingTelegram(item) {
  const c = item.content || {};
  const lines = [
    '✅ Marketing content generated!',
    '',
    `📋 Topic: ${item.topic || item.campaign_name || 'Campaign'}`,
  ];
  if (c.blog?.title) {
    lines.push('', `📝 Blog: ${c.blog.title}`);
    if (c.blog.meta_description) lines.push(`   ${c.blog.meta_description.slice(0, 200)}`);
  }
  if (c.linkedin?.post) {
    lines.push('', '📱 LinkedIn:', c.linkedin.post.slice(0, 600));
    const tags = (c.linkedin.hashtags || []).join(' ');
    if (tags) lines.push(tags);
  }
  if (c.twitter?.thread?.length) {
    lines.push('', '🐦 Twitter thread:');
    for (const t of c.twitter.thread.slice(0, 4)) {
      lines.push(`${t.tweet}. ${t.text}`);
    }
  }
  if (c.email?.subject_lines?.length) {
    lines.push('', `✉️ Email subjects: ${c.email.subject_lines.slice(0, 3).join(' | ')}`);
  }
  if (item.analysis_mode === 'template_fallback' || item.model === 'template_fallback') {
    lines.push('', 'ℹ️ Template draft (OpenRouter credits unavailable). Add credits at openrouter.ai/settings/credits for AI-polished copy.');
  }
  lines.push('', 'Full export saved to marketing-content-latest.xlsx when Excel branch runs.');
  return lines.join('\n').slice(0, 4000);
}

function formatResumeTelegram(item) {
  if (item.success === false) {
    return `❌ Resume scan failed: ${String(item.error || item.message || 'unknown error').slice(0, 500)}`;
  }
  const batch = item.batch_summary || {};
  const total = item.total_processed || batch.total_processed || 1;
  const lines = [
    `✅ Resume analysis complete — ${total} candidate(s) processed.`,
  ];
  const categories = item.categories || batch.categories || [];
  if (categories.length) lines.push(`Categories: ${categories.join(', ')}`);
  const candidates = item.candidates
    || (batch.categorized_candidates ? Object.values(batch.categorized_candidates).flat() : []);
  for (const c of (candidates || []).slice(0, 8)) {
    const name = c.candidate_name || c.name || 'Candidate';
    const score = c.match_score ?? c.job_match?.weighted_match_score;
    const rec = c.recommendation || c.recommendation?.label;
    lines.push(`• ${name}${score != null ? ` — ${score}%` : ''}${rec ? ` (${rec})` : ''}`);
  }
  if ((candidates || []).length > 8) lines.push(`…and ${candidates.length - 8} more.`);
  return lines.join('\n').slice(0, 4000);
}

function isPortfolioIntent(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const cmd = raw.split(/\s+/)[0].replace(/@\w+$/, '');
  return ['/report', '/portfolio'].includes(cmd) || raw === 'portfolio report';
}

function buildJsonPayload(chatId, rawText) {
  if (KIND === 'marketing') {
    const topic = rawText.replace(/^\/content\s*/i, '').trim();
    if (!topic || /^\/(start|help)$/i.test(topic)) return null;
    return {
      topic,
      campaign_name: `Telegram — ${topic.slice(0, 48)}`,
      brand_name: envOr('BRAND_NAME', 'VGI Skill Universe'),
      brand_website: envOr('BRAND_WEBSITE', 'https://n8n.io'),
      audience: envOr('TARGET_AUDIENCE', 'business professionals'),
      tone: 'professional',
      platforms: ['blog', 'linkedin', 'twitter', 'email'],
      keywords: [],
      call_to_action: 'Learn more',
      goal: 'engage audience',
      context: `Requested via Telegram by chat ${chatId}`,
      recipient_email: envOr('EMAIL_TO', envOr('EMAIL_FROM', 'information@variphi.com')),
      sender_email: envOr('EMAIL_FROM', 'information@variphi.com'),
      openrouter_api_key: envOr('OPENROUTER_API_KEY'),
      openrouter_model: envOr('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
      notify_email: false,
    };
  }

  if (KIND === 'portfolio') {
    if (!isPortfolioIntent(rawText)) return null;
    return {
      portfolio_name: envOr('PORTFOLIO_NAME', 'My Portfolio'),
      holdings: DEFAULT_PORTFOLIO_HOLDINGS,
      batch_size: 2,
      finnhub_api_key: envOr('FINNHUB_API_KEY', 'd8c7ir1r01qidic6mr70d8c7ir1r01qidic6mr7g'),
      alpha_vantage_api_key: envOr('ALPHA_VANTAGE_API_KEY', 'F5824HO58NAWKIYA'),
      marketaux_api_key: envOr('MARKETAUX_API_KEY', 'mARnGFoyhtjngy6ZOC3Tx5TFDJDxSq5NMGe4tJ3q'),
      openrouter_api_key: envOr('OPENROUTER_API_KEY'),
      openrouter_model: envOr('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
      recipient_email: envOr('EMAIL_TO', envOr('EMAIL_FROM', 'information@variphi.com')),
      sender_email: envOr('EMAIL_FROM', 'information@variphi.com'),
      notify_email: false,
      notify_slack: false,
      notify_telegram: true,
      telegram_bot_token: TOKEN,
      telegram_chat_id: chatId,
    };
  }

  if (KIND === 'resume') {
    if (!isResumeScanIntent(rawText)) return null;
    const scanTarget = parseScanTarget(rawText);
    if (!scanTarget) return null;
    return buildResumePayload(chatId, TOKEN, scanTarget);
  }

  if (KIND === 'hr') {
    const raw = String(rawText || '').trim();
    const common = {
      dry_run: true,
      notify_telegram: true,
      telegram_bot_token: TOKEN,
      telegram_chat_id: chatId,
      openrouter_api_key: envOr('OPENROUTER_API_KEY'),
      openrouter_model: envOr('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
      hr_email: envOr('EMAIL_TO', envOr('EMAIL_FROM', 'information@variphi.com')),
      sender_email: envOr('EMAIL_FROM', 'information@variphi.com'),
    };
    if (/^\/create_job\b/i.test(raw)) {
      const jobTitle = raw.replace(/^\/create_job(?:@\w+)?\s*/i, '').trim();
      if (!jobTitle) return null;
      return {
        ...common,
        stage: 'create_job',
        job_title: jobTitle,
        department: 'General',
        location: 'Remote',
        employment_type: 'full_time',
        required_skills: ['Communication'],
        min_experience_years: 2,
        headcount: 1,
      };
    }
    return null;
  }

  return null;
}

function jsonPayloadHelpText() {
  if (KIND === 'marketing') {
    return 'Send a topic or type /content <topic> to generate marketing content.';
  }
  if (KIND === 'portfolio') {
    return 'Type /report to run a portfolio market analysis on the sample holdings.';
  }
  if (KIND === 'resume') {
    return resumeScanHelpText();
  }
  if (KIND === 'hr') {
    return hrHelpText();
  }
  return 'Send a valid command to continue.';
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

function messageHasImage(msg) {
  if (!msg) return false;
  if (Array.isArray(msg.photo) && msg.photo.length) return true;
  if (msg.document && /^image\//i.test(String(msg.document.mime_type || ''))) return true;
  return false;
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

function prepareMessageText(rawText) {
  const raw = String(rawText || '').trim();
  if (KIND === 'rag') {
    return raw.replace(/^\/\w+\s*/, '').trim() || raw;
  }
  if (KIND === 'review') {
    return stripReviewCommand(raw);
  }
  if (KIND === 'marketing') {
    return raw.replace(/^\/content\s*/i, '').trim() || raw;
  }
  return raw;
}

async function sendStatusMessage(chatId, rawText, hasImage, uploadedResume = false) {
  if (KIND === 'rag') {
    const driveTok = String(process.env.TELEGRAM_BOT_TOKEN_DRIVE_RAG || '').trim();
    const searching = driveTok && TOKEN === driveTok
      ? '🔍 Searching your Drive documents…'
      : '🔍 Searching knowledge base…';
    await sendUserMessage(chatId, searching);
    return;
  }
  if (KIND === 'review') {
    if (hasImage) {
      await sendUserMessage(
        chatId,
        '🔍 Analyzing your product photo and researching reviews. This usually takes 30–90 seconds…'
      );
      return;
    }
    const isUrl = /https?:\/\//i.test(rawText);
    await sendUserMessage(
      chatId,
      isUrl
        ? '🔗 Fetching product details from your link, then researching customer reviews…'
        : '🔍 Researching reviews and opinions. This usually takes 30–90 seconds…'
    );
    return;
  }
  if (KIND === 'booking' && isBookingIntent(rawText)) {
    await sendUserMessage(chatId, '📅 Starting appointment booking…');
    return;
  }
  if (KIND === 'marketing') {
    await sendUserMessage(chatId, '✍️ Generating marketing content… This usually takes 1–2 minutes.');
    return;
  }
  if (KIND === 'portfolio') {
    await sendUserMessage(
      chatId,
      '📊 Running portfolio analysis (quotes, fundamentals, news, AI signals)… This may take 2–5 minutes.'
    );
    return;
  }
  if (KIND === 'resume') {
    await sendUserMessage(
      chatId,
      uploadedResume
        ? '📄 Analyzing your uploaded resume (ATS + AI)… This usually takes 30–90 seconds.'
        : '📄 Analyzing resume (ATS + AI)… This usually takes 30–90 seconds.'
    );
  }
  if (KIND === 'hr') {
    await sendUserMessage(chatId, '🧑‍💼 Running HR recruitment stage… This usually takes 30–90 seconds.');
  }
}

async function handleResponse(chatId, body, payload = null) {
  const item = unwrapN8nBody(body);
  const sent = body.notifications?.telegram_sent === true
    || body.notifications?.telegram === true
    || body.telegram_sent === true
    || item.telegram_sent === true;
  const fallbackText = String(body.telegram_text || body.answer || item.telegram_text || '').trim();

  if (KIND === 'rag') {
    if (sent) {
      console.log(`✓ RAG answer sent by workflow to ${chatId}`);
    } else if (fallbackText) {
      await sendUserMessage(chatId, fallbackText.slice(0, 4000));
      console.log(`✓ Delivered RAG answer to ${chatId} (poller fallback)`);
    } else if (body.skipped && body.telegram_reply) {
      console.log(`✓ RAG help message handled by workflow for ${chatId}`);
    } else {
      await sendUserMessage(chatId, 'Sorry, I could not find an answer. Try rephrasing your question.');
      console.log(`✓ Sent RAG fallback to ${chatId}`);
    }
    return;
  }

  if (KIND === 'review') {
    if (sent) {
      console.log(`✓ Report sent by workflow to ${chatId}`);
    } else if (fallbackText) {
      await sendUserMessage(chatId, fallbackText.slice(0, 4000));
      console.log(`✓ Delivered review response to ${chatId} (poller fallback)`);
    } else if (body.skipped && body.telegram_reply) {
      console.log(`✓ Help message handled by workflow for ${chatId}`);
    } else {
      const errHint = String(body.notifications?.telegram_error || body.telegram_error || '').trim();
      const userMsg = errHint
        ? `Sorry, the report could not be delivered (${errHint.slice(0, 120)}). Please try again.`
        : 'Sorry, I could not finish your review request. Try again with a product name or caption.';
      await sendUserMessage(chatId, userMsg);
      console.log(`✓ Sent review fallback to ${chatId}`);
    }
    return;
  }

  if (KIND === 'booking') {
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

  if (KIND === 'marketing') {
    const item = unwrapN8nBody(body);
    if (item.content || item.topic || item.campaign_name) {
      await sendUserMessage(chatId, formatMarketingTelegram(item));
      console.log(`✓ Delivered marketing summary to ${chatId}`);
    } else {
      await sendUserMessage(
        chatId,
        '✅ Marketing content generated! Check your email for the full report and Excel export.'
      );
      console.log(`✓ Sent marketing completion notice to ${chatId}`);
    }
    return;
  }

  if (KIND === 'portfolio') {
    const failed = body.success === false || String(body.message || '').trim() === 'Error in workflow';
    if (failed) {
      await sendUserMessage(chatId, 'Sorry, the portfolio report could not be completed. Try /report again.');
      console.log(`✓ Portfolio workflow failed for ${chatId}`);
      return;
    }
    console.log(`✓ Portfolio report sent by workflow to ${chatId}`);
    return;
  }

  if (KIND === 'hr') {
    const item = unwrapN8nBody(body);
    if (item.telegram_sent || body.telegram_sent || item.telegram_delivery?.status === 'sent') {
      console.log(`✓ HR update sent by workflow to ${chatId}`);
      return;
    }
    const text = String(item.telegram_text || body.telegram_text || '').trim();
    if (text) {
      await sendUserMessage(chatId, text.slice(0, 4000));
      console.log(`✓ Delivered HR summary to ${chatId} (poller fallback)`);
    } else if (item.success) {
      const summary = [
        `✅ HR stage complete: ${item.stage || 'update'}`,
        item.job_id ? `Job: ${item.job_id}` : '',
        item.candidate_id ? `Candidate: ${item.candidate_id}` : '',
        item.pipeline_decision ? `Decision: ${item.pipeline_decision}` : '',
      ].filter(Boolean).join('\n');
      await sendUserMessage(chatId, summary.slice(0, 4000));
      console.log(`✓ Delivered HR fallback to ${chatId}`);
    } else {
      await sendUserMessage(chatId, 'Sorry, the HR request could not be completed. Try /create_job <title>.');
      console.log(`✓ Sent HR error to ${chatId}`);
    }
    return;
  }

  if (KIND === 'resume') {
    const item = unwrapN8nBody(body);
    if (portfolioWorkflowOwnsTelegram(payload, body, item)) {
      console.log(`✓ Resume report sent by workflow to ${chatId}`);
      return;
    }
    if (portfolioWorkflowFailed(body)) {
      await sendUserMessage(chatId, 'Sorry, resume analysis failed. Check OPENAI_API_KEY and PDFs in /files/resumes, then try /scan again.');
      console.log(`✓ Resume workflow failed for ${chatId}`);
      return;
    }
    const text = String(fallbackText || item.report_text || '').trim();
    if (text) {
      await sendUserMessage(chatId, text.slice(0, 4000));
      console.log(`✓ Delivered resume report to ${chatId} (poller fallback)`);
    } else if (item.success !== false) {
      await sendUserMessage(chatId, formatResumeTelegram(item));
      console.log(`✓ Delivered resume summary to ${chatId}`);
    } else {
      await sendUserMessage(chatId, formatResumeTelegram(item));
      console.log(`✓ Sent resume error to ${chatId}`);
    }
  }
}

async function forwardUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = String(msg.chat?.id || '');
  const rawText = String(msg.text || msg.caption || '').trim();
  const hasImage = messageHasImage(msg);
  const hasResumeDoc = KIND === 'resume' && isResumeDocument(msg);
  const hasDocument = Boolean(msg.document);
  if (!rawText && !hasImage && !hasResumeDoc) {
    if (hasDocument && KIND === 'hr') {
      await sendUserMessage(
        chatId,
        'This bot handles HR recruitment only.\n\n• /create_job <title> — create a job opening\n\nFor resume ATS analysis, use the Resume Analyzer bot or send your PDF to @vgiskilluniversebot with /scan.'
      );
      console.log(`✓ Sent HR document hint to ${chatId}`);
    } else if (hasDocument && KIND !== 'resume') {
      await sendUserMessage(chatId, jsonPayloadHelpText());
      console.log(`✓ Sent ${KIND} help for document upload to ${chatId}`);
    }
    return;
  }

  if (CHAT_ALLOWLIST && chatId !== CHAT_ALLOWLIST) {
    console.log(`Skipping chat ${chatId} (not in TELEGRAM_CHAT_ID allowlist)`);
    await sendUserMessage(chatId, 'This bot is currently restricted. Please contact the administrator.');
    return;
  }

  const lowerText = rawText.toLowerCase();
  if (lowerText.startsWith('/start') || lowerText === '/help') {
    await sendUserMessage(chatId, welcomeText());
    console.log(`✓ Sent welcome to ${chatId}`);
    return;
  }

  if (isDriveUrl(rawText) || /^\/drive\b/i.test(rawText)) {
    if (KIND === 'rag') {
      console.log(`✓ Skipped drive URL for rag poller ${chatId} (use Drive Q&A bot)`);
      return;
    }
  }

  if (usesJsonPayload() && hasImage && KIND !== 'resume') {
    await sendUserMessage(chatId, jsonPayloadHelpText());
    return;
  }

  if (KIND === 'review' && isBareReviewCommand(rawText)) {
    await sendUserMessage(chatId, reviewPromptText());
    console.log(`✓ Sent review prompt to ${chatId}`);
    return;
  }

  const routeText = prepareMessageText(rawText);
  const uploadedResume = hasResumeDoc;
  const preview = uploadedResume && !rawText
    ? `[resume:${String(msg.document?.file_name || 'document').slice(0, 40)}]`
    : hasImage && !rawText
      ? '[photo]'
      : String(routeText || rawText).replace(/\s+/g, ' ').slice(0, 80);
  console.log(`→ [${KIND}] ${chatId}: ${preview}`);

  let payload;
  if (usesJsonPayload()) {
    let jsonPayload;
    if (KIND === 'resume' && uploadedResume) {
      jsonPayload = await buildUploadedResumePayload(chatId, TOKEN, msg);
      if (!jsonPayload) {
        await sendUserMessage(chatId, 'Sorry, I could not read that file. Please send a PDF resume.');
        return;
      }
    } else {
      if (KIND === 'resume' && isResumeScanIntent(rawText) && !parseScanTarget(rawText)) {
        await sendUserMessage(chatId, resumeScanHelpText());
        console.log(`✓ Sent resume scan help to ${chatId}`);
        return;
      }
      try {
        jsonPayload = buildJsonPayload(chatId, rawText);
      } catch (err) {
        await sendUserMessage(chatId, String(err.message || 'Resume not found.').slice(0, 500));
        console.log(`✓ Resume scan target error for ${chatId}: ${err.message || err}`);
        return;
      }
      if (!jsonPayload) {
        await sendUserMessage(chatId, jsonPayloadHelpText());
        console.log(`✓ Sent ${KIND} help to ${chatId}`);
        return;
      }
      if (KIND === 'resume' && !listResumeFilePaths().length) {
        await sendUserMessage(
          chatId,
          'No resume PDFs found. Send a PDF directly, or add files to files/resumes/ and use /scan <filename>.'
        );
        return;
      }
    }
    await sendStatusMessage(chatId, rawText, hasImage, uploadedResume);
    payload = jsonPayload;
  } else {
    if (KIND === 'review' && !routeText && !hasImage) {
      await sendUserMessage(chatId, reviewPromptText());
      console.log(`✓ Sent review prompt to ${chatId} (empty input)`);
      return;
    }
    await sendStatusMessage(chatId, rawText, hasImage);
    payload = {
      ...update,
      telegram_bot_token: TOKEN,
      message: msg.text != null ? { ...msg, text: routeText } : msg,
    };
    if (KIND === 'booking') {
      payload.booking_sessions = loadBookingSessions();
      payload.booking_appointments = loadBookingAppointments();
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
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
      res = await fetch(TARGET_WEBHOOK, fetchOptions);
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
    const userMsg = timedOut
      ? 'Sorry, the request took too long. Please try again with a more specific message.'
      : 'Sorry, the bot could not reach the workflow. Please try again in a moment.';
    await sendUserMessage(chatId, userMsg);
    console.error(`Webhook error: ${lastErr.message || lastErr}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    await sendUserMessage(chatId, 'Sorry, your request could not be processed right now. Please try again.');
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

  await handleResponse(chatId, body, payload);
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
  console.log(`Dedicated Telegram poller [${KIND}] → ${TARGET_WEBHOOK} (offset=${offset})`);

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
  await pollForever();
})();
