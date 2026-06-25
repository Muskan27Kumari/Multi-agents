#!/usr/bin/env node
/**
 * Builds workflows/customer-review-responder.json
 */
const fs = require('fs');
const path = require('path');

const AI_CHAT_HELPERS = `function isOpenRouterKey(key) {
  return /^sk-or-/i.test(cleanKey(key));
}
function chatCompletionsUrl(apiKey) {
  return isOpenRouterKey(apiKey)
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}
function normalizeChatModel(model, apiKey) {
  const m = String(model || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL || 'gpt-4o-mini').trim();
  if (isOpenRouterKey(apiKey)) {
    return m.includes('/') ? m : 'openai/' + m.replace(/^openai\\//, '');
  }
  return m.replace(/^openai\\//, '');
}
`;

const ADAPT_TELEGRAM = `const raw = $input.first().json;
const token = String(
  raw.telegram_bot_token || raw.body?.telegram_bot_token
  || $env.TELEGRAM_BOT_TOKEN || ''
).trim();
const allowedChatId = String($env.TELEGRAM_CHAT_ID || '').trim();

function skip(reason) {
  return [{ json: { telegram_skip: true, channel: 'telegram', skip_reason: reason } }];
}

function reply(text, chatId) {
  return [{
    json: {
      action: 'telegram_reply',
      channel: 'telegram',
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
  } catch (e) {}
}

const msg = update.message || update.edited_message || update.channel_post;
if (!msg) return skip('no_message');

const chatId = String(msg.chat?.id || '');
if (allowedChatId && chatId !== allowedChatId) {
  return reply('This bot is restricted to an authorized chat.', chatId);
}

let text = String(msg.text || msg.caption || '').trim();
text = text.replace(/^\\/reviews?(?:@\\w+)?\\s*/i, '').trim();

function normalizeGreeting(t) {
  return String(t || '').trim().toLowerCase().replace(/[!?.…,]+$/g, '').replace(/\\s+/g, ' ');
}

function isGreeting(t) {
  const s = normalizeGreeting(t);
  if (!s) return false;
  const greetings = new Set([
    'hi', 'hii', 'hello', 'hey', 'hiya', 'howdy', 'greetings', 'sup', 'yo',
    'good morning', 'good afternoon', 'good evening', 'good day',
    'hi there', 'hello there', 'hey there',
  ]);
  if (greetings.has(s)) return true;
  return /^h+i+$/.test(s) || /^he+l+o+$/.test(s) || /^he+y+$/.test(s);
}

function reviewPromptMessage() {
  return [
    '📦 Customer review research',
    '',
    'Send me any product using one of these:',
    '',
    '📝 Product name — e.g. "iPhone 15 Pro reviews"',
    '🔗 Product link — Amazon, Flipkart, or any store URL',
    '📷 Product photo — add a caption with the product name for best results',
    '',
    'Type /cancel to exit review mode.',
  ].join('\\n');
}

function welcomeMessage() {
  const brand = String($env.BRAND_NAME || 'VGI Skill Universe!').trim();
  return [
    'Welcome to ' + brand,
    '',
    'I research customer reviews for any product.',
    '',
    'Type /review then send:',
    '• A product photo (caption recommended)',
    '• A product link (Amazon, Flipkart, etc.)',
    '• A product name — e.g. "Maruti Suzuki Dzire reviews"',
  ].join('\\n');
}
const photos = msg.photo || [];
let imageUrl = '';
let imageBase64 = '';

async function downloadTelegramImage(fileId) {
  const fileResp = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://api.telegram.org/bot' + token + '/getFile?file_id=' + encodeURIComponent(fileId),
    json: true,
    timeout: 15000,
  });
  const filePath = fileResp.result?.file_path;
  if (!filePath) return { imageUrl: '', imageBase64: '' };
  const fileUrl = 'https://api.telegram.org/file/bot' + token + '/' + filePath;
  const bytes = await this.helpers.httpRequest({
    method: 'GET',
    url: fileUrl,
    encoding: 'arraybuffer',
    timeout: 20000,
  });
  const buf = Buffer.from(bytes);
  if (!buf.length) return { imageUrl: fileUrl, imageBase64: '' };
  const mime = /\\.png$/i.test(filePath) ? 'image/png' : (/\\.webp$/i.test(filePath) ? 'image/webp' : 'image/jpeg');
  return { imageUrl: fileUrl, imageBase64: buf.toString('base64'), image_mime: mime };
}

if (token) {
  try {
    const fileIds = [];
    if (photos.length) {
      const mid = photos.length >= 2 ? photos[photos.length - 2] : photos[photos.length - 1];
      fileIds.push(mid.file_id);
      if (photos.length > 1) fileIds.push(photos[0].file_id);
    } else if (msg.document && /^image\\//i.test(String(msg.document.mime_type || ''))) {
      fileIds.push(msg.document.file_id);
    }
    for (const fileId of fileIds) {
      const img = await downloadTelegramImage.call(this, fileId);
      imageUrl = img.imageUrl || '';
      imageBase64 = img.imageBase64 || '';
      if (imageBase64 && imageBase64.length <= 280000) break;
    }
  } catch (e) {}
}

const lower = text.toLowerCase();
if (!imageUrl && !imageBase64 && (lower === '/start' || lower === '/help' || isGreeting(text))) {
  return reply(welcomeMessage(), chatId);
}

if (!text && !imageUrl && !imageBase64) {
  return reply(reviewPromptMessage(), chatId);
}

return [{
  json: {
    channel: 'telegram',
    text_query: text,
    image_url: imageUrl,
    image_base64: imageBase64,
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    notify_telegram: true,
    openrouter_api_key: String($env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '').trim(),
    serper_api_key: String($env.SERPER_API_KEY || '').trim(),
  },
}];`;

const NORMALIZE_INPUT = `function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\\s+/i, '');
}

function isPlaceholderKey(key) {
  const k = cleanKey(key).toLowerCase();
  return !k
    || k.includes('your-key')
    || k.includes('your-openrouter')
    || k.includes('your_serper')
    || k === 'sk-or-v1-your-key'
    || k === 'sk-or-v1-your_openrouter_key'
    || k === 'your-serper-key';
}

async function resolveOpenRouterKey(body, raw) {
  const preferOpenAI = String($env.AI_PROVIDER || 'openai').toLowerCase() === 'openai';
  let key = '';
  if (preferOpenAI) {
    key = cleanKey(body.openai_api_key || raw.openai_api_key || $env.OPENAI_API_KEY || '');
    if (key && !isPlaceholderKey(key) && !/^sk-or-/i.test(key)) return key;
  }
  key = cleanKey(body.openrouter_api_key || raw.openrouter_api_key || body.openai_api_key || raw.openai_api_key || $env.OPENROUTER_API_KEY || $env.OPENAI_API_KEY || '');
  if (isPlaceholderKey(key)) key = cleanKey($env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '');
  if (!key) {
    try {
      const cred = await this.getCredentials('httpHeaderAuth');
      key = cleanKey(cred.value || cred.headerValue);
    } catch (e) {}
  }
  if (isPlaceholderKey(key)) return '';
  return key;
}

const raw = $input.first().json;
if (raw.telegram_skip || raw.action === 'telegram_reply') return [{ json: raw }];

const body = raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body) ? raw.body : raw;
const envOr = (v, envKey) => String(v || $env[envKey] || '').trim();
const openrouterKey = await resolveOpenRouterKey.call(this, body, raw);
const serperRaw = String(body.serper_api_key || raw.serper_api_key || $env.SERPER_API_KEY || '').trim();
const serperKey = isPlaceholderKey(serperRaw) ? '' : serperRaw;

function extractUrlAndText(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/(https?:\\/\\/[^\\s<>"']+|(?:[a-z0-9-]+\\.)+[a-z]{2,}\\/[^\\s<>"']+)/i);
  if (!m) return { url: '', text: raw };
  let url = m[1].replace(/[),.;!?]+$/, '');
  if (!/^https?:\\/\\//i.test(url)) url = 'https://' + url;
  const text = raw.replace(m[1], '').trim();
  return { url, text };
}

const explicitUrl = String(body.product_url || body.url || raw.product_url || raw.url || '').trim();
const textRaw = String(body.text_query || body.query || body.text || '').trim();
const parsed = extractUrlAndText(textRaw);
const productUrl = explicitUrl || parsed.url;
const textQuery = parsed.text || (productUrl && !parsed.text ? '' : textRaw);

return [{
  json: {
    run_id: 'crr_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8),
    text_query: textQuery || (productUrl ? 'Product from link' : ((body.image_url || raw.image_url || body.image_base64) ? 'Product from image' : '')),
    product_url: productUrl,
    product_name: String(body.product_name || body.product || '').trim(),
    brand: String(body.brand || '').trim(),
    category: String(body.category || '').trim(),
    image_url: String(body.image_url || raw.image_url || '').trim(),
    image_base64: String(body.image_base64 || '').trim(),
    review_context: String(body.review_context || body.context || '').trim(),
    openrouter_api_key: openrouterKey,
    openrouter_model: String(body.openrouter_model || raw.openrouter_model || body.openai_model || raw.openai_model || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL || 'gpt-4o-mini').trim(),
    vision_model: String(body.vision_model || body.openai_model || body.openrouter_model || $env.OCR_VISION_MODEL || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL || 'gpt-4o-mini').trim(),
    serper_api_key: serperKey,
    telegram_bot_token: envOr(body.telegram_bot_token || raw.telegram_bot_token, 'TELEGRAM_BOT_TOKEN'),
    telegram_chat_id: String(body.telegram_chat_id || raw.telegram_chat_id || $env.TELEGRAM_CHAT_ID || '').trim(),
    notify_telegram: Boolean(
      body.notify_telegram ?? raw.notify_telegram ?? (
        Boolean($env.TELEGRAM_BOT_TOKEN) && Boolean(
          String(body.telegram_chat_id || raw.telegram_chat_id || $env.TELEGRAM_CHAT_ID || '').trim()
        )
      )
    ),
    search_sources: Array.isArray(body.search_sources) ? body.search_sources : [
      'google', 'news', 'reddit', 'twitter', 'youtube',
      'amazon', 'flipkart', 'linkedin', 'forums',
    ],
    max_results_per_source: Math.min(Math.max(Number(body.max_results_per_source || 5), 1), 10),
    channel: String(body.channel || raw.channel || 'webhook'),
    triggered_at: new Date().toISOString(),
  },
}];`;

const VALIDATE_INPUT = `const item = $input.first().json;
if (item.telegram_skip || item.action === 'telegram_reply') return $input.all();

const hasInput = item.text_query || item.product_name || item.image_url || item.image_base64 || item.product_url;
if (!hasInput) {
  throw new Error('Provide at least one of: text_query, product_url, product_name, image_url, or image_base64.');
}
if (!item.openrouter_api_key) {
  throw new Error('Missing AI API key. Pass in webhook body, set OPENAI_API_KEY in .env, or attach HTTP Header Auth credential.');
}
return $input.all();`;

const FETCH_PRODUCT_URL = `function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}

function metaContent(html, prop) {
  const h = String(html || '');
  const needles = ['property="' + prop + '"', "property='" + prop + "'", 'name="' + prop + "'", "name='" + prop + "'"];
  for (const needle of needles) {
    const i = h.indexOf(needle);
    if (i < 0) continue;
    const chunk = h.slice(i, i + 600);
    const cm = chunk.match(/content=(["'])([^"']+)\\1/i);
    if (cm) return decodeHtml(cm[2]);
  }
  return '';
}

function parseJsonLd(html) {
  const blocks = String(html || '').match(/<script[^>]+type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.replace(/<script[^>]*>|<\\/script>/gi, '').trim();
    try {
      let data = JSON.parse(inner);
      const list = Array.isArray(data) ? data : (data['@graph'] || [data]);
      const product = list.find((x) => {
        const t = x['@type'];
        return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
      });
      if (product) return product;
    } catch (e) {}
  }
  return null;
}

function hostFromUrl(inputUrl) {
  try { return new URL(inputUrl).hostname.replace(/^www\\./, ''); } catch (e) {}
  const m = String(inputUrl || '').match(/https?:\\/\\/([^\\/?:#]+)/i);
  return m ? m[1].replace(/^www\\./, '') : '';
}

function retailerFromUrl(url) {
  try {
    const host = hostFromUrl(url);
    const map = [
      [/amazon|amzn\\.in/, (h) => (h.includes('.in') ? 'Amazon India' : 'Amazon')],
      [/flipkart/, () => 'Flipkart'],
      [/myntra/, () => 'Myntra'],
      [/nykaa/, () => 'Nykaa'],
      [/ajio/, () => 'Ajio'],
      [/croma/, () => 'Croma'],
      [/reliancedigital|reliance digital/, () => 'Reliance Digital'],
      [/tatacliq/, () => 'Tata CLiQ'],
      [/meesho/, () => 'Meesho'],
      [/snapdeal/, () => 'Snapdeal'],
      [/bestbuy/, () => 'Best Buy'],
      [/walmart/, () => 'Walmart'],
      [/target\\.com/, () => 'Target'],
      [/ebay/, () => 'eBay'],
      [/etsy/, () => 'Etsy'],
      [/apple\\.com/, () => 'Apple'],
      [/samsung\\.com/, () => 'Samsung'],
      [/oneplus/, () => 'OnePlus'],
      [/mi\\.com|xiaomi/, () => 'Xiaomi'],
      [/shopify/, () => 'Shopify Store'],
    ];
    for (const [re, label] of map) {
      if (re.test(host)) return label(host);
    }
    const label = host.split('.').slice(-2, -1)[0] || host.split('.')[0];
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : host;
  } catch (e) {
    return null;
  }
}

function serperGeoForHost(host) {
  if (/\\.in$|amazon\\.in|flipkart|myntra|nykaa|ajio|croma|meesho|snapdeal|tatacliq/.test(host || '')) return { gl: 'in', hl: 'en' };
  if (/\\.co\\.uk$|\\.uk$/.test(host || '')) return { gl: 'gb', hl: 'en' };
  if (/\\.de$/.test(host || '')) return { gl: 'de', hl: 'de' };
  if (/\\.fr$/.test(host || '')) return { gl: 'fr', hl: 'fr' };
  if (/\\.ca$/.test(host || '')) return { gl: 'ca', hl: 'en' };
  if (/\\.com\\.au$|\\.au$/.test(host || '')) return { gl: 'au', hl: 'en' };
  return { gl: 'us', hl: 'en' };
}

function guessBrand(name, retailer) {
  const brands = ['Sony', 'Samsung', 'Apple', 'Bose', 'JBL', 'Dyson', 'Nike', 'Adidas', 'LG', 'Philips', 'Canon', 'Nikon', 'Microsoft', 'Google', 'OnePlus', 'Xiaomi'];
  for (const b of brands) {
    if (new RegExp('\\\\b' + b + '\\\\b', 'i').test(String(name || ''))) return b;
  }
  return retailer || null;
}

function cleanTitle(title) {
  return String(title || '')
    .replace(/\\s*\\+\\s*free shipping.*$/i, '')
    .replace(/\\s*[-|:]\\s*(Amazon\\.[^|]+|Flipkart|Buy Online|Price in India|Online at[^|]+|Shop Now|Official Store).*$/i, '')
    .replace(/\\s*\\|\\s*(Amazon[^|]*|Flipkart[^|]*|Walmart[^|]*|Target[^|]*|Best Buy[^|]*|eBay[^|]*|Myntra[^|]*|Nykaa[^|]*)\\s*$/i, '')
    .replace(/\\s*:\\s*(Amazon\\.[^:]*|Flipkart|Walmart|Target|Best Buy)(?::.*)?$/i, '')
    .trim();
}

function cleanSerperTitle(title) {
  return cleanTitle(String(title || '')
    .replace(/\\s*[-|:]\\s*(Buy Online|Official Site).*$/i, '')
    .replace(/\\.\\.\\.$/, '')
    .trim());
}

function titleFromUrlPath(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts.find((p) => p.length > 8 && p.includes('-') && !/^[A-Z0-9]{10}$/i.test(p));
    if (!slug) return '';
    return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } catch (e) {
    return '';
  }
}

function isJunkFeature(text) {
  return /^(find a |recommendations|browsing history|sign in|log in|registry|video purchases|kindle|investor|accessibility|music library|customer service|your account|gift cards|sell on|cookie|privacy policy|terms of|subscribe|newsletter|free delivery|add to cart|buy now|shop all|shop by)/i.test(text)
    || /^(amazon|flipkart|walmart|target|ebay|myntra|nykaa)\\s/i.test(text);
}

function isWeakTitle(title) {
  const t = String(title || '').trim();
  if (!t || t.length < 8) return true;
  if (/^(Amazon|Flipkart|Shop)\\.?com?\\b/i.test(t)) return true;
  if (/amazon\\.com|flipkart\\.com/i.test(t)) return true;
  return false;
}

function isBadTitle(title) {
  const t = String(title || '').trim();
  if (isWeakTitle(t)) return true;
  if (/^(access denied|robot check|sorry!?|page not found|not found|error|forbidden|503|502|403|404|just a moment|attention required|service unavailable|amazon\\.in|amazon\\.com)$/i.test(t)) return true;
  if (/^amazon\\.(in|com)$/i.test(t)) return true;
  return false;
}

function isBlockedPage(html, title) {
  const h = String(html || '');
  const hl = h.toLowerCase();
  const t = String(title || '').trim();
  if (isBadTitle(t)) return true;
  if (/validatecaptcha|opfcaptcha|api-services-support@amazon|automated access to amazon|click the button below to continue shopping|to discuss automated access/i.test(hl)) return true;
  if (/access denied|robot check|sorry, we just need to make sure/i.test(hl)) return true;
  if (h.length > 0 && h.length < 600 && !/add to cart|productTitle|buy now|out of 5 stars/i.test(hl)) return true;
  return false;
}

function extractShortCode(inputUrl) {
  try {
    const parts = new URL(inputUrl).pathname.split('/').filter(Boolean);
    if (parts[0] === 'd' && parts[1]) return parts[1];
    if (parts[0] === 'p' && parts[1]) return parts[1];
    const asin = String(inputUrl).match(/\\/dp\\/([A-Z0-9]{10})/i);
    if (asin) return asin[1];
    const pid = String(inputUrl).match(/\\/p\\/([a-z0-9-]+)/i);
    if (pid) return pid[1];
    const idParam = String(inputUrl).match(/[?&](?:pid|id|sku|product_id)=([^&]+)/i);
    if (idParam) return idParam[1];
  } catch (e) {}
  return '';
}

function pathSlugFromUrl(inputUrl) {
  try {
    const parts = new URL(inputUrl).pathname.split('/').filter(Boolean);
    return parts.find((p) => p.length > 8 && p.includes('-') && !/^[A-Z0-9]{6,14}$/i.test(p)) || '';
  } catch (e) {
    return '';
  }
}

function sanitizePrice(value) {
  const s = String(value || '').trim();
  if (!s || !/\\d/.test(s)) return null;
  return s;
}

function extractPriceFromHtml(html, ld) {
  const priceRaw = ld?.offers?.price
    || (Array.isArray(ld?.offers) ? ld.offers[0]?.price : null)
    || metaContent(html, 'product:price:amount')
    || metaContent(html, 'og:price:amount')
    || metaContent(html, 'twitter:data1');
  const currency = ld?.offers?.priceCurrency || metaContent(html, 'product:price:currency') || metaContent(html, 'og:price:currency') || '';
  const fromLd = sanitizePrice(priceRaw);
  if (fromLd) return (currency ? currency + ' ' : '') + fromLd;
  const ogStd = sanitizePrice(metaContent(html, 'og:price:standard_amount'));
  if (ogStd) return ogStd;
  const itemprop = String(html || '').match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
  if (itemprop && sanitizePrice(itemprop[1])) return decodeHtml(itemprop[1]);
  const money = String(html || '').match(/([₹$€£]\\s?[\\d,]+(?:\\.\\d{2})?)/);
  if (money && sanitizePrice(money[1])) return money[1].replace(/\\s+/g, '');
  return null;
}

function extractRatingFromHtml(html, ld) {
  const ratingVal = ld?.aggregateRating?.ratingValue;
  let rating = ratingVal ? String(ratingVal) + '/5' : null;
  let reviewCount = ld?.aggregateRating?.reviewCount || ld?.aggregateRating?.ratingCount || null;
  if (!rating) {
    const m = String(html || '').match(/(\\d+(?:\\.\\d+)?)\\s*(?:\\/\\s*5|out of 5)\\s*stars?/i);
    if (m) rating = m[1] + '/5';
  }
  if (!reviewCount) {
    const rc = String(html || '').match(/(?:out of 5 stars|rating)[^\\d]{0,30}\\(?([\\d,]{2,})\\)?/i);
    if (rc) reviewCount = rc[1].replace(/,/g, '');
  }
  if (reviewCount && Number(reviewCount) < 10 && !String(html || '').includes(reviewCount + ',')) {
    reviewCount = null;
  }
  return { rating, reviewCount };
}

function pickProductSerperHit(organic, urlProbe, targetHost) {
  const host = targetHost || hostFromUrl(urlProbe.split(' ').find((u) => u.startsWith('http')) || urlProbe);
  for (const r of organic || []) {
    const link = String(r.link || '');
    const linkHost = hostFromUrl(link);
    const t = cleanSerperTitle(r.title || '');
    if (!t || isBadTitle(t)) continue;
    if (/access denied|sign in|seller central|help center|community guidelines|login|cart empty/i.test(t + ' ' + link)) continue;
    if (/\\/s\\?|search\\?|category\\/|gp\\/help|\\/help\\/|\\/collections\\//i.test(link)) continue;
    if (host && linkHost && (linkHost === host || linkHost.endsWith('.' + host) || host.endsWith(linkHost))) {
      return { ...r, cleanTitle: t };
    }
    if (/\\/dp\\/|\\/p\\/|\\/product\\/|\\/products\\/|\\/itm\\/|\\/d\\/[A-Za-z0-9]+/i.test(link)) {
      return { ...r, cleanTitle: t };
    }
  }
  for (const r of organic || []) {
    const t = cleanSerperTitle(r.title || '');
    if (t && !isBadTitle(t) && !/access denied|sign in|login page/i.test(t)) return { ...r, cleanTitle: t };
  }
  return null;
}

function buildExplanation(details) {
  return buildProductExplanation(details).slice(0, 900);
}

function buildProductExplanation(details) {
  const parts = [];
  const name = details.name || 'This product';
  const who = details.brand ? name + ' by ' + details.brand : name;
  parts.push(who + (details.retailer ? ' — sold on ' + details.retailer : '') + '.');
  if (details.price) parts.push('Listed price: ' + details.price + '.');
  if (details.rating) {
    parts.push('Store rating: ' + details.rating + (details.review_count ? ' (' + Number(details.review_count).toLocaleString('en-IN') + ' reviews on the store page)' : '') + '.');
  }
  if (details.description) parts.push(details.description);
  if (details.features && details.features.length) {
    parts.push('Notable features: ' + details.features.slice(0, 5).join('; ') + '.');
  }
  if (details.fetch_error && details.serper_fallback) {
    parts.push('(Product page was partially blocked; details were recovered via web search.)');
  }
  return parts.join(' ').trim();
}

const item = $input.first().json;
let url = String(item.product_url || '').trim();
if (!url) throw new Error('Fetch Product URL: missing product_url.');

const fetchHeaders = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Cache-Control': 'no-cache',
};

let html = '';
let fetchError = null;
try {
  const resp = await this.helpers.httpRequest({
    method: 'GET',
    url,
    headers: fetchHeaders,
    timeout: 30000,
    json: false,
  });
  html = typeof resp === 'string' ? resp : (resp?.body || resp?.data || String(resp || ''));
} catch (err) {
  fetchError = String(err.message || err).slice(0, 200);
}

const rawPageTitle = decodeHtml((html.match(/<title[^>]*>([^<]+)<\\/title>/i) || [])[1] || '');
if (html && /https?:\\/\\/[^"'\\s]+\\/dp\\/[A-Z0-9]{10}/i.test(html)) {
  const dp = html.match(/https?:\\/\\/[^"'\\s]+\\/dp\\/[A-Z0-9]{10}[^"'\\s]*/i);
  if (dp) {
    try { url = new URL(dp[0]).href; } catch (e) {}
  }
}

const serperKey = String(item.serper_api_key || '').trim();
let serperHit = null;
async function serperSearch(q, extra) {
  return this.helpers.httpRequest({
    method: 'POST',
    url: 'https://google.serper.dev/search',
    headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
    body: { q, num: 8, ...(extra || {}) },
    json: true,
    timeout: 15000,
  });
}

async function lookupProductViaSerper(productUrl, originalUrl, retailerHint) {
  if (!serperKey) return null;
  const probe = (productUrl + ' ' + originalUrl).toLowerCase();
  const host = hostFromUrl(productUrl) || hostFromUrl(originalUrl);
  const geo = serperGeoForHost(host);
  const code = extractShortCode(originalUrl) || extractShortCode(productUrl);
  const slug = pathSlugFromUrl(productUrl) || pathSlugFromUrl(originalUrl);
  const asin = (productUrl.match(/\\/dp\\/([A-Z0-9]{10})/i) || [])[1];
  const queries = [];
  if (host && slug) queries.push(slug.replace(/-/g, ' ') + ' site:' + host);
  if (host && asin) queries.push('site:' + host + ' ' + asin);
  if (host && code) queries.push('site:' + host + ' ' + code);
  if (originalUrl) queries.push('"' + originalUrl + '"');
  if (originalUrl) queries.push(originalUrl);
  if (productUrl && productUrl !== originalUrl) queries.push(productUrl);
  if (slug && host) queries.push(slug.replace(/-/g, ' ') + ' buy site:' + host);

  for (const q of [...new Set(queries.filter(Boolean))]) {
    try {
      const resp = await serperSearch.call(this, q, geo);
      const hit = pickProductSerperHit(resp.organic || [], probe, host);
      if (hit) return { hit, query: q };
    } catch (e) {}
  }
  return null;
}

const sourceUrl = String(item.product_url || '').trim();
const urlProbe = (url + ' ' + sourceUrl).toLowerCase();
const storeHost = hostFromUrl(url) || hostFromUrl(sourceUrl);
const serperGeo = serperGeoForHost(storeHost);
let retailer = retailerFromUrl(url) || retailerFromUrl(sourceUrl);

const pageBlocked = isBlockedPage(html, rawPageTitle);
let usedSerperProductLookup = false;

if (pageBlocked) {
  html = '';
  fetchError = fetchError || 'Store blocked automated access — using search lookup for product details';
}

const ld = pageBlocked ? null : parseJsonLd(html);
let title = cleanTitle(decodeHtml(ld?.name || metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || rawPageTitle || ''));
if (isBadTitle(title) && html) {
  const h1 = decodeHtml((html.match(/<h1[^>]*>([\\s\\S]{8,220}?)<\\/h1>/i) || [])[1] || '');
  if (h1 && !isBadTitle(h1)) title = cleanTitle(h1);
}
let description = pageBlocked ? '' : decodeHtml(ld?.description || metaContent(html, 'og:description') || metaContent(html, 'description') || '');

if (serperKey && (pageBlocked || isBadTitle(title) || !html || html.length < 800)) {
  const lookup = await lookupProductViaSerper.call(this, url, sourceUrl, retailer);
  if (lookup?.hit) {
    usedSerperProductLookup = true;
    serperHit = lookup.hit;
    title = lookup.hit.cleanTitle || title;
    if (lookup.hit.snippet) description = decodeHtml(lookup.hit.snippet);
    if (lookup.hit.link && lookup.hit.link.startsWith('http') && !isBadTitle(lookup.hit.cleanTitle || '')) {
      url = lookup.hit.link;
    }
  }
}

if (isBadTitle(title)) {
  const slugTitle = titleFromUrlPath(url) || titleFromUrlPath(sourceUrl);
  if (slugTitle && !isBadTitle(slugTitle)) title = slugTitle;
}

if (serperKey && isBadTitle(title)) {
  try {
    const resp = await serperSearch.call(this, sourceUrl || url, serperGeo);
    const hit = pickProductSerperHit(resp.organic || [], urlProbe, storeHost);
    if (hit) {
      usedSerperProductLookup = true;
      serperHit = hit;
      title = hit.cleanTitle || title;
      if (hit.snippet) description = decodeHtml(hit.snippet);
      if (hit.link && hit.link.startsWith('http')) url = hit.link;
    }
  } catch (e) {}
}

if (serperKey && (!description || description.length < 50) && title && !isBadTitle(title)) {
  try {
    const resp = await serperSearch.call(this, title + ' product details', serperGeo);
    const hit = (resp.organic || []).find((r) => (
      r.snippet && r.title && !/community guidelines|seller central|product opportunity|sign in|access denied|login/i.test(r.title + r.snippet)
    )) || (resp.organic || [])[0];
    if (hit?.snippet && !/access denied/i.test(hit.snippet)) description = decodeHtml(hit.snippet);
  } catch (e) {}
}

title = cleanTitle(title);
if (isBadTitle(title)) {
  const code = extractShortCode(sourceUrl) || extractShortCode(url);
  title = code ? ((retailer || 'Online store') + ' product ' + code) : 'Product from link';
  fetchError = fetchError || 'Could not read product page — review search uses limited product info';
}
let price = extractPriceFromHtml(html, ld);
const ratingExtracted = extractRatingFromHtml(html, ld);
let rating = ratingExtracted.rating;
let reviewCount = ratingExtracted.reviewCount;
if (serperHit?.rating && !rating) rating = String(serperHit.rating) + '/5';
if (serperHit?.ratingCount && !reviewCount) reviewCount = String(serperHit.ratingCount);
if (reviewCount && Number(reviewCount) < 50 && !ld?.aggregateRating?.reviewCount && !serperHit?.ratingCount) reviewCount = null;
if (!price && pageBlocked === false && html) {
  const priceM = html.match(/(?:Price|M\\.R\\.P\\.|Now)[^₹$€£]{0,80}([₹$€£][\\d,]+(?:\\.\\d{2})?)/i);
  if (priceM) price = priceM[1];
}
let brand = (typeof ld?.brand === 'object' ? ld.brand?.name : ld?.brand) || guessBrand(title, retailer);
const image = Array.isArray(ld?.image) ? ld.image[0] : (ld?.image || metaContent(html, 'og:image') || null);

const features = [];
for (const li of (html.match(/<li[^>]*>([\\s\\S]{10,140}?)<\\/li>/gi) || []).slice(0, 25)) {
  const t = decodeHtml(li.replace(/<[^>]+>/g, ''));
  if (t.length > 12 && t.length < 140 && !/^\\d+$/.test(t) && !isJunkFeature(t)) features.push(t);
}
const uniqueFeatures = [...new Set(features)].slice(0, 6);

if (!title && url.includes('amazon') && /\\/dp\\/([A-Z0-9]{10})/i.test(url)) {
  title = 'Amazon product ' + url.match(/\\/dp\\/([A-Z0-9]{10})/i)[1];
}

const finalHost = hostFromUrl(url) || hostFromUrl(sourceUrl);
if (!retailer) retailer = retailerFromUrl(url) || retailerFromUrl(sourceUrl) || (finalHost ? retailerFromUrl('https://' + finalHost + '/') : null);
if (!retailer && /amazon|amzn\\.in/.test(urlProbe)) {
  retailer = /amzn\\.in|amazon\\.in/.test(urlProbe) ? 'Amazon India' : 'Amazon';
}

const productDetails = {
  source_url: String(item.product_url || '').trim(),
  resolved_url: url !== String(item.product_url || '').trim() ? url : null,
  store_host: finalHost || null,
  retailer: retailer || null,
  name: title || 'Product',
  brand: brand || null,
  price: price || null,
  rating: rating || null,
  review_count: reviewCount ? String(reviewCount) : null,
  description: description.slice(0, 600),
  features: uniqueFeatures,
  image: image || null,
  fetch_error: fetchError,
  page_blocked: pageBlocked,
  serper_fallback: usedSerperProductLookup || Boolean(serperHit && (!html || html.length < 800)),
  product_explanation: '',
};

productDetails.product_explanation = buildProductExplanation(productDetails);

const explanation = buildExplanation(productDetails);
const searchName = cleanTitle(title) || 'product reviews';
const userNote = String(item.text_query || '').trim();
const extraContext = userNote && userNote !== 'Product from link' ? userNote + '. ' : '';

return [{
  json: {
    ...item,
    text_query: searchName,
    identification_source: 'product_url',
    review_context: extraContext + explanation,
    product_details: productDetails,
    product: {
      product_name: searchName.slice(0, 200),
      brand: brand || null,
      category: retailer ? 'product/' + String(retailer).toLowerCase() : 'product',
      model_variant: null,
      confidence: isBadTitle(searchName) ? 50 : (usedSerperProductLookup ? 88 : (title ? 95 : 60)),
      visual_cues: [],
      search_queries: [
        searchName + ' reviews',
        searchName + ' customer reviews',
        (brand ? brand + ' ' : '') + searchName.split(' ').slice(0, 5).join(' ') + ' review',
        storeHost ? searchName.split(' ').slice(0, 6).join(' ') + ' site:' + (finalHost || storeHost) + ' reviews' : null,
      ].filter(Boolean).filter((q) => !/^access denied\\b/i.test(q)),
    },
  },
}];`;

const VISION_AI = `function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\\s+/i, '');
}
${AI_CHAT_HELPERS}
function parseJsonLoose(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  let s = String(raw).trim();
  try { return JSON.parse(s); } catch (e) {}
  const start = s.indexOf('{');
  if (start >= 0) {
    s = s.slice(start);
    for (const suffix of ['', '}', '"}']) {
      try { return JSON.parse(s + suffix); } catch (e2) {}
    }
  }
  return null;
}

function buildVisionExplanation(parsed) {
  const name = String(parsed.product_name || 'This product').trim();
  const brand = parsed.brand ? ' by ' + parsed.brand : '';
  const cat = parsed.category ? ' (' + parsed.category + ')' : '';
  const cues = (parsed.visual_cues || []).slice(0, 5);
  let s = name + brand + cat + ' — identified from your photo.';
  if (parsed.model_variant) s += ' Model/variant: ' + parsed.model_variant + '.';
  if (cues.length) s += ' Visible details: ' + cues.join('; ') + '.';
  return s.slice(0, 900);
}

const item = $input.first().json;
const apiKey = cleanKey(item.openrouter_api_key);
const primaryModel = String(item.vision_model || $env.OCR_VISION_MODEL || $env.OPENROUTER_MODEL || '').trim();

let imageUrl = String(item.image_url || '').trim();
const b64 = String(item.image_base64 || '').trim();

if (!imageUrl && !b64) {
  throw new Error('Vision AI: no image_url or image_base64 provided.');
}

function visionHelpReply(item, text) {
  if (item.channel === 'telegram') {
    return [{ json: { ...item, action: 'telegram_reply', telegram_text: text, notify_telegram: false } }];
  }
  throw new Error(text);
}

const isTelegramFileUrl = /api\\.telegram\\.org\\/file\\/bot/i.test(imageUrl);

if (b64) {
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : (b64.startsWith('iVBOR') ? 'image/png' : (b64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg'));
  imageUrl = 'data:' + mime + ';base64,' + b64.replace(/^data:image\\/\\w+;base64,/, '');
} else if (isTelegramFileUrl) {
  return visionHelpReply(item, '📷 Could not prepare your photo for analysis. Resend with a caption naming the product (e.g. "Mercedes A-Class reviews").');
}

const userNote = String(item.text_query || '').trim();
const captionFallbackName = userNote && !/^product from (image|link)$/i.test(userNote)
  ? userNote.replace(/\\b(customer\\s+)?reviews?\\b/gi, '').trim()
  : '';

const systemPrompt = 'You identify consumer products from photos for a customer review research system. Return strict JSON only with keys: product_name (string — exact searchable product name, include model/size/color if visible), brand (string or null), category (string), model_variant (string or null), confidence (0-100 number), visual_cues (array of 3-6 short strings describing packaging, labels, colors, size), search_queries (array of 3-4 web search strings focused on CUSTOMER REVIEWS and buyer opinions).';
const userPrompt = 'Identify the product in this image for customer review research. Return the most specific product name possible (brand + model + variant). Focus search_queries on customer reviews and buyer feedback.'
  + (userNote && userNote !== 'Product from image' ? '\\n\\nUser note: ' + userNote : '');

function parseVisionResult(content) {
  const parsed = parseJsonLoose(content) || {};
  if (parsed.product_name) return parsed;
  const raw = String(content || '');
  const nameM = raw.match(/product_name["'\\s:]+["']?([^"'\\n,}]+)/i);
  const brandM = raw.match(/brand["'\\s:]+["']?([^"'\\n,}]+)/i);
  if (nameM) {
    parsed.product_name = nameM[1].trim();
    if (brandM) parsed.brand = brandM[1].trim();
  }
  return parsed.product_name ? parsed : null;
}

if (imageUrl.startsWith('data:') && imageUrl.length > 350000) {
  if (captionFallbackName && captionFallbackName.length >= 3) {
    const parsed = {
      product_name: captionFallbackName,
      brand: null,
      category: 'product',
      confidence: 50,
      visual_cues: ['Identified from your caption (photo too large for vision)'],
      search_queries: [captionFallbackName + ' customer reviews'],
      used_caption_fallback: true,
    };
    const productName = String(parsed.product_name || '').trim();
    const productDetails = {
      name: productName,
      brand: null,
      category: parsed.category || null,
      retailer: null,
      price: null,
      rating: null,
      review_count: null,
      description: 'Product name taken from your caption because the photo was too large to analyze.',
      features: parsed.visual_cues.slice(0, 6),
      image: null,
      source: 'caption',
      identification_confidence: 50,
      product_explanation: productName + ' — identified from your caption.',
    };
    return [{
      json: {
        ...item,
        text_query: productName,
        identification_source: 'caption',
        review_context: productDetails.product_explanation,
        product_details: productDetails,
        product: {
          product_name: productName.slice(0, 200),
          brand: null,
          category: 'product',
          model_variant: null,
          confidence: 50,
          visual_cues: parsed.visual_cues,
          search_queries: parsed.search_queries,
        },
      },
    }];
  }
  return visionHelpReply(item, '📷 Image is too large to analyze quickly. Resend a smaller photo or add a caption with the product name (e.g. "Mercedes A-Class reviews").');
}

async function identifyFromImage(model, maxTokens, useJsonFormat, reqTimeout) {
  const body = {
    model,
    temperature: 0.1,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  };
  if (useJsonFormat) body.response_format = { type: 'json_object' };
  return this.helpers.httpRequest({
    method: 'POST',
    url: chatCompletionsUrl(apiKey),
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'X-Title': 'Customer Review Responder',
    },
    body,
    json: true,
    timeout: reqTimeout || 15000,
  });
}

let response = null;
let parsed = null;
let visionModelUsed = null;
let rateLimitRetries = 0;
const visionAttempts = [
  { useJson: true, maxTokens: 400, timeout: 18000 },
  { useJson: false, maxTokens: 300, timeout: 15000 },
];
const visionModels = [
  normalizeChatModel(primaryModel, apiKey),
  normalizeChatModel('gpt-4o-mini', apiKey),
].filter((m, i, arr) => m && arr.indexOf(m) === i);
if (isOpenRouterKey(apiKey)) visionModels.push('openrouter/free');

outer: for (const visionModel of visionModels) {
for (const attempt of visionAttempts) {
  try {
    response = await identifyFromImage.call(this, visionModel, attempt.maxTokens, attempt.useJson, attempt.timeout);
    const apiErr = response?.error;
    if (apiErr) {
      const errMsg = String(apiErr.message || apiErr.code || '');
      if (/429|rate.limit/i.test(errMsg)) {
        rateLimitRetries += 1;
        if (rateLimitRetries < 2) await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      continue;
    }
    parsed = parseVisionResult(response.choices?.[0]?.message?.content);
    if (parsed?.product_name) {
      visionModelUsed = visionModel;
      break outer;
    }
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('401')) throw new Error('AI 401: invalid API key for vision.');
    if (/429|rate.limit/i.test(msg)) {
      rateLimitRetries += 1;
      if (rateLimitRetries < 2) await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
  }
}
}

parsed = parsed || {};
if (!parsed.product_name) {
  const fallbackName = captionFallbackName;
  if (fallbackName && fallbackName.length >= 3) {
    parsed = {
      product_name: fallbackName,
      brand: null,
      category: 'product',
      confidence: 45,
      visual_cues: ['Identified from your caption'],
      search_queries: [fallbackName + ' customer reviews'],
      used_caption_fallback: true,
    };
  } else if ((parsed.visual_cues || []).length) {
    parsed.product_name = ((parsed.category ? parsed.category + ' ' : '') + parsed.visual_cues.slice(0, 3).join(' ')).trim();
    parsed.confidence = Number(parsed.confidence || 35);
  } else {
    const helpText = rateLimitRetries >= 2
      ? '📷 Photo recognition is temporarily busy. Resend your image with a caption naming the product (e.g. "Mercedes A-Class reviews") — that works instantly.'
      : '📷 I could not identify the product from your photo. Resend with a caption naming the product (e.g. "Mercedes A-Class reviews").';
    return visionHelpReply(item, helpText);
  }
}

const productName = String(parsed.product_name || '').trim();
const brand = parsed.brand || null;
const visualCues = (parsed.visual_cues || []).map((x) => String(x).trim()).filter(Boolean);
const searchQueries = [...new Set([
  ...(parsed.search_queries || []),
  productName + ' customer reviews',
  productName + ' reviews',
  (brand ? brand + ' ' : '') + productName + ' review',
  productName + ' buyer feedback',
].map((q) => String(q).trim()).filter(Boolean))].slice(0, 5);

const productDetails = {
  name: productName,
  brand,
  category: parsed.category || null,
  retailer: null,
  price: null,
  rating: null,
  review_count: null,
  description: visualCues.join('; ').slice(0, 500) || null,
  features: visualCues.slice(0, 6),
  image: imageUrl.startsWith('data:') ? null : imageUrl,
  source: 'image',
  identification_confidence: Number(parsed.confidence || 75),
  product_explanation: buildVisionExplanation(parsed),
  vision_model: visionModelUsed || primaryModel,
};

return [{
  json: {
    ...item,
    text_query: productName,
    identification_source: 'vision',
    review_context: productDetails.product_explanation,
    product_details: productDetails,
    product: {
      product_name: productName.slice(0, 200),
      brand,
      category: String(parsed.category || 'product').trim(),
      model_variant: parsed.model_variant || null,
      confidence: Number(parsed.confidence || 75),
      visual_cues: visualCues,
      search_queries: searchQueries,
    },
  },
}];`;

const IDENTIFY_PRODUCT_TEXT = `function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\\s+/i, '');
}
${AI_CHAT_HELPERS}

const item = $input.first().json;

if (item.product_name) {
  const q = item.product_name + (item.brand ? ' ' + item.brand : '');
  return [{
    json: {
      ...item,
      identification_source: 'explicit',
      product: {
        product_name: item.product_name,
        brand: item.brand || null,
        category: item.category || '',
        model_variant: null,
        confidence: 100,
        visual_cues: [],
        search_queries: [
          item.product_name + ' reviews',
          item.product_name + ' customer reviews',
          (item.brand ? item.brand + ' ' : '') + item.product_name + ' reddit',
        ].filter(Boolean),
      },
    },
  }];
}

const apiKey = cleanKey(item.openrouter_api_key);
const model = normalizeChatModel(item.openrouter_model || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL || 'gpt-4o-mini', apiKey);
const query = item.text_query || item.review_context;
if (!query) throw new Error('Identify Product: missing text_query or product_name.');

const systemPrompt = 'JSON only: product_name, brand, category, confidence, search_queries(2-3 strings).';
const userPrompt = query;

async function identifyOnce(maxTokens) {
  return this.helpers.httpRequest({
    method: 'POST',
    url: chatCompletionsUrl(apiKey),
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'X-Title': 'Customer Review Responder',
    },
    body: {
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
    json: true,
    timeout: 60000,
  });
}

let response = null;
let lastErr = null;
for (const maxTokens of [80, 60, 40]) {
  try {
    response = await identifyOnce.call(this, maxTokens);
    break;
  } catch (err) {
    lastErr = err;
    const msg = String(err.message || err);
    if (!msg.includes('402')) throw err;
  }
}
let parsed = null;
if (response) {
  try {
    const raw = response.choices?.[0]?.message?.content;
    if (raw) parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {}
}

if (!parsed) {
  const msg = String(lastErr?.message || lastErr || '');
  if (msg.includes('401')) throw new Error('OpenRouter 401: invalid API key.');
  parsed = {
    product_name: query,
    brand: null,
    category: 'topic',
    model_variant: null,
    confidence: 60,
    search_queries: [query, query + ' reviews', query + ' opinions'],
  };
}

return [{
  json: {
    ...item,
    identification_source: parsed.confidence >= 70 ? 'text' : 'text_fallback',
    product: {
      product_name: String(parsed.product_name || query).trim(),
      brand: parsed.brand || null,
      category: String(parsed.category || '').trim(),
      model_variant: parsed.model_variant || null,
      confidence: Number(parsed.confidence || 60),
      visual_cues: [],
      search_queries: parsed.search_queries || [query + ' reviews'],
    },
  },
}];`;

const SEARCH_AGENT = `const item = $input.first().json;
const product = item.product || {};
const name = String(product.product_name || '').trim();
if (!name) throw new Error('Search Agent: missing product_name after identification.');

function isBlockedProductName(n) {
  return /^(access denied|robot check|sorry!?|page not found|forbidden|amazon\\.in|amazon\\.com)$/i.test(String(n || '').trim());
}

const serperKey = String(item.serper_api_key || '').trim();
const sources = new Set((item.search_sources || []).map((s) => String(s).toLowerCase()));
const limit = Math.min(Math.max(Number(item.max_results_per_source || 5), 1), 10);
const rawQuery = String(item.text_query || '').trim();
const pd = item.product_details || {};

function isBadQuery(q) {
  const s = String(q || '').trim();
  return !s || /^access denied\\b/i.test(s) || /^robot check\\b/i.test(s);
}

const queries = [...new Set([
  ...(rawQuery && !isBlockedProductName(rawQuery) ? [rawQuery] : []),
  ...(product.search_queries || []),
  isBlockedProductName(name) ? null : name + ' reviews',
  isBlockedProductName(name) ? null : name + ' customer reviews',
  isBlockedProductName(name) ? null : (product.brand ? product.brand + ' ' : '') + name + ' review',
  (pd.store_host && !isBlockedProductName(name))
    ? name.split(' ').slice(0, 6).join(' ') + ' site:' + pd.store_host + ' reviews'
    : null,
  (pd.retailer && /amazon/i.test(pd.retailer) && !isBlockedProductName(name))
    ? name.split(' ').slice(0, 6).join(' ') + ' site:amazon.in reviews'
    : null,
  (pd.retailer && /flipkart/i.test(pd.retailer) && !isBlockedProductName(name))
    ? name.split(' ').slice(0, 6).join(' ') + ' site:flipkart.com reviews'
    : null,
].map((q) => String(q || '').trim()).filter((q) => q && !isBadQuery(q)))].slice(0, 6);

if (!queries.length) {
  throw new Error('Could not identify product from link (store blocked access). Send the product name as text, e.g. Dettol disinfectant 1L reviews');
}

function pickPrimaryQuery(allQueries, raw, subject) {
  const reviewQuery = allQueries.find((q) => /review|opinion|rating|feedback|complaint/i.test(q));
  if (reviewQuery) return reviewQuery;
  const bare = String(raw || subject || '').trim();
  if (bare && bare.split(/\\s+/).length <= 3 && !/review|opinion|rating/i.test(bare)) {
    return bare + ' reviews and opinions';
  }
  return allQueries[0] || (subject + ' reviews');
}

const primaryQuery = pickPrimaryQuery(queries, rawQuery, name);
let serperValid = Boolean(serperKey);

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
}

function parseDdgHtml(html) {
  const results = [];
  const blocks = String(html || '').split(/result__body/i).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    let link = '';
    let title = '';
    const directM = block.match(/class="result__a"[^>]*href="(https?:\\/\\/[^"]+)"[^>]*>([^<]+)<\\/a>/i);
    const uddgM = block.match(/class="result__a"[^>]*href="[^"]*uddg=([^"&]+)"[^>]*>([\\s\\S]*?)<\\/a>/i);
    if (directM) {
      link = directM[1];
      title = decodeHtml(directM[2]);
    } else if (uddgM) {
      link = uddgM[1];
      try { link = decodeURIComponent(link); } catch (e) {}
      title = decodeHtml(uddgM[2]);
    }
    const snipM = block.match(/class="result__snippet"[^>]*>([\\s\\S]*?)<\\/a>/i);
    const snippet = snipM ? decodeHtml(snipM[1]) : '';
    if (title) results.push({ title, snippet, link, source: '' });
  }
  return results;
}

async function duckDuckGoSearch(query) {
  try {
    const raw = await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://html.duckduckgo.com/html/',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CustomerReviewResponder/1.0)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'q=' + encodeURIComponent(query) + '&b=',
      timeout: 20000,
    });
    const html = typeof raw === 'string' ? raw : (raw?.body || raw?.data || String(raw || ''));
    return parseDdgHtml(html);
  } catch (err) {
    return [];
  }
}

async function serperSearch(query, type) {
  if (!serperKey) return { ok: false, error: 'Missing serper_api_key', results: [] };
  const url = type === 'news' ? 'https://google.serper.dev/news' : 'https://google.serper.dev/search';
  try {
    const resp = await this.helpers.httpRequest({
      method: 'POST',
      url,
      headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: { q: query, num: limit },
      json: true,
      timeout: 15000,
    });
    const items = type === 'news' ? (resp.news || []) : (resp.organic || []);
    return {
      ok: true,
      query,
      provider: 'serper',
      results: items.slice(0, limit).map((r) => ({
        title: r.title || '',
        snippet: r.snippet || r.description || '',
        link: r.link || r.url || '',
        source: r.source || '',
        date: r.date || null,
      })),
    };
  } catch (err) {
    const msg = String(err.message || err);
    if (/403|401|Unauthorized/i.test(msg)) serperValid = false;
    return { ok: false, query, error: msg.slice(0, 200), results: [] };
  }
}

async function webSearch(query, label, opts) {
  const site = opts?.site || '';
  const type = opts?.type || 'search';
  const q = site ? ('site:' + site + ' ' + query) : query;
  let serperResult = null;

  if (serperKey && serperValid) {
    serperResult = await serperSearch.call(this, q, type);
    if (serperResult.ok && serperResult.results.length) {
      return { ...serperResult, source: label, site: site || null };
    }
  }

  const ddgQuery = type === 'news' ? (query + ' news') : q;
  const ddgResults = await duckDuckGoSearch.call(this, ddgQuery);
  return {
    ok: ddgResults.length > 0,
    source: label,
    query: ddgQuery,
    provider: ddgResults.length ? 'duckduckgo' : (serperResult?.provider || 'none'),
    site: site || null,
    serper_error: serperResult?.error || (serperKey && !serperValid ? 'Serper unauthorized — using DuckDuckGo fallback' : null),
    results: ddgResults,
  };
}

async function redditSearch() {
  try {
    const resp = await this.helpers.httpRequest({
      method: 'GET',
      url: 'https://api.pullpush.io/reddit/search/submission/?q=' + encodeURIComponent(primaryQuery) + '&size=' + limit + '&sort=desc&sort_type=score',
      headers: { 'User-Agent': 'CustomerReviewResponder/1.0' },
      json: true,
      timeout: 25000,
    });
    const posts = resp?.data || [];
    if (posts.length) {
      return {
        ok: true,
        source: 'reddit',
        query: primaryQuery,
        provider: 'pullpush',
        results: posts.slice(0, limit).map((p) => ({
          title: p.title || '',
          snippet: (p.selftext || '').slice(0, 400),
          link: p.url || ('https://reddit.com' + (p.permalink || '')),
          source: 'reddit/' + (p.subreddit || ''),
          score: p.score,
          num_comments: p.num_comments,
        })),
      };
    }
  } catch (err) {}

  const ddgResults = await duckDuckGoSearch.call(this, 'site:reddit.com ' + primaryQuery);
  return {
    ok: ddgResults.length > 0,
    source: 'reddit',
    query: primaryQuery,
    provider: 'duckduckgo',
    results: ddgResults,
  };
}

const tasks = [];
if (sources.has('google')) tasks.push(webSearch.call(this, primaryQuery, 'google', {}));
if (sources.has('news')) tasks.push(webSearch.call(this, primaryQuery, 'news', { type: 'news' }));
if (sources.has('reddit')) tasks.push(redditSearch.call(this));
if (sources.has('twitter')) tasks.push(webSearch.call(this, primaryQuery, 'twitter', { site: 'x.com' }));
if (sources.has('youtube')) tasks.push(webSearch.call(this, primaryQuery, 'youtube', { site: 'youtube.com' }));
if (sources.has('amazon')) tasks.push(webSearch.call(this, primaryQuery, 'amazon', { site: 'amazon.com' }));
if (sources.has('flipkart')) tasks.push(webSearch.call(this, primaryQuery, 'flipkart', { site: 'flipkart.com' }));
if (sources.has('linkedin')) tasks.push(webSearch.call(this, primaryQuery, 'linkedin', { site: 'linkedin.com' }));
if (sources.has('forums')) tasks.push(webSearch.call(this, primaryQuery, 'forums', { site: 'trustpilot.com' }));

const settled = await Promise.allSettled(tasks);
const searchResults = settled.map((s, i) => {
  if (s.status === 'fulfilled') return s.value;
  return { ok: false, source: 'unknown_' + i, error: String(s.reason?.message || s.reason).slice(0, 200), results: [] };
});

let totalHits = searchResults.reduce((n, r) => n + (r.results?.length || 0), 0);

if (totalHits === 0) {
  const fallback = await webSearch.call(this, primaryQuery, 'google_fallback', {});
  if (fallback.results?.length) {
    searchResults.push(fallback);
    totalHits = fallback.results.length;
  }
}

const searchErrors = searchResults
  .filter((r) => r.serper_error || (!r.ok && r.error))
  .map((r) => ({ source: r.source, error: r.serper_error || r.error }));

return [{
  json: {
    ...item,
    search: {
      primary_query: primaryQuery,
      all_queries: queries,
      serper_enabled: Boolean(serperKey),
      serper_valid: serperValid,
      fallback_used: searchResults.some((r) => r.provider === 'duckduckgo' || r.provider === 'pullpush'),
      search_errors: searchErrors,
      sources_requested: [...sources],
      results_by_source: searchResults,
      total_results: totalHits,
      searched_at: new Date().toISOString(),
    },
  },
}];`;

const COLLECT_DATA = `const item = $input.first().json;
const blocks = item.search?.results_by_source || [];

const snippets = [];
for (const block of blocks) {
  for (const r of block.results || []) {
    snippets.push({
      source: block.source || 'unknown',
      title: r.title || '',
      snippet: r.snippet || '',
      link: r.link || '',
      meta: {
        site: r.source || block.site || null,
        date: r.date || null,
        score: r.score ?? null,
        num_comments: r.num_comments ?? null,
      },
    });
  }
}

const bySource = {};
for (const s of snippets) {
  bySource[s.source] = bySource[s.source] || [];
  bySource[s.source].push(s);
}

return [{
  json: {
    ...item,
    collected: {
      snippet_count: snippets.length,
      snippets: snippets.slice(0, 60),
      by_source: bySource,
      source_counts: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.length])),
    },
  },
}];`;

const AI_ANALYZER = `function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\\s+/i, '');
}
${AI_CHAT_HELPERS}
function cleanLine(text) {
  return String(text || '').replace(/\\s+/g, ' ').trim();
}

function looksLikeTitle(line) {
  return /^[A-Z0-9][^.!?]{0,120}(\\.{3}|\\?|:|$)/.test(line) && line.split(' ').length < 14;
}

function bestInsight(s) {
  const snip = cleanLine(s.snippet);
  if (snip.length >= 30) {
    const parts = snip.split(/[.!?]+/).map(cleanLine).filter((x) => x.length >= 25 && !looksLikeTitle(x));
    if (parts.length) return parts[0].slice(0, 160);
    return snip.slice(0, 160);
  }
  const title = cleanLine(s.title);
  return title.length >= 20 ? title.slice(0, 160) : '';
}

function localAnalyze(snippets, productName) {
  const POS = /\\b(excellent|outstanding|great|good|love|best|amazing|comfortable|recommend|worth|impressive|superb|fantastic|solid|premium|clear|powerful|reliable|sleek|lightweight|comfort|noise cancellation|anc|sound quality|battery)\\b/i;
  const NEG = /\\b(bad|poor|expensive|overpriced|disappoint|issue|problem|complaint|uncomfortable|not worth|concern|weak|bulky|cheap|break|fail|durability|hot|warm|heavy|flaw|returned|refund|overhyped)\\b/i;

  const praise = [];
  const complaints = [];
  const seenP = new Set();
  const seenC = new Set();
  let posScore = 0;
  let negScore = 0;

  for (const s of snippets.slice(0, 24)) {
    const blob = cleanLine((s.title || '') + ' ' + (s.snippet || ''));
    if (!blob) continue;
    const posHits = (blob.match(POS) || []).length;
    const negHits = (blob.match(NEG) || []).length;
    posScore += posHits;
    negScore += negHits;

    const line = bestInsight(s);
    if (!line || line.length < 28 || /^[+-]\\s/.test(line)) continue;

    if (posHits > 0 && posHits >= negHits && !seenP.has(line)) {
      seenP.add(line);
      praise.push(line);
      continue;
    }
    if (negHits > 0 && !seenC.has(line) && !seenP.has(line)) {
      seenC.add(line);
      complaints.push(line);
    }
  }

  const total = posScore + negScore;
  let sentiment = 'mixed';
  let score = 55;
  if (total > 0) {
    score = Math.min(95, Math.max(15, Math.round((posScore / total) * 100)));
    if (score >= 68) sentiment = 'positive';
    else if (score <= 38) sentiment = 'negative';
  } else if (praise.length > complaints.length * 2) {
    sentiment = 'positive';
    score = 72;
  } else if (complaints.length > praise.length * 2) {
    sentiment = 'negative';
    score = 32;
  }

  const rating = score >= 78 ? 4.5 : score >= 65 ? 4 : score >= 50 ? 3.5 : score >= 35 ? 3 : 2.5;
  const name = productName || 'this product';
  const topPraise = praise[0] || '';
  const topComplaint = complaints.find((c) => c !== topPraise) || complaints[0] || '';

  let summary = '';
  if (topPraise && topComplaint) {
    summary = 'Customer feedback on ' + name + ' is ' + sentiment + '. Buyers praise ' + topPraise.toLowerCase().replace(/\\.$/, '') + ', though some report ' + topComplaint.toLowerCase().replace(/\\.$/, '') + '.';
  } else if (topPraise) {
    summary = 'Customer feedback on ' + name + ' is predominantly positive across ' + snippets.length + ' sources, especially regarding ' + topPraise.toLowerCase().replace(/\\.$/, '') + '.';
  } else if (topComplaint) {
    summary = 'Customer feedback on ' + name + ' raises concerns, particularly about ' + topComplaint.toLowerCase().replace(/\\.$/, '') + '.';
  } else {
    summary = 'Based on ' + snippets.length + ' review sources, overall sentiment for ' + name + ' appears ' + sentiment + '.';
  }

  const buyer = score >= 68
    ? 'Recommended for most buyers — strengths outweigh reported drawbacks for typical use.'
    : score <= 38
    ? 'Consider alternatives unless the noted strengths specifically match your priorities.'
    : 'Worth considering if the praised features matter to you — review complaints before buying.';

  return {
    overall_sentiment: sentiment,
    sentiment_score: score,
    estimated_rating: Math.round(rating * 2) / 2,
    summary,
    top_praise: praise.slice(0, 5),
    top_complaints: complaints.slice(0, 5),
    buyer_recommendation: buyer,
    suggested_responses: [],
    data_quality: { coverage: snippets.length >= 15 ? 'good' : 'moderate', confidence: Math.min(80, 45 + Math.min(snippets.length, 20)), gaps: [] },
    key_quotes: snippets.slice(0, 3).filter((s) => cleanLine(s.snippet)).map((s) => ({
      text: cleanLine(s.snippet).slice(0, 120),
      source: s.source || 'web',
      sentiment: POS.test(s.snippet) && !NEG.test(s.snippet) ? 'positive' : NEG.test(s.snippet) ? 'negative' : 'neutral',
    })),
    analysis_method: 'snippet_intelligence',
  };
}

function parseJsonLoose(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  let s = String(raw).trim();
  try { return JSON.parse(s); } catch (e) {}
  const BT = String.fromCharCode(96);
  s = s.replace(new RegExp(BT + BT + BT + 'json', 'gi'), '').replace(new RegExp(BT + BT + BT, 'g'), '').trim();
  try { return JSON.parse(s); } catch (e) {}
  const start = s.indexOf('{');
  if (start >= 0) {
    s = s.slice(start);
    for (const suffix of ['', '}', '"}', '"]}', 'null]}', '"]}']) {
      try { return JSON.parse(s + suffix); } catch (e2) {}
    }
  }
  return null;
}

function normalizeAnalysis(a) {
  if (!a || typeof a !== 'object') return null;
  const out = { ...a };
  let score = Number(out.sentiment_score);
  if (Number.isFinite(score) && score > 0 && score <= 1) score = Math.round(score * 100);
  if (!Number.isFinite(score)) score = 55;
  out.sentiment_score = Math.min(100, Math.max(0, Math.round(score)));
  if (!out.overall_sentiment) {
    out.overall_sentiment = out.sentiment_score >= 68 ? 'positive' : out.sentiment_score <= 38 ? 'negative' : 'mixed';
  }
  out.top_praise = (out.top_praise || []).map(cleanLine).filter((x) => x && !looksLikeTitle(x)).slice(0, 5);
  out.top_complaints = (out.top_complaints || []).map(cleanLine).filter(Boolean).slice(0, 5);
  out.summary = cleanLine(out.summary);
  out.buyer_recommendation = cleanLine(out.buyer_recommendation);
  return out;
}

function mergeAnalysis(ai, local) {
  const a = normalizeAnalysis(ai) || {};
  const l = local || {};
  const praise = (a.top_praise && a.top_praise.length) ? a.top_praise : l.top_praise;
  const complaints = (a.top_complaints && a.top_complaints.length) ? a.top_complaints : l.top_complaints;
  return {
    overall_sentiment: a.overall_sentiment || l.overall_sentiment,
    sentiment_score: a.sentiment_score ?? l.sentiment_score,
    estimated_rating: a.estimated_rating ?? l.estimated_rating,
    summary: (a.summary && a.summary.length > 40) ? a.summary : l.summary,
    top_praise: praise || [],
    top_complaints: complaints || [],
    buyer_recommendation: (a.buyer_recommendation && a.buyer_recommendation.length > 20) ? a.buyer_recommendation : l.buyer_recommendation,
    suggested_responses: a.suggested_responses || l.suggested_responses || [],
    data_quality: a.data_quality || l.data_quality,
    key_quotes: (a.key_quotes && a.key_quotes.length) ? a.key_quotes : l.key_quotes,
    analysis_method: a.analysis_method || (a.summary ? 'ai+snippets' : l.analysis_method),
  };
}

const item = $input.first().json;
const apiKey = cleanKey(item.openrouter_api_key);
const model = normalizeChatModel(item.openrouter_model || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL || 'gpt-4o-mini', apiKey);
const product = item.product || {};
const snippets = item.collected?.snippets || [];
const subject = product.product_name || item.text_query || 'Unknown';

const local = localAnalyze(snippets, subject);

const systemPrompt = 'Review analyst. JSON only: overall_sentiment, sentiment_score(0-100), estimated_rating, summary, top_praise[], top_complaints[], buyer_recommendation.';

function buildCompactPrompt(limit) {
  const ctx = snippets.slice(0, limit).map((s, i) => (
    '[' + (i + 1) + '] ' + cleanLine(String(s.snippet || s.title || '')).slice(0, 130)
  )).join('\\n');
  const pageInfo = String(item.review_context || item.product_details?.description || '').slice(0, 350);
  return 'Product: ' + subject + (pageInfo ? '\\nPage info: ' + pageInfo : '') + '\\nReview excerpts:\\n' + ctx;
}

async function analyzeOnce(maxTokens, snippetLimit) {
  return this.helpers.httpRequest({
    method: 'POST',
    url: chatCompletionsUrl(apiKey),
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'X-Title': 'Customer Review Responder',
    },
    body: {
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildCompactPrompt(snippetLimit) },
      ],
    },
    json: true,
    timeout: 90000,
  });
}

let response = null;
let aiParsed = null;
for (const attempt of [{ max: 100, n: 4 }, { max: 80, n: 3 }, { max: 60, n: 2 }]) {
  try {
    response = await analyzeOnce.call(this, attempt.max, attempt.n);
    aiParsed = parseJsonLoose(response.choices?.[0]?.message?.content);
    if (aiParsed && aiParsed.summary) break;
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes('401')) throw new Error('OpenRouter 401: invalid API key.');
    if (!msg.includes('402')) break;
  }
}

const analysis = mergeAnalysis(aiParsed, local);

return [{
  json: {
    ...item,
    analysis: {
      ...analysis,
      model: (response && response.model) || model,
      analyzed_at: new Date().toISOString(),
    },
  },
}];`;

const GENERATE_REPORT = `const item = $input.first().json;
const p = item.product || {};
const a = item.analysis || {};
const pd = item.product_details || {};
const search = item.search || {};
const collected = item.collected || {};

function bullet(arr) {
  return (arr || []).map((x) => '• ' + x).join('\\n') || '• None noted';
}

function fmtResponses(arr) {
  return (arr || []).map((r) => '▸ ' + (r.scenario || 'General') + '\\n  ' + (r.response || '')).join('\\n\\n') || '• None generated';
}

const fromImage = item.identification_source === 'vision' || pd.source === 'image';
const fromLink = Boolean(pd.source_url);
const detailHeading = fromImage ? '## Product Details (from photo)' : '## Product Details (from link)';

const productDetailMd = pd.name ? [
  '## About This Product',
  pd.product_explanation || pd.description || '',
  '',
  detailHeading,
  fromImage ? '**Identified from:** customer photo' + (pd.identification_confidence ? ' (confidence: ' + pd.identification_confidence + '%)' : '') : '',
  pd.retailer ? '**Store:** ' + pd.retailer : '',
  pd.price ? '**Price:** ' + pd.price : '',
  pd.rating ? '**Store rating:** ' + pd.rating + (pd.review_count ? ' (' + pd.review_count + ' reviews)' : '') : '',
  pd.description && pd.product_explanation && pd.description !== pd.product_explanation ? '**Visible details:** ' + pd.description : '',
  pd.features?.length ? '**Features / cues:**\\n' + bullet(pd.features.slice(0, 6)) : '',
  pd.source_url ? '**Link:** ' + pd.source_url : '',
].filter(Boolean).join('\\n') : '';

const reportMarkdown = [
  '# Customer Review Report',
  '',
  '**Product:** ' + (p.product_name || 'Unknown'),
  '**Brand:** ' + (p.brand || 'N/A'),
  '**Category:** ' + (p.category || 'N/A'),
  '**Generated:** ' + new Date().toISOString(),
  '',
  productDetailMd,
  productDetailMd ? '' : null,
  '## Customer Review Analysis',
  a.summary || 'No summary available.',
  '',
  '## Sentiment Overview',
  '- Overall: **' + (a.overall_sentiment || 'unknown') + '**',
  '- Sentiment score: **' + (a.sentiment_score ?? 'N/A') + '/100**',
  '- Est. rating: **' + (a.estimated_rating ?? 'N/A') + '/5**',
  '',
  '## Top Praise',
  bullet(a.top_praise),
  '',
  '## Top Complaints',
  bullet(a.top_complaints),
  '',
  '## Buyer Recommendation',
  a.buyer_recommendation || 'Insufficient data.',
  '',
  '## Suggested Review Responses',
  fmtResponses(a.suggested_responses),
  '',
  '## Data Coverage',
  '- Reviews analyzed from ' + Object.keys(collected.source_counts || {}).length + ' platforms',
  '',
  '## Key Quotes',
  ...(a.key_quotes || []).slice(0, 5).map((q) => '> \"' + (q.text || '') + '\" — _' + (q.source || '') + '_ (' + (q.sentiment || '') + ')'),
].filter(Boolean).join('\\n');

const detailTg = pd.name ? [
  fromImage ? '📷 Identified from Photo' : '📦 About This Product',
  pd.product_explanation ? '📖 ' + pd.product_explanation.slice(0, 480) : (pd.description ? 'ℹ️ ' + pd.description.slice(0, 320) : ''),
  pd.retailer ? '🏪 ' + pd.retailer : '',
  pd.price ? '💰 ' + pd.price : '',
  pd.rating ? '⭐ Store: ' + pd.rating + (pd.review_count ? ' · ' + pd.review_count + ' reviews' : '') : '',
  ...(pd.features || []).slice(0, 3).map((f) => '• ' + f),
  '',
].filter(Boolean) : [];

const tg = [
  '📊 Customer Review Report',
  '',
  '🛍 ' + (p.product_name || 'Topic'),
  p.brand ? '🏷 ' + p.brand : '',
  fromImage && !pd.name ? '📷 Product identified from your photo' : '',
  '',
  ...detailTg,
  '─── Reviews & Opinions ───',
  '📈 Sentiment: ' + (a.overall_sentiment || 'unknown') + ' (' + (a.sentiment_score ?? '?') + '/100)',
  '⭐ Est. rating: ' + (a.estimated_rating ?? 'N/A') + '/5',
  '',
  '📝 ' + (a.summary || '').slice(0, 500),
  '',
  '👍 Praise:',
  ...((a.top_praise || []).slice(0, 3).map((x) => '• ' + x)),
  '',
  '👎 Complaints:',
  ...((a.top_complaints || []).slice(0, 3).map((x) => '• ' + x)),
  ...(a.top_complaints && a.top_complaints.length ? [] : ['• None widely reported']),
  '',
  '💡 ' + (a.buyer_recommendation || '').slice(0, 300),
].filter(Boolean).join('\\n');

return [{
  json: {
    ...item,
    report: {
      markdown: reportMarkdown,
      generated_at: new Date().toISOString(),
    },
    telegram_text: tg.slice(0, 4000),
  },
}];`;

const SEND_TELEGRAM = `const item = $input.first().json;
const token = String(item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').trim();
const chatId = String(item.telegram_chat_id || $env.TELEGRAM_CHAT_ID || '').trim();
const text = String(item.telegram_text || '').trim();

if (!token || !chatId) {
  return [{ json: { ...item, telegram_sent: false, telegram_error: 'Missing telegram_bot_token or telegram_chat_id' } }];
}
if (!text) {
  return [{ json: { ...item, telegram_sent: false, telegram_error: 'Empty telegram message' } }];
}

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.telegram.org/bot' + token + '/sendMessage',
    body: { chat_id: chatId, text: text.slice(0, 4000) },
    json: true,
    timeout: 30000,
  });
  return [{ json: { ...item, telegram_sent: true, telegram_error: null } }];
} catch (err) {
  return [{ json: { ...item, telegram_sent: false, telegram_error: String(err.message || err).slice(0, 300) } }];
}`;

const RETURN_RESULT = `const item = $input.first().json;
return [{
  json: {
    success: true,
    run_id: item.run_id,
    identification_source: item.identification_source || null,
    product: item.product,
    product_details: item.product_details || null,
    product_url: item.product_url || null,
    analysis: {
      overall_sentiment: item.analysis?.overall_sentiment,
      sentiment_score: item.analysis?.sentiment_score,
      estimated_rating: item.analysis?.estimated_rating,
      summary: item.analysis?.summary,
      top_praise: item.analysis?.top_praise,
      top_complaints: item.analysis?.top_complaints,
      buyer_recommendation: item.analysis?.buyer_recommendation,
      suggested_responses: item.analysis?.suggested_responses,
    },
    search: {
      total_results: item.search?.total_results,
      source_counts: item.collected?.source_counts,
    },
    report_markdown: item.report?.markdown,
    telegram_text: item.telegram_text || null,
    report_saved: false,
    notifications: {
      telegram: Boolean(item.notify_telegram),
      telegram_sent: item.telegram_sent === true,
      telegram_error: item.telegram_error || null,
    },
    completed_at: new Date().toISOString(),
  },
}];`;

const SAMPLE_CONFIG = JSON.stringify({
  text_query: 'Samsung Galaxy S24 Ultra customer reviews',
  notify_telegram: false,
  search_sources: ['google', 'news', 'reddit', 'twitter', 'youtube', 'amazon', 'flipkart', 'linkedin', 'forums'],
  max_results_per_source: 5,
}, null, 2);

function codeNode(id, name, pos, jsCode) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: pos,
    parameters: { jsCode },
  };
}

function ifNode(id, name, pos, leftValue, rightValue, operation = 'true') {
  return {
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: pos,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: id + '-cond',
          leftValue: '={{ ' + leftValue + ' }}',
          rightValue,
          operator: { type: operation === 'notEmpty' ? 'string' : 'boolean', operation },
        }],
        combinator: 'and',
      },
    },
  };
}

const workflow = {
  name: 'Customer Review Responder',
  nodes: [
    {
      id: 'c3000000-0001-4000-8000-000000000001',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-1500, 0],
      parameters: {
        httpMethod: 'POST',
        path: 'customer-review-responder',
        responseMode: 'lastNode',
        options: {},
      },
      webhookId: 'customer-review-responder-webhook',
    },
    {
      id: 'c3000000-0002-4000-8000-000000000002',
      name: 'Telegram Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-1500, 200],
      parameters: {
        httpMethod: 'POST',
        path: 'customer-review-responder-telegram',
        responseMode: 'lastNode',
        options: {},
      },
      webhookId: 'customer-review-responder-telegram',
    },
    {
      id: 'c3000000-0003-4000-8000-000000000003',
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [-1500, 400],
    },
    {
      id: 'c3000000-0004-4000-8000-000000000004',
      name: 'Set: Sample Input',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-1260, 400],
      parameters: { mode: 'raw', jsonOutput: SAMPLE_CONFIG, options: {} },
    },
    codeNode('c3000000-0005-4000-8000-000000000005', 'Adapt Telegram Payload', [-1260, 200], ADAPT_TELEGRAM),
    codeNode('c3000000-0007-4000-8000-000000000007', 'Normalize Input', [-1020, 200], NORMALIZE_INPUT),
    ifNode('c3000000-0008-4000-8000-000000000008', 'IF Telegram Skip?', [-780, 200], 'Boolean($json.telegram_skip || $json.action === "telegram_reply")', true),
    codeNode('c3000000-0009-4000-8000-000000000009', 'Validate Input', [-300, 200], VALIDATE_INPUT),
    ifNode('c3000000-0010-4000-8000-000000000010', 'IF Has Image?', [-60, 200], 'Boolean($json.image_url || $json.image_base64)', true),
    ifNode('c3000000-0013-4000-8000-000000000013', 'IF Has URL?', [180, 320], 'Boolean(($json.product_url || "").trim())', true),
    codeNode('c3000000-0011-4000-8000-000000000011', 'Vision AI', [180, 80], VISION_AI),
    ifNode('c3000000-0011-4000-8000-00000000001b', 'IF Vision Reply?', [300, 80], '$json.action === "telegram_reply"', true),
    codeNode('c3000000-0012-4000-8000-000000000012', 'Fetch Product URL', [420, 320], FETCH_PRODUCT_URL),
    codeNode('c3000000-0012-4000-8000-00000000001a', 'Identify Product (Text)', [420, 480], IDENTIFY_PRODUCT_TEXT),
    codeNode('c3000000-0014-4000-8000-000000000014', 'Search Agent', [420, 200], SEARCH_AGENT),
    codeNode('c3000000-0015-4000-8000-000000000015', 'Collect Data', [660, 200], COLLECT_DATA),
    codeNode('c3000000-0016-4000-8000-000000000016', 'AI Analyzer', [900, 200], AI_ANALYZER),
    codeNode('c3000000-0017-4000-8000-000000000017', 'Generate Report', [1140, 200], GENERATE_REPORT),
    {
      id: 'c3000000-0019-4000-8000-000000000019',
      name: 'Notify Telegram?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1380, 200],
      parameters: {
        conditions: {
          boolean: [
            { value1: '={{ $json.notify_telegram }}', value2: true },
          ],
          string: [
            { value1: '={{ ($json.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || "").trim() }}', operation: 'notEmpty' },
            { value1: '={{ ($json.telegram_chat_id || $env.TELEGRAM_CHAT_ID || "").trim() }}', operation: 'notEmpty' },
          ],
        },
        combineOperation: 'all',
      },
    },
    codeNode('c3000000-0020-4000-8000-000000000020', 'Send Telegram', [1620, 120], SEND_TELEGRAM),
    codeNode('c3000000-0021-4000-8000-000000000021', 'Return Result', [1620, 280], RETURN_RESULT),
    {
      id: 'c3000000-0022-4000-8000-000000000022',
      name: 'Return Telegram Skip',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-300, 420],
      parameters: {
        jsCode: "const item = $input.first().json;\nlet sent = false;\nconst text = String(item.telegram_text || '').trim();\nif (item.action === 'telegram_reply' && text) {\n  const token = String(item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').trim();\n  const chatId = String(item.telegram_chat_id || $env.TELEGRAM_CHAT_ID || '').trim();\n  if (token && chatId) {\n    try {\n      await this.helpers.httpRequest({\n        method: 'POST',\n        url: 'https://api.telegram.org/bot' + token + '/sendMessage',\n        body: { chat_id: chatId, text: text.slice(0, 4000) },\n        json: true,\n        timeout: 30000,\n      });\n      sent = true;\n    } catch (e) {}\n  }\n}\nreturn [{ json: {\n  success: true,\n  skipped: true,\n  reason: item.skip_reason || item.action || 'telegram_skip',\n  telegram_reply: item.action === 'telegram_reply',\n  telegram_text: text || null,\n  telegram_sent: sent,\n  notifications: { telegram_sent: sent },\n} }];",
      },
    },
    {
      id: 'c3000000-0023-4000-8000-000000000023',
      name: 'Note: Workflow',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-1500, -220],
      parameters: {
        width: 480,
        height: 240,
        content: '## Customer Review Responder\\n\\n**Input:** product **photo**, product **link**, product name, or topic\\n\\n**Flow:** Photo/URL/Text → Identify → Search reviews → Analyze → Report → Telegram\\n\\n**Photo:** send any product image — Vision AI identifies it, then researches customer reviews.\\n\\n**Link:** paste any product URL — fetches details, then reviews.\\n\\nDeploy: `./scripts/deploy-customer-review-responder.sh`',
      },
    },
  ],
  connections: {
    'Webhook Trigger': { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
    'Telegram Webhook': { main: [[{ node: 'Adapt Telegram Payload', type: 'main', index: 0 }]] },
    'Adapt Telegram Payload': { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
    'Manual Trigger': { main: [[{ node: 'Set: Sample Input', type: 'main', index: 0 }]] },
    'Set: Sample Input': { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
    'Normalize Input': { main: [[{ node: 'IF Telegram Skip?', type: 'main', index: 0 }]] },
    'IF Telegram Skip?': {
      main: [
        [{ node: 'Return Telegram Skip', type: 'main', index: 0 }],
        [{ node: 'Validate Input', type: 'main', index: 0 }],
      ],
    },
    'Validate Input': { main: [[{ node: 'IF Has Image?', type: 'main', index: 0 }]] },
    'IF Has Image?': {
      main: [
        [{ node: 'Vision AI', type: 'main', index: 0 }],
        [{ node: 'IF Has URL?', type: 'main', index: 0 }],
      ],
    },
    'IF Has URL?': {
      main: [
        [{ node: 'Fetch Product URL', type: 'main', index: 0 }],
        [{ node: 'Identify Product (Text)', type: 'main', index: 0 }],
      ],
    },
    'Vision AI': { main: [[{ node: 'IF Vision Reply?', type: 'main', index: 0 }]] },
    'IF Vision Reply?': {
      main: [
        [{ node: 'Return Telegram Skip', type: 'main', index: 0 }],
        [{ node: 'Search Agent', type: 'main', index: 0 }],
      ],
    },
    'Fetch Product URL': { main: [[{ node: 'Search Agent', type: 'main', index: 0 }]] },
    'Identify Product (Text)': { main: [[{ node: 'Search Agent', type: 'main', index: 0 }]] },
    'Search Agent': { main: [[{ node: 'Collect Data', type: 'main', index: 0 }]] },
    'Collect Data': { main: [[{ node: 'AI Analyzer', type: 'main', index: 0 }]] },
    'AI Analyzer': { main: [[{ node: 'Generate Report', type: 'main', index: 0 }]] },
    'Generate Report': { main: [[{ node: 'Notify Telegram?', type: 'main', index: 0 }]] },
    'Notify Telegram?': {
      main: [
        [{ node: 'Send Telegram', type: 'main', index: 0 }],
        [{ node: 'Return Result', type: 'main', index: 0 }],
      ],
    },
    'Send Telegram': { main: [[{ node: 'Return Result', type: 'main', index: 0 }]] },
  },
  active: false,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    saveExecutionProgress: true,
    callerPolicy: 'workflowsFromSameOwner',
    errorWorkflow: '',
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [
    { name: 'reviews' },
    { name: 'openrouter' },
    { name: 'telegram' },
    { name: 'search' },
  ],
};

const outPath = path.join(__dirname, '..', 'workflows', 'customer-review-responder.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));
console.log('Wrote', outPath);
