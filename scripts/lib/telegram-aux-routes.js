'use strict';

const fs = require('fs');
const path = require('path');

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

function envOr(key, fallback = '') {
  return String(process.env[key] || fallback).trim();
}

function unwrapN8nBody(body) {
  if (Array.isArray(body) && body[0]?.json) return body[0].json;
  if (body?.data && Array.isArray(body.data) && body.data[0]?.json) return body.data[0].json;
  return body && typeof body === 'object' ? body : {};
}

function stripReviewCommand(text) {
  return String(text || '').replace(/^\/reviews?(?:@\w+)?\s*/i, '').trim();
}

function isBareReviewCommand(text) {
  const raw = String(text || '').trim();
  if (!/^\/reviews?(?:@\w+)?(\s|$)/i.test(raw)) return false;
  return stripReviewCommand(raw) === '';
}

function reviewPromptText() {
  return [
    '📦 Customer review research',
    '',
    'Send me any product using one of these:',
    '',
    '📝 Product name',
    '• iPhone 15 Pro reviews',
    '• Maruti Suzuki Dzire customer feedback',
    '',
    '🔗 Product link',
    '• Amazon, Flipkart, or any store URL',
    '',
    '📷 Product photo',
    '• Send an image (add a caption with the product name for best results)',
    '',
    'Type /cancel to exit review mode.',
  ].join('\n');
}

function isMarketingIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/^\/content\b/i.test(raw)) return true;
  if (/^(generate|create|write)\s+(marketing|blog|linkedin|email|social)/i.test(raw)) return true;
  if (/\b(marketing\s+content|content\s+for|blog\s+post|linkedin\s+post|email\s+campaign|twitter\s+thread|social\s+media\s+post)\b/i.test(raw)) {
    return true;
  }
  return false;
}

function isPortfolioIntent(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const cmd = raw.split(/\s+/)[0].replace(/@\w+$/, '');
  if (['/report', '/portfolio'].includes(cmd)) return true;
  if (/\b(portfolio\s+report|portfolio\s+analysis|market\s+report|stock\s+report|analyze\s+(my\s+)?portfolio|run\s+portfolio|buy\s+hold\s+sell)\b/i.test(raw)) {
    return true;
  }
  return false;
}

function marketingTopic(text) {
  let topic = String(text || '').replace(/^\/content\s*/i, '').trim();
  topic = topic.replace(/^(generate|create|write)\s+(marketing\s+content|content|a\s+blog|blog\s+post)\s+(about|on|for)\s+/i, '');
  topic = topic.replace(/^marketing\s+content\s+(about|on|for)\s+/i, '');
  return topic.trim() || String(text || '').trim();
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
    lines.push('', 'ℹ️ Template draft (AI unavailable). Check OPENAI_API_KEY in .env for AI-polished copy.');
  }
  return lines.join('\n').slice(0, 4000);
}

function buildMarketingPayload(chatId, rawText) {
  const topic = marketingTopic(rawText);
  if (!topic) return null;
  return {
    topic,
    campaign_name: `Telegram — ${topic.slice(0, 48)}`,
    brand_name: envOr('BRAND_NAME', 'VGI Skill Universe'),
    brand_website: envOr('BRAND_WEBSITE', 'https://n8n.io'),
    audience: envOr('TARGET_AUDIENCE', 'business professionals'),
    tone: 'professional',
    platforms: ['blog', 'linkedin', 'twitter', 'email'],
    keywords: [],
    call_to_action: envOr('DEFAULT_CTA', 'Learn more'),
    goal: 'engage audience',
    context: `Requested via Telegram by chat ${chatId}`,
    recipient_email: envOr('EMAIL_TO', envOr('EMAIL_FROM', '')),
    sender_email: envOr('EMAIL_FROM', ''),
    openai_api_key: envOr('OPENAI_API_KEY'),
    openai_model: envOr('OPENAI_MODEL', 'gpt-4o-mini'),
    notify_email: false,
  };
}

function holdingSignal(h) {
  if (h?.signal && typeof h.signal === 'object') return h.signal;
  return {
    action: h?.signal || h?.action || 'HOLD',
    confidence: h?.confidence,
    summary: h?.summary || '',
  };
}

function formatPortfolioTelegram(item) {
  const counts = item.portfolio_summary?.signal_counts || {};
  const lines = [
    `${item.portfolio_name || 'Portfolio'} — Portfolio Report`,
    `Run: ${item.run_id || 'n/a'}`,
    `Holdings: ${item.holdings_count || item.holdings?.length || 0} · BUY ${counts.BUY || 0} · HOLD ${counts.HOLD || 0} · SELL ${counts.SELL || 0}`,
    '',
    ...(item.holdings || []).slice(0, 6).map((h) => {
      const sig = holdingSignal(h);
      const conf = sig.confidence != null ? `${sig.confidence}%` : '?%';
      const summary = String(sig.summary || '').slice(0, 200);
      return `• ${h.symbol} ${sig.action || 'HOLD'} (${conf})${summary ? ` — ${summary}` : ''}`;
    }),
  ];
  const warnings = item.portfolio_summary?.warnings || [];
  if (warnings.length) lines.push('', `ℹ️ ${String(warnings[0]).slice(0, 200)}`);
  return lines.join('\n').slice(0, 4000);
}

function portfolioTelegramAlreadySent(body, item) {
  return body.notifications?.telegram_sent === true
    || body.notifications?.telegram === true
    || body.telegram_sent === true
    || item.telegram_sent === true;
}

function portfolioWorkflowFailed(body) {
  if (body?.success === false) return true;
  const msg = String(body?.message || '').trim();
  return msg === 'Error in workflow' || /^workflow (failed|error)/i.test(msg);
}

/** Portfolio requests with notify_telegram are delivered by the n8n workflow — poller must not duplicate. */
function portfolioWorkflowOwnsTelegram(payload, body, item) {
  if (payload?.notify_telegram === true) return !portfolioWorkflowFailed(body);
  return portfolioTelegramAlreadySent(body, item);
}

function isResumeScanIntent(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const cmd = raw.split(/\s+/)[0].replace(/@\w+$/, '');
  return cmd === '/scan' || raw === 'scan resumes';
}

function parseScanTarget(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^\/scan(?:@\w+)?\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function resumeScanHelpText() {
  return [
    '📄 Resume analysis',
    '',
    'Send a PDF resume directly, or scan one file from the shared folder:',
    '',
    '• /scan <filename> — e.g. /scan Kumail Rizvi.pdf',
    '• /scan <candidate name> — e.g. /scan Muskan Kumari',
  ].join('\n');
}

function findResumeFilePath(target) {
  const query = String(target || '').trim();
  if (!query) return { path: null, error: 'missing_target' };

  const paths = listResumeFilePaths();
  if (!paths.length) return { path: null, error: 'no_files' };

  const q = query.toLowerCase();
  const withPdf = /\.(pdf|txt)$/i.test(q) ? q : `${q}.pdf`;

  const exact = paths.filter((p) => path.basename(p).toLowerCase() === withPdf);
  if (exact.length === 1) return { path: exact[0] };

  const partial = paths.filter((p) => {
    const base = path.basename(p).toLowerCase();
    const stem = base.replace(/\.(pdf|txt)$/i, '');
    return base.includes(q) || stem.includes(q) || q.includes(stem);
  });
  if (partial.length === 1) return { path: partial[0] };
  if (partial.length > 1) {
    const names = partial.map((p) => path.basename(p)).join(', ');
    return { path: null, error: 'ambiguous', matches: partial, message: `Multiple resumes match "${query}": ${names}. Be more specific.` };
  }
  return { path: null, error: 'not_found', message: `No resume found matching "${query}". Send a PDF directly or check files/resumes/.` };
}

function isResumeDocument(msg) {
  if (!msg?.document) return false;
  const mime = String(msg.document.mime_type || '').toLowerCase();
  const name = String(msg.document.file_name || '').toLowerCase();
  if (mime === 'application/pdf' || mime === 'text/plain') return true;
  return /\.(pdf|txt)$/i.test(name);
}

async function downloadTelegramFile(botToken, fileId) {
  const token = String(botToken || '').trim();
  const id = String(fileId || '').trim();
  if (!token || !id) throw new Error('Missing bot token or file id');
  const getRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(id)}`);
  const getJson = await getRes.json();
  if (!getJson?.ok) throw new Error(getJson?.description || 'Telegram getFile failed');
  const filePath = String(getJson.result?.file_path || '').trim();
  if (!filePath) throw new Error('Telegram getFile returned no file path');
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) throw new Error(`Telegram file download failed: HTTP ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

function resumePayloadCommon(chatId, botToken) {
  return {
    allow_batch_scan: false,
    job_titles: DEFAULT_RESUME_JOB_TITLES,
    use_resume_job_title: false,
    notify_telegram: true,
    notify_email: false,
    telegram_bot_token: botToken,
    telegram_chat_id: chatId,
    openai_api_key: envOr('OPENAI_API_KEY'),
    openai_model: envOr('OPENAI_MODEL', 'gpt-4o-mini'),
    openrouter_api_key: envOr('OPENAI_API_KEY'),
    openrouter_model: envOr('OPENAI_MODEL', 'gpt-4o-mini'),
    recipient_email: envOr('EMAIL_TO', envOr('EMAIL_FROM', '')),
    sender_email: envOr('EMAIL_FROM', ''),
  };
}

function pollerResumesDir() {
  const configured = envOr('RESUMES_FOLDER', '');
  if (configured.startsWith('/files/')) {
    return path.join(envOr('TELEGRAM_DATA_DIR', '/data'), configured.replace(/^\/files\/?/, ''));
  }
  if (configured) return configured;
  return path.join(envOr('TELEGRAM_DATA_DIR', '/data'), 'resumes');
}

function n8nResumePath(localPath) {
  const dataDir = envOr('TELEGRAM_DATA_DIR', '/data');
  const base = path.basename(localPath);
  if (localPath.startsWith(`${dataDir}/`) || localPath.startsWith(`${dataDir}\\`)) {
    const rel = localPath.slice(dataDir.length).replace(/^[/\\]+/, '');
    return `/files/${rel.split(path.sep).join('/')}`;
  }
  if (localPath.startsWith('/files/')) return localPath;
  return `/files/resumes/${base}`;
}

function listResumeFilePaths() {
  const dir = pollerResumesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.(pdf|txt)$/i.test(f) && !/^resume_\d+_/i.test(f))
    .sort()
    .map((f) => n8nResumePath(path.join(dir, f)));
}

function formatResumeTelegram(item) {
  if (item.success === false) {
    return `❌ Resume scan failed: ${String(item.error || item.message || 'unknown error').slice(0, 500)}`;
  }
  const batch = item.batch_summary || {};
  const total = item.total_processed || batch.total_processed || 1;
  const lines = [`✅ Resume analysis complete — ${total} candidate(s) processed.`];
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

function buildResumePayload(chatId, botToken, scanTarget) {
  const resolved = findResumeFilePath(scanTarget);
  if (!resolved.path) {
    const err = new Error(resolved.message || 'Resume not found');
    err.code = resolved.error || 'not_found';
    throw err;
  }
  return {
    scan_resumes_folder: false,
    resume_file_paths: [resolved.path],
    resumes_folder: envOr('RESUMES_FOLDER', '/files/resumes'),
    ...resumePayloadCommon(chatId, botToken),
  };
}

async function buildUploadedResumePayload(chatId, botToken, msg) {
  const doc = msg?.document;
  if (!doc?.file_id) return null;
  const filename = String(doc.file_name || 'resume.pdf').trim();
  const mimeType = String(
    doc.mime_type || (filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain')
  ).trim();
  let buffer;
  try {
    buffer = await downloadTelegramFile(botToken, doc.file_id);
  } catch (err) {
    console.error(`Resume download failed: ${err.message || err}`);
    return null;
  }
  if (!buffer?.length) return null;
  const candidateName = filename
    .replace(/\.(pdf|txt)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Candidate';
  return {
    scan_resumes_folder: false,
    resume_file_paths: [],
    resume_filename: filename,
    resume_mime_type: mimeType,
    resume_base64: buffer.toString('base64'),
    candidate_name: candidateName,
    ...resumePayloadCommon(chatId, botToken),
  };
}

function sharedBotWelcomeText() {
  const custom = String(process.env.TELEGRAM_WELCOME_TEXT || '').trim();
  if (custom) return custom.replace(/\\n/g, '\n');

  const brand = String(process.env.BRAND_NAME || 'VGI Skill Universe!').trim().toUpperCase();
  return [
    `Welcome to ${brand}`,
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
    '—— All features ——',
    '',
    '📚 Knowledge base — ask any question or:',
    '• /ask <your question>',
    '• /rag <your question>',
    '',
    '📦 Product reviews — type /review, then send a photo, link, or name:',
    '• /review → then iPhone 15 Pro reviews',
    '• /review https://amazon.in/dp/...',
    '',
    '📅 Appointments:',
    '• /book — schedule a visit or service',
    '• /cancel — exit an in-progress booking',
    '',
    '✍️ Marketing content:',
    '• /content <topic>',
    '• Example: /content Product launch ideas for B2B SaaS',
    '',
    '📊 Portfolio report:',
    '• /report — AI market analysis (AAPL, MSFT, NVDA)',
    '',
    '📄 Resume analysis:',
    '• Send a PDF resume directly, or',
    '• /scan <filename> — analyze one resume from the shared folder',
    '',
    'Type /help anytime for this guide.',
  ].join('\n');
}

function buildPortfolioPayload(chatId, botToken) {
  return {
    portfolio_name: envOr('PORTFOLIO_NAME', 'My Portfolio'),
    holdings: DEFAULT_PORTFOLIO_HOLDINGS,
    batch_size: 2,
    finnhub_api_key: envOr('FINNHUB_API_KEY', 'd8c7ir1r01qidic6mr70d8c7ir1r01qidic6mr7g'),
    alpha_vantage_api_key: envOr('ALPHA_VANTAGE_API_KEY', 'F5824HO58NAWKIYA'),
    marketaux_api_key: envOr('MARKETAUX_API_KEY', 'mARnGFoyhtjngy6ZOC3Tx5TFDJDxSq5NMGe4tJ3q'),
    openai_api_key: envOr('OPENAI_API_KEY'),
    openai_model: envOr('OPENAI_MODEL', 'gpt-4o-mini'),
    recipient_email: envOr('EMAIL_TO', envOr('EMAIL_FROM', '')),
    sender_email: envOr('EMAIL_FROM', ''),
    notify_email: false,
    notify_slack: false,
    notify_telegram: true,
    telegram_bot_token: botToken,
    telegram_chat_id: chatId,
  };
}

module.exports = {
  DEFAULT_PORTFOLIO_HOLDINGS,
  DEFAULT_RESUME_JOB_TITLES,
  envOr,
  unwrapN8nBody,
  stripReviewCommand,
  isBareReviewCommand,
  reviewPromptText,
  isMarketingIntent,
  isPortfolioIntent,
  isResumeScanIntent,
  parseScanTarget,
  resumeScanHelpText,
  findResumeFilePath,
  isResumeDocument,
  marketingTopic,
  formatMarketingTelegram,
  formatPortfolioTelegram,
  formatResumeTelegram,
  sharedBotWelcomeText,
  holdingSignal,
  portfolioTelegramAlreadySent,
  portfolioWorkflowFailed,
  portfolioWorkflowOwnsTelegram,
  buildMarketingPayload,
  buildPortfolioPayload,
  buildResumePayload,
  buildUploadedResumePayload,
  listResumeFilePaths,
};
