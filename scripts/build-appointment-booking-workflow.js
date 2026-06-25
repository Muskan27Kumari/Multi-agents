#!/usr/bin/env node
/**
 * Builds workflows/appointment-booking-agent.json
 * Storage: n8n workflow static data (no fs in Code nodes) + optional file sync for Telegram poller.
 */
const fs = require('fs');
const path = require('path');

// Full service catalog — edit scripts/appointment-services.js
const APPOINTMENT_SERVICES = require('./appointment-services');
const { enrichServicesWithRequirements } = require('./appointment-requirements');
const ENRICHED_SERVICES = enrichServicesWithRequirements(APPOINTMENT_SERVICES);

const SEND_EMAIL = `const item = $input.first().json;
const host = String(item.smtp_host || 'smtpout.secureserver.net').trim();
const port = Number(item.smtp_port || 465);
const user = String(item.smtp_user || item.sender_email || '').trim();
const pass = String(item.smtp_pass || '').trim();
const from = String(item.sender_email || user).trim();
const to = String(item.recipient_email || '').trim();
const subject = String(item.email_subject || 'Appointment Confirmation').trim();
const html = String(item.email_html || '').trim();

if (!to) {
  return [{ json: { ...item, email_sent: false, email_error: 'Missing recipient email' } }];
}
if (!user || !pass) {
  return [{
    json: {
      ...item,
      email_sent: false,
      email_error: 'SMTP not configured. Add SMTP_USER, SMTP_PASS, EMAIL_FROM to .env and restart n8n.',
    },
  }];
}
if (!html) {
  return [{ json: { ...item, email_sent: false, email_error: 'Missing email_html content' } }];
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  return [{
    json: {
      ...item,
      email_sent: false,
      email_error: 'nodemailer not available. Ensure NODE_FUNCTION_ALLOW_EXTERNAL=nodemailer in docker-compose.',
    },
  }];
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

try {
  const info = await transporter.sendMail({ from, to, subject, html });
  return [{
    json: {
      ...item,
      email_sent: true,
      email_to: to,
      email_from: from,
      email_message_id: info.messageId || null,
      email_error: null,
    },
  }];
} catch (err) {
  return [{
    json: {
      ...item,
      email_sent: false,
      email_error: String(err.message || err),
    },
  }];
}`;

const SEND_TELEGRAM = `const item = $input.first().json;
const token = String(item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').trim();
const chatId = String(
  item.telegram_chat_id
  || item.chat_id
  || item.booking?.chat_id
  || $env.TELEGRAM_CHAT_ID
  || ''
).trim();
const text = String(item.telegram_text || '').trim();

if (!token || !chatId) {
  return [{
    json: {
      ...item,
      telegram_sent: false,
      telegram_error: 'Missing telegram_bot_token or telegram_chat_id',
    },
  }];
}
if (!text) {
  return [{ json: { ...item, telegram_sent: false, telegram_error: 'Empty telegram message text' } }];
}

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: \`https://api.telegram.org/bot\${token}/sendMessage\`,
    body: { chat_id: chatId, text: text.slice(0, 4000) },
    json: true,
    timeout: 30000,
  });
  return [{ json: { ...item, telegram_sent: true, telegram_error: null } }];
} catch (err) {
  return [{
    json: {
      ...item,
      telegram_sent: false,
      telegram_error: String(err.message || err),
    },
  }];
}`;

const ADAPT_TELEGRAM = `const raw = $input.first().json;
const token = String(
  raw.telegram_bot_token || raw.body?.telegram_bot_token
  || $env.TELEGRAM_BOT_TOKEN || ''
).trim();
const allowedChatId = String($env.TELEGRAM_CHAT_ID || '').trim();

function skip(reason) {
  return [{ json: { action: 'skip', channel: 'telegram', skip_reason: reason } }];
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

const text = String(msg.text || msg.caption || '').trim();
const userName = String(msg.from?.first_name || msg.from?.username || 'Guest').trim();

const bookingSessions = update.booking_sessions || raw.booking_sessions || raw.body?.booking_sessions || {};
const bookingAppointments = update.booking_appointments || raw.booking_appointments || raw.body?.booking_appointments || [];

return [{
  json: {
    channel: 'telegram',
    source: 'telegram',
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    telegram_user_name: userName,
    message_text: text,
    _sessions: bookingSessions,
    _bookings: { appointments: Array.isArray(bookingAppointments) ? bookingAppointments : [] },
    raw_update: update,
  },
}];`;

const PROCESS_CONVERSATION = `const item = $input.first().json;
const token = String(item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').trim();
const chatId = String(item.telegram_chat_id || item.chat_id || '').trim();
const text = String(item.message_text || item.text || '').trim();
const userName = String(item.telegram_user_name || item.customer_name || 'Guest').trim();

const staticData = $getWorkflowStaticData('global');
const sessions = { ...(item._sessions || {}) };
staticData.sessions = sessions;
staticData.bookings = staticData.bookings || { appointments: [] };
staticData.calendarEvents = staticData.calendarEvents || { events: [] };

const SERVICES = ${JSON.stringify(ENRICHED_SERVICES)};

const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const RESTAURANT_NAME_CATEGORY = 'Food & Dining';
const REMINDER_HOURS = Number($env.APPOINTMENT_REMINDER_HOURS || 24);

function needsRestaurantName(category) {
  return category === RESTAURANT_NAME_CATEGORY;
}

function formatTimeAmPm(slot) {
  const [hh, mm] = slot.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return \`\${h12}:\${String(mm).padStart(2, '0')} \${ampm}\`;
}

function formatRequirementsBlock(requirements) {
  const list = Array.isArray(requirements) ? requirements.filter(Boolean) : [];
  if (!list.length) return '';
  return '\\n\\n📌 What to bring / prepare:\\n' + list.map((r) => \`• \${r}\`).join('\\n');
}

function replyPayload(message, extra = {}) {
  return {
    action: 'telegram_reply',
    channel: item.channel || 'api',
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    telegram_text: message,
    storage_dirty: true,
    ...extra,
  };
}

function bookPayload(booking) {
  return {
    action: 'book_appointment',
    channel: item.channel || 'api',
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    booking,
    reminder_hours: REMINDER_HOURS,
    storage_dirty: true,
  };
}

function getCategories() {
  const cats = [];
  const seen = new Set();
  for (const s of SERVICES) {
    const cat = s.category || 'Other';
    if (!seen.has(cat)) {
      seen.add(cat);
      cats.push(cat);
    }
  }
  return cats;
}

function categoryMenu() {
  const cats = getCategories();
  const lines = [
    '📂 What would you like to book?',
    \`(\${cats.length} categories · \${SERVICES.length} services)\`,
    '',
  ];
  cats.forEach((cat, i) => {
    const count = SERVICES.filter((s) => s.category === cat).length;
    lines.push(\`\${i + 1}. \${cat} (\${count})\`);
  });
  lines.push('');
  lines.push('Reply with category number or name (e.g. "Movies" or "Bus Ticket").');
  lines.push('Type /cancel anytime to restart.');
  return lines.join('\\n');
}

function parseCategory(input) {
  const t = String(input || '').trim().toLowerCase();
  if (!t) return null;
  const cats = getCategories();
  const num = Number(t);
  if (Number.isInteger(num) && num >= 1 && num <= cats.length) return cats[num - 1];
  const exact = cats.find((c) => c.toLowerCase() === t);
  if (exact) return exact;
  const partial = cats.filter((c) => {
    const cl = c.toLowerCase();
    return cl.includes(t) || t.includes(cl);
  });
  if (partial.length === 1) return partial[0];
  const keywordMatches = cats.filter((c) =>
    SERVICES.some((s) => s.category === c && s.name.toLowerCase().includes(t))
  );
  if (keywordMatches.length === 1) return keywordMatches[0];
  return null;
}

function serviceMenuForCategory(category) {
  const items = SERVICES.filter((s) => s.category === category);
  const lines = [\`📋 \${category}\`, '', 'Reply with service number or name.', 'Type "back" for categories.', ''];
  for (const s of items) {
    lines.push(\`\${s.id}. \${s.name} (\${s.duration_min} min)\`);
  }
  return lines.join('\\n');
}

function parseService(input, categoryFilter) {
  const raw = String(input || '').trim();
  const t = raw.toLowerCase();
  if (t === 'back') return { back: true };
  const pool = categoryFilter
    ? SERVICES.filter((s) => s.category === categoryFilter)
    : SERVICES;
  const byId = pool.find((s) => s.id === t || s.id === raw);
  if (byId) return byId;
  return pool.find((s) => {
    const name = s.name.toLowerCase();
    return t === name || t.includes(name) || name.includes(t);
  }) || null;
}

function parseDate(input) {
  const t = String(input || '').trim().toLowerCase();
  if (!t) return null;
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(t)) {
    const d = new Date(t + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? null : t;
  }
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  if (t === 'today') return base.toISOString().slice(0, 10);
  if (t === 'tomorrow') {
    base.setDate(base.getDate() + 1);
    return base.toISOString().slice(0, 10);
  }
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < weekdays.length; i++) {
    if (t.includes(weekdays[i])) {
      const target = i;
      const cur = base.getDay();
      let diff = (target - cur + 7) % 7;
      if (diff === 0) diff = 7;
      base.setDate(base.getDate() + diff);
      return base.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function parseChosenTime(input, slots) {
  const t = String(input || '').trim();
  const lower = t.toLowerCase();

  let m = t.match(/^(\\d{1,2}):(\\d{2})$/);
  if (m) {
    const hh = String(Number(m[1])).padStart(2, '0');
    const slot = \`\${hh}:\${m[2]}\`;
    if (slots.includes(slot)) return slot;
  }

  m = lower.match(/^(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)$/);
  if (m) {
    let hh = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    const isPm = m[3].replace(/\\./g, '').startsWith('p');
    if (isPm && hh < 12) hh += 12;
    if (!isPm && hh === 12) hh = 0;
    const slot = \`\${String(hh).padStart(2, '0')}:\${String(mm).padStart(2, '0')}\`;
    if (slots.includes(slot)) return slot;
  }

  if (/^\\d{1,2}$/.test(t)) {
    const num = Number(t);
    const hourSlot = \`\${String(num).padStart(2, '0')}:00\`;
    if (slots.includes(hourSlot)) return hourSlot;
    if (Number.isInteger(num) && num >= 1 && num <= slots.length) return slots[num - 1];
  }

  return null;
}

function getBookings() {
  const fileAppointments = Array.isArray(item._bookings?.appointments) ? item._bookings.appointments : [];
  const staticAppointments = Array.isArray(staticData.bookings?.appointments) ? staticData.bookings.appointments : [];
  const byId = new Map();
  for (const b of fileAppointments) byId.set(b.id, b);
  for (const b of staticAppointments) byId.set(b.id, b);
  return [...byId.values()];
}

function isSlotBooked(date, time) {
  return getBookings().some((b) =>
    b.status !== 'cancelled' && b.date === date && b.time_slot === time
  );
}

function availableSlots(date) {
  return TIME_SLOTS.filter((slot) => !isSlotBooked(date, slot));
}

function formatSlots(slots) {
  if (!slots.length) return 'No slots available for this date.';
  return slots.map((s, i) => \`\${i + 1}. \${s} (\${formatTimeAmPm(s)})\`).join('\\n');
}

function parseDetails(text) {
  const raw = String(text || '').trim();
  const lines = raw.split(/\\n+/).map((l) => l.trim()).filter(Boolean);
  const out = { name: '', email: '', phone: '' };
  const labelRe = /^(name|full\\s*name|email|e-?mail|phone|mobile|tel)\\s*[:=\\-–—]\\s*(.+)$/i;

  for (const line of lines) {
    const m = line.match(labelRe);
    if (m) {
      const key = m[1].toLowerCase().replace(/\\s+/g, '').replace(/-/g, '');
      if (key === 'fullname' || key === 'name') out.name = m[2].trim();
      else if (key === 'email') out.email = m[2].trim();
      else if (key === 'phone' || key === 'mobile' || key === 'tel') out.phone = m[2].trim();
      continue;
    }

    if (!out.email) {
      const emailMatch = line.match(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/);
      if (emailMatch) {
        out.email = emailMatch[0];
        continue;
      }
    }

    const phoneDigits = line.replace(/\\D/g, '');
    if (!out.phone && phoneDigits.length >= 8 && /^[\\d\\s+().-]+$/.test(line)) {
      out.phone = line.replace(/\\s+/g, ' ').trim();
      continue;
    }

    if (!out.name && line.length >= 2 && !line.includes('@') && phoneDigits.length < 8) {
      out.name = line;
    }
  }

  if (!out.email) {
    const emailMatch = raw.match(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/);
    if (emailMatch) out.email = emailMatch[0];
  }
  if (!out.phone) {
    const phoneMatch = raw.match(/(\\+?\\d[\\d\\s()-]{7,}\\d)/);
    if (phoneMatch) out.phone = phoneMatch[1].replace(/\\s+/g, ' ').trim();
  }
  return out;
}

function welcomeText() {
  const brand = String($env.BRAND_NAME || 'our clinic').trim();
  return [
    \`👋 Welcome to \${brand} Appointment Booking!\`,
    '',
    'I can help you book appointments, tickets & services:',
    '1️⃣ Category (Health, Movies, Bus, Hotel…)',
    '2️⃣ Service / ticket type',
    '3️⃣ Restaurant / venue (Food & Dining)',
    '4️⃣ Preferred date',
    '5️⃣ Time slot',
    '6️⃣ Your contact details',
    '',
    'Type /book to start or /cancel to reset.',
  ].join('\\n');
}

if (item.action === 'book' || item.direct_booking === true) {
  const booking = {
    id: 'apt_' + Date.now(),
    chat_id: chatId || item.chat_id || 'api',
    customer_name: String(item.customer_name || '').trim(),
    customer_email: String(item.customer_email || '').trim(),
    customer_phone: String(item.customer_phone || '').trim(),
    service_type: String(item.service_type || '').trim(),
    service_id: String(item.service_id || '').trim(),
    date: String(item.date || '').trim(),
    time_slot: String(item.time_slot || '').trim(),
    restaurant_name: String(item.restaurant_name || '').trim() || null,
    telegram_bot_token: String(item.telegram_bot_token || token || '').trim() || null,
    status: 'confirmed',
    created_at: new Date().toISOString(),
    reminder_sent: false,
    calendar_event_id: null,
  };
  const service = parseService(booking.service_type) || SERVICES.find((s) => s.id === booking.service_id);
  if (service) {
    booking.service_type = service.name;
    booking.service_id = service.id;
    booking.service_category = service.category;
    booking.duration_min = service.duration_min;
    booking.requirements = service.requirements || [];
  }
  if (!booking.customer_name || !booking.date || !booking.time_slot) {
    throw new Error('direct_booking requires customer_name, date, and time_slot');
  }
  if (isSlotBooked(booking.date, booking.time_slot)) {
    return [{ json: replyPayload(
      \`❌ Slot \${booking.date} \${booking.time_slot} is no longer available.\\n\\n\${formatSlots(availableSlots(booking.date))}\`,
      { slot_available: false }
    ) }];
  }
  return [{ json: bookPayload(booking) }];
}

if (!chatId && item.channel !== 'api') {
  return [{ json: { action: 'skip', skip_reason: 'missing_chat_id' } }];
}

let session = sessions[chatId] || { step: 'idle', updated_at: null };

function saveSession(next) {
  session = { ...session, ...next, updated_at: new Date().toISOString() };
  sessions[chatId] = session;
  staticData.sessions = sessions;
}

function clearSession() {
  delete sessions[chatId];
  session = { step: 'idle', updated_at: null };
  staticData.sessions = sessions;
}

const lower = text.toLowerCase();

if (lower === '/cancel' || lower === 'cancel') {
  clearSession();
  return [{ json: replyPayload('Booking cancelled. Type /book to start a new appointment.') }];
}

if (lower === '/book' || lower === '/appointment' || lower === 'book appointment') {
  saveSession({ step: 'select_category' });
  return [{ json: replyPayload(categoryMenu(), { step: 'select_category' }) }];
}

if (lower === '/start' || lower === '/help') {
  return [{ json: replyPayload(welcomeText()) }];
}

if (session.step === 'idle') {
  return [{ json: { action: 'skip', skip_reason: 'no_active_booking_session' } }];
}

if (session.step === 'select_category') {
  const category = parseCategory(text);
  if (!category) {
    return [{ json: replyPayload('Please choose a valid category:\\n\\n' + categoryMenu(), { step: 'select_category' }) }];
  }
  saveSession({ step: 'select_service', category_filter: category });
  return [{ json: replyPayload(serviceMenuForCategory(category), { step: 'select_service', category }) }];
}

if (session.step === 'select_service') {
  const service = parseService(text, session.category_filter);
  if (service?.back) {
    saveSession({ step: 'select_category', category_filter: null });
    return [{ json: replyPayload(categoryMenu(), { step: 'select_category' }) }];
  }
  if (!service) {
    const menu = session.category_filter
      ? serviceMenuForCategory(session.category_filter)
      : categoryMenu();
    return [{ json: replyPayload('Please choose a valid service:\\n\\n' + menu, { step: 'select_service' }) }];
  }
  session.service_id = service.id;
  session.service_type = service.name;
  session.service_category = service.category;
  session.duration_min = service.duration_min;
  session.requirements = service.requirements || [];
  if (needsRestaurantName(service.category)) {
    session.step = 'select_restaurant';
    saveSession(session);
    return [{ json: replyPayload(
      \`✅ Service: \${service.name}\${formatRequirementsBlock(service.requirements)}\\n\\n🍽️ Enter restaurant or venue name:\`,
      { step: 'select_restaurant' }
    ) }];
  }
  session.step = 'select_date';
  saveSession(session);
  return [{ json: replyPayload(
    \`✅ Service: \${service.name}\${formatRequirementsBlock(service.requirements)}\\n\\n📅 Enter your preferred date (YYYY-MM-DD, tomorrow, or next monday):\`,
    { step: 'select_date' }
  ) }];
}

if (session.step === 'select_restaurant') {
  const venueName = String(text || '').trim();
  if (venueName.length < 2) {
    return [{ json: replyPayload(
      'Please enter a valid restaurant or venue name (at least 2 characters).',
      { step: 'select_restaurant' }
    ) }];
  }
  session.restaurant_name = venueName;
  session.step = 'select_date';
  saveSession(session);
  return [{ json: replyPayload(
    \`✅ Venue: \${venueName}\\n\\n📅 Enter your preferred date (YYYY-MM-DD, tomorrow, or next monday):\`,
    { step: 'select_date' }
  ) }];
}

if (session.step === 'select_date') {
  const date = parseDate(text);
  if (!date) {
    return [{ json: replyPayload('Invalid date. Use YYYY-MM-DD, tomorrow, or next monday.', { step: 'select_date' }) }];
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) {
    return [{ json: replyPayload('Please choose a future date.', { step: 'select_date' }) }];
  }
  const slots = availableSlots(date);
  if (!slots.length) {
    return [{ json: replyPayload(
      \`No slots available on \${date}. Try another date (YYYY-MM-DD):\`,
      { step: 'select_date', slot_available: false }
    ) }];
  }
  session.date = date;
  session.step = 'select_time';
  saveSession(session);
  return [{ json: replyPayload(
    \`📅 Date: \${date}\\n\\n⏰ Available time slots:\\n\${formatSlots(slots)}\\n\\nReply with a time (e.g. 10:00, 1 PM, 13, 14) or slot number.\`,
    { step: 'select_time', available_slots: slots }
  ) }];
}

if (session.step === 'select_time') {
  const slots = availableSlots(session.date);
  const chosen = parseChosenTime(text, slots);
  if (!chosen) {
    return [{ json: replyPayload(\`Pick a valid slot:\\n\${formatSlots(slots)}\\n\\nUse 24h (13, 14), 12h (1 PM), HH:MM, or slot number.\`, { step: 'select_time' }) }];
  }
  if (isSlotBooked(session.date, chosen)) {
    const alt = availableSlots(session.date);
    return [{ json: replyPayload(
      \`❌ \${chosen} (\${formatTimeAmPm(chosen)}) is no longer available.\\n\\nOther slots:\\n\${formatSlots(alt)}\\n\\nPick another time.\`,
      { step: 'select_time', slot_available: false, available_slots: alt }
    ) }];
  }
  session.time_slot = chosen;
  session.step = 'collect_details';
  saveSession(session);
  return [{ json: replyPayload(
    [
      \`✅ Slot reserved: \${session.date} at \${chosen} (\${formatTimeAmPm(chosen)})\`,
      '',
      '📝 Send your contact details (one per line):',
      'Your Name',
      'Email: you@example.com',
      'Phone: +1234567890',
      '',
      'Name on first line works, or use Name: Your Name',
    ].join('\\n'),
    { step: 'collect_details', slot_available: true }
  ) }];
}

if (session.step === 'collect_details') {
  const details = parseDetails(text);
  if (!details.name || !details.email || !details.phone) {
    return [{ json: replyPayload(
      [
        'Please provide your full name, email, and phone.',
        '',
        'Example (name on first line):',
        'Your Name',
        'Email: you@example.com',
        'Phone: +1234567890',
        '',
        'Or use labels: Name: Your Name',
      ].join('\\n'),
      { step: 'collect_details' }
    ) }];
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(details.email)) {
    return [{ json: replyPayload('Please provide a valid email address.', { step: 'collect_details' }) }];
  }

  const booking = {
    id: 'apt_' + Date.now(),
    chat_id: chatId,
    customer_name: details.name,
    customer_email: details.email,
    customer_phone: details.phone,
    service_id: session.service_id,
    service_type: session.service_type,
    service_category: session.service_category || null,
    duration_min: session.duration_min,
    requirements: session.requirements || [],
    restaurant_name: session.restaurant_name || null,
    date: session.date,
    time_slot: session.time_slot,
    telegram_bot_token: String(token || '').trim() || null,
    status: 'confirmed',
    created_at: new Date().toISOString(),
    reminder_sent: false,
    calendar_event_id: null,
  };

  if (isSlotBooked(booking.date, booking.time_slot)) {
    session.step = 'select_time';
    saveSession(session);
    const alt = availableSlots(session.date);
    return [{ json: replyPayload(
      \`Sorry, \${booking.time_slot} was just booked. Pick another slot:\\n\${formatSlots(alt)}\`,
      { step: 'select_time', slot_available: false }
    ) }];
  }

  clearSession();
  return [{ json: bookPayload(booking) }];
}

return [{ json: replyPayload('Type /book to schedule an appointment or /cancel to reset.') }];`;

const PREPARE_SESSIONS_FILE = `const item = $input.first().json;
const staticData = $getWorkflowStaticData('global');
const sessions = staticData.sessions || {};
const content = JSON.stringify(sessions, null, 2);

return [{
  json: {
    ...item,
    sessions_file_path: '/files/appointments/sessions.json',
  },
  binary: {
    data: {
      data: Buffer.from(content, 'utf8').toString('base64'),
      mimeType: 'application/json',
      fileName: 'sessions.json',
    },
  },
}];`;

const SAVE_BOOKING = `const item = $input.first().json;
const booking = item.booking;
if (!booking) throw new Error('Missing booking payload');

const staticData = $getWorkflowStaticData('global');
staticData.bookings = staticData.bookings || { appointments: [] };
staticData.calendarEvents = staticData.calendarEvents || { events: [] };

staticData.bookings.appointments = Array.isArray(staticData.bookings.appointments)
  ? staticData.bookings.appointments
  : [];
staticData.bookings.appointments.push(booking);

function formatTimeAmPm(slot) {
  const [hh, mm] = String(slot || '').split(':').map(Number);
  if (Number.isNaN(hh)) return slot;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  return \`\${h12}:\${String(mm).padStart(2, '0')} \${ampm}\`;
}

const start = new Date(\`\${booking.date}T\${booking.time_slot}:00\`);
const end = new Date(start.getTime() + (Number(booking.duration_min || 30) * 60000));

const requirementsList = Array.isArray(booking.requirements) ? booking.requirements.filter(Boolean) : [];
const requirementsText = requirementsList.length
  ? ['What to bring:', ...requirementsList.map((r) => \`- \${r}\`)].join('\\n')
  : '';

const calendarDescription = [
  \`Service: \${booking.service_type}\`,
  booking.restaurant_name ? \`Venue: \${booking.restaurant_name}\` : null,
  \`Customer: \${booking.customer_name}\`,
  \`Email: \${booking.customer_email}\`,
  \`Phone: \${booking.customer_phone}\`,
  \`Booking ID: \${booking.id}\`,
  requirementsText || null,
].filter(Boolean);

const calendarEvent = {
  id: booking.id,
  summary: booking.restaurant_name
    ? \`\${booking.service_type} @ \${booking.restaurant_name} — \${booking.customer_name}\`
    : \`\${booking.service_type} — \${booking.customer_name}\`,
  description: calendarDescription.join('\\n'),
  start: start.toISOString(),
  end: end.toISOString(),
  attendee_email: booking.customer_email,
  created_at: new Date().toISOString(),
};

staticData.calendarEvents.events = Array.isArray(staticData.calendarEvents.events)
  ? staticData.calendarEvents.events
  : [];
staticData.calendarEvents.events.push(calendarEvent);

booking.calendar_event_id = calendarEvent.id;
booking.appointment_start = calendarEvent.start;
booking.appointment_end = calendarEvent.end;

const confirmLines = [
  '✅ Appointment Confirmed!',
  '',
  \`📋 Service: \${booking.service_type}\`,
];
if (booking.restaurant_name) confirmLines.push(\`🍽️ Venue: \${booking.restaurant_name}\`);
confirmLines.push(
  \`📅 Date: \${booking.date}\`,
  \`⏰ Time: \${booking.time_slot} (\${formatTimeAmPm(booking.time_slot)})\`,
  \`👤 Name: \${booking.customer_name}\`,
  \`📧 Email: \${booking.customer_email}\`,
  \`📞 Phone: \${booking.customer_phone}\`,
  \`🆔 Booking ID: \${booking.id}\`,
);
if (requirementsList.length) {
  confirmLines.push('', '📌 What to bring / prepare:');
  for (const req of requirementsList) confirmLines.push(\`• \${req}\`);
}
confirmLines.push(
  '',
  \`You will receive a reminder \${item.reminder_hours || 24} hours before your appointment.\`,
);
if (booking.customer_email && String($env.SMTP_USER || '').trim() && String($env.SMTP_PASS || '')) {
  confirmLines.push(\`📧 A confirmation email will be sent to \${booking.customer_email}.\`);
}
confirmLines.push('', 'Type /book to schedule another appointment.');
const confirmText = confirmLines.join('\\n');

const brand = String($env.BRAND_NAME || 'Appointment Booking').trim();
const emailSubject = \`Appointment Confirmed — \${booking.service_type} on \${booking.date}\`;
const reqHtml = requirementsList.length
  ? \`<h3 style="margin:20px 0 8px;color:#333;">What to bring / prepare</h3><ul style="margin:0;padding-left:20px;color:#444;">\${requirementsList.map((r) => \`<li style="margin-bottom:6px;">\${r}</li>\`).join('')}</ul>\`
  : '';
const emailHtml = [
  '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">',
  \`<h2 style="color:#1a7f37;">✅ Appointment Confirmed</h2>\`,
  \`<p>Hi \${booking.customer_name},</p>\`,
  \`<p>Your appointment has been confirmed. Details are below.</p>\`,
  '<table style="width:100%;border-collapse:collapse;margin:16px 0;">',
  \`<tr><td style="padding:8px 0;color:#666;">Service</td><td style="padding:8px 0;"><strong>\${booking.service_type}</strong></td></tr>\`,
  booking.restaurant_name ? \`<tr><td style="padding:8px 0;color:#666;">Venue</td><td style="padding:8px 0;"><strong>\${booking.restaurant_name}</strong></td></tr>\` : '',
  \`<tr><td style="padding:8px 0;color:#666;">Date</td><td style="padding:8px 0;"><strong>\${booking.date}</strong></td></tr>\`,
  \`<tr><td style="padding:8px 0;color:#666;">Time</td><td style="padding:8px 0;"><strong>\${booking.time_slot} (\${formatTimeAmPm(booking.time_slot)})</strong></td></tr>\`,
  \`<tr><td style="padding:8px 0;color:#666;">Booking ID</td><td style="padding:8px 0;"><strong>\${booking.id}</strong></td></tr>\`,
  \`<tr><td style="padding:8px 0;color:#666;">Phone</td><td style="padding:8px 0;"><strong>\${booking.customer_phone}</strong></td></tr>\`,
  '</table>',
  reqHtml,
  \`<p style="color:#666;font-size:14px;">You will receive a reminder \${item.reminder_hours || 24} hours before your appointment.</p>\`,
  \`<p style="color:#999;font-size:12px;">— \${brand}</p>\`,
  '</div>',
].join('');

const telegramBotToken = String(item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').trim();
const telegramChatId = String(
  item.telegram_chat_id || item.chat_id || booking.chat_id || ''
).trim();

return [{
  json: {
    ...item,
    booking,
    calendar_event: calendarEvent,
    calendar_event_id: calendarEvent.id,
    calendar_note: 'Calendar event saved. Connect Google Calendar node here for live sync.',
    telegram_bot_token: telegramBotToken,
    telegram_chat_id: telegramChatId,
    telegram_text: confirmText,
    recipient_email: booking.customer_email,
    sender_email: String($env.EMAIL_FROM || $env.SMTP_USER || '').trim(),
    smtp_host: String($env.SMTP_HOST || 'smtpout.secureserver.net').trim(),
    smtp_port: Number($env.SMTP_PORT || 465),
    smtp_user: String($env.SMTP_USER || '').trim(),
    smtp_pass: String($env.SMTP_PASS || ''),
    email_subject: emailSubject,
    email_html: emailHtml,
    booking_saved: true,
    storage_dirty: true,
  },
}];`;

const PREPARE_BOOKINGS_FILE = `const item = $input.first().json;
const staticData = $getWorkflowStaticData('global');
const bookings = staticData.bookings || { appointments: [] };
const content = JSON.stringify(bookings, null, 2);

return [{
  json: {
    ...item,
    bookings_file_path: '/files/appointments/bookings.json',
  },
  binary: {
    data: {
      data: Buffer.from(content, 'utf8').toString('base64'),
      mimeType: 'application/json',
      fileName: 'bookings.json',
    },
  },
}];`;

const PREPARE_CALENDAR_FILE = `const item = $input.first().json;
const staticData = $getWorkflowStaticData('global');
const calendarEvents = staticData.calendarEvents || { events: [] };
const content = JSON.stringify(calendarEvents, null, 2);

return [{
  json: {
    ...item,
    calendar_file_path: '/files/appointments/calendar-events.json',
  },
  binary: {
    data: {
      data: Buffer.from(content, 'utf8').toString('base64'),
      mimeType: 'application/json',
      fileName: 'calendar-events.json',
    },
  },
}];`;

const CHECK_REMINDERS = `const staticData = $getWorkflowStaticData('global');
const REMINDER_HOURS = Number($env.APPOINTMENT_REMINDER_HOURS || 24);
const defaultToken = String($env.TELEGRAM_BOT_TOKEN || '').trim();

staticData.bookings = staticData.bookings || { appointments: [] };
const appointments = Array.isArray(staticData.bookings.appointments) ? staticData.bookings.appointments : [];

const now = Date.now();
const windowMs = REMINDER_HOURS * 60 * 60 * 1000;
const due = [];

for (const apt of appointments) {
  if (apt.status === 'cancelled' || apt.reminder_sent) continue;
  const start = new Date(\`\${apt.date}T\${apt.time_slot}:00\`).getTime();
  const diff = start - now;
  if (diff > 0 && diff <= windowMs) due.push(apt);
}

if (!due.length) {
  return [{ json: { action: 'no_reminders', reminders_due: 0 } }];
}

return due.map((apt) => ({
  json: {
    action: 'send_reminder',
    telegram_bot_token: String(apt.telegram_bot_token || defaultToken || '').trim(),
    telegram_chat_id: String(apt.chat_id || ''),
    appointment: apt,
    telegram_text: [
      '⏰ Appointment Reminder',
      '',
      \`Your \${apt.service_type} is coming up:\`,
      \`📅 \${apt.date} at \${apt.time_slot}\`,
      \`🆔 Booking ID: \${apt.id}\`,
      '',
      'Reply /book to reschedule or contact us if you need to cancel.',
    ].join('\\n'),
  },
}));`;

const MARK_REMINDER_SENT = `const items = $input.all();
const staticData = $getWorkflowStaticData('global');
staticData.bookings = staticData.bookings || { appointments: [] };

const sentIds = new Set(
  items
    .filter((i) => i.json.telegram_sent === true && i.json.appointment?.id)
    .map((i) => i.json.appointment.id)
);

for (const apt of staticData.bookings.appointments || []) {
  if (sentIds.has(apt.id)) apt.reminder_sent = true;
}

return [{
  json: {
    success: true,
    reminders_sent: sentIds.size,
    storage_dirty: sentIds.size > 0,
    completed_at: new Date().toISOString(),
  },
}];`;

const RETURN_RESULT = `const item = $input.first().json;
return [{
  json: {
    success: true,
    action: item.action || 'completed',
    channel: item.channel || 'api',
    step: item.step || null,
    slot_available: item.slot_available ?? null,
    booking: item.booking || null,
    booking_saved: item.booking_saved === true,
    calendar_event: item.calendar_event || null,
    notifications: {
      telegram_sent: item.telegram_sent === true,
      telegram_error: item.telegram_error || null,
      email_sent: item.email_sent === true,
      email_to: item.email_to || item.recipient_email || null,
      email_error: item.email_error || null,
    },
    telegram_text: item.telegram_text || null,
    skipped: item.action === 'skip',
    skip_reason: item.skip_reason || null,
    completed_at: new Date().toISOString(),
  },
}];`;

function node(id, name, type, position, parameters, extra = {}) {
  return {
    id,
    name,
    type,
    typeVersion: extra.typeVersion ?? (type === 'n8n-nodes-base.webhook' ? 2 : type === 'n8n-nodes-base.code' ? 2 : 1),
    position,
    parameters,
    ...extra.webhookId ? { webhookId: extra.webhookId } : {},
  };
}

const nodes = [
  node('b2000000-0001-4000-8000-000000000001', 'Telegram Webhook', 'n8n-nodes-base.webhook', [-1500, 200], {
    httpMethod: 'POST',
    path: 'appointment-booking-agent-telegram',
    responseMode: 'lastNode',
    options: {},
  }, { webhookId: 'appointment-booking-agent-telegram' }),

  node('b2000000-0002-4000-8000-000000000002', 'Webhook Trigger', 'n8n-nodes-base.webhook', [-1500, 400], {
    httpMethod: 'POST',
    path: 'appointment-booking-agent',
    responseMode: 'lastNode',
    options: {},
  }, { webhookId: 'appointment-booking-agent-webhook' }),

  node('b2000000-0003-4000-8000-000000000003', 'Manual Trigger', 'n8n-nodes-base.manualTrigger', [-1500, 600], {}),

  node('b2000000-0004-4000-8000-000000000004', 'Set: Sample Payload', 'n8n-nodes-base.set', [-1260, 600], {
    mode: 'raw',
    jsonOutput: JSON.stringify({
      action: 'book',
      direct_booking: true,
      customer_name: 'Jane Doe',
      customer_email: 'jane@example.com',
      customer_phone: '+15551234567',
      service_type: 'General Consultation',
      date: '2026-06-15',
      time_slot: '10:00',
      chat_id: 'api-demo',
      telegram_chat_id: 'api-demo',
      telegram_bot_token: '',
    }, null, 2),
    options: {},
  }, { typeVersion: 3.4 }),

  node('b2000000-0005-4000-8000-000000000005', 'Merge Triggers', 'n8n-nodes-base.merge', [-1020, 400], { mode: 'append' }, { typeVersion: 3 }),

  node('b2000000-0006-4000-8000-000000000006', 'Adapt Telegram Payload', 'n8n-nodes-base.code', [-1260, 200], { jsCode: ADAPT_TELEGRAM }),

  node('b2000000-0007-4000-8000-000000000007', 'Normalize Input', 'n8n-nodes-base.set', [-780, 400], {
    mode: 'manual',
    assignments: {
      assignments: [
        { id: 'channel', name: 'channel', value: '={{ $json.channel || "api" }}', type: 'string' },
        { id: 'chat_id', name: 'chat_id', value: '={{ ($json.telegram_chat_id || $json.body?.chat_id || $json.chat_id || "").toString().trim() }}', type: 'string' },
        { id: 'message_text', name: 'message_text', value: '={{ ($json.message_text || $json.body?.message_text || $json.body?.text || $json.text || "").toString().trim() }}', type: 'string' },
        { id: 'telegram_bot_token', name: 'telegram_bot_token', value: '={{ ($json.telegram_bot_token || $json.body?.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || "").toString().trim() }}', type: 'string' },
        { id: 'telegram_chat_id', name: 'telegram_chat_id', value: '={{ ($json.telegram_chat_id || $json.body?.telegram_chat_id || $json.chat_id || $env.TELEGRAM_CHAT_ID || "").toString().trim() }}', type: 'string' },
        { id: 'telegram_user_name', name: 'telegram_user_name', value: '={{ ($json.telegram_user_name || $json.body?.customer_name || "").toString().trim() }}', type: 'string' },
        { id: 'action', name: 'action', value: '={{ ($json.body?.action || $json.action || "").toString().trim() }}', type: 'string' },
        { id: 'direct_booking', name: 'direct_booking', value: '={{ Boolean($json.body?.direct_booking ?? $json.direct_booking) }}', type: 'boolean' },
        { id: 'customer_name', name: 'customer_name', value: '={{ ($json.body?.customer_name || $json.customer_name || "").toString().trim() }}', type: 'string' },
        { id: 'customer_email', name: 'customer_email', value: '={{ ($json.body?.customer_email || $json.customer_email || "").toString().trim() }}', type: 'string' },
        { id: 'customer_phone', name: 'customer_phone', value: '={{ ($json.body?.customer_phone || $json.customer_phone || "").toString().trim() }}', type: 'string' },
        { id: 'service_type', name: 'service_type', value: '={{ ($json.body?.service_type || $json.service_type || "").toString().trim() }}', type: 'string' },
        { id: 'service_id', name: 'service_id', value: '={{ ($json.body?.service_id || $json.service_id || "").toString().trim() }}', type: 'string' },
        { id: 'date', name: 'date', value: '={{ ($json.body?.date || $json.date || "").toString().trim() }}', type: 'string' },
        { id: 'time_slot', name: 'time_slot', value: '={{ ($json.body?.time_slot || $json.time_slot || "").toString().trim() }}', type: 'string' },
        { id: '_sessions', name: '_sessions', value: '={{ $json._sessions || $json.body?.booking_sessions || {} }}', type: 'object' },
        { id: '_bookings', name: '_bookings', value: '={{ $json._bookings || { appointments: ($json.body?.booking_appointments || []) } }}', type: 'object' },
      ],
    },
    options: {},
  }, { typeVersion: 3.4 }),

  node('b2000000-0008-4000-8000-000000000008', 'Process Booking Conversation', 'n8n-nodes-base.code', [-540, 400], { jsCode: PROCESS_CONVERSATION }),

  node('b2000000-0022-4000-8000-000000000022', 'IF Storage Dirty?', 'n8n-nodes-base.if', [-300, 400], {
    conditions: {
      options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
      conditions: [{
        id: 'storage-dirty',
        leftValue: '={{ Boolean($json.storage_dirty) }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'true' },
      }],
      combinator: 'and',
    },
    options: {},
  }, { typeVersion: 2.2 }),

  node('b2000000-0023-4000-8000-000000000023', 'Prepare Sessions File', 'n8n-nodes-base.code', [-60, 300], { jsCode: PREPARE_SESSIONS_FILE }),

  node('b2000000-0024-4000-8000-000000000024', 'Write Sessions File', 'n8n-nodes-base.writeBinaryFile', [180, 300], {
    fileName: '={{ $json.sessions_file_path }}',
    dataPropertyName: 'data',
    options: {},
  }),

  node('b2000000-0031-4000-8000-000000000031', 'Restore Session Context', 'n8n-nodes-base.code', [180, 420], {
    jsCode: `let item = {};
try {
  item = { ...$('Prepare Sessions File').first().json };
} catch (e) {
  item = { ...$input.first().json };
}
return [{ json: item }];`,
  }),

  node('b2000000-0009-4000-8000-000000000009', 'Switch on Action', 'n8n-nodes-base.switch', [420, 480], {
    rules: {
      values: [
        {
          conditions: {
            options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
            conditions: [{
              id: 'book',
              leftValue: '={{ ($json.action || "").toString().trim() }}',
              rightValue: 'book_appointment',
              operator: { type: 'string', operation: 'equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'book',
        },
        {
          conditions: {
            options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
            conditions: [{
              id: 'reply',
              leftValue: '={{ ($json.action || "").toString().trim() }}',
              rightValue: 'telegram_reply',
              operator: { type: 'string', operation: 'equals' },
            }],
            combinator: 'and',
          },
          renameOutput: true,
          outputKey: 'reply',
        },
      ],
    },
    options: { fallbackOutput: 'extra' },
  }, { typeVersion: 3.2 }),

  node('b2000000-0010-4000-8000-000000000010', 'Save in DB', 'n8n-nodes-base.code', [420, 360], { jsCode: SAVE_BOOKING }),

  node('b2000000-0025-4000-8000-000000000025', 'Prepare Bookings File', 'n8n-nodes-base.code', [660, 300], { jsCode: PREPARE_BOOKINGS_FILE }),

  node('b2000000-0026-4000-8000-000000000026', 'Write Bookings File', 'n8n-nodes-base.writeBinaryFile', [900, 300], {
    fileName: '={{ $json.bookings_file_path }}',
    dataPropertyName: 'data',
    options: {},
  }),

  node('b2000000-0027-4000-8000-000000000027', 'Prepare Calendar File', 'n8n-nodes-base.code', [1140, 300], { jsCode: PREPARE_CALENDAR_FILE }),

  node('b2000000-0028-4000-8000-000000000028', 'Write Calendar File', 'n8n-nodes-base.writeBinaryFile', [1380, 300], {
    fileName: '={{ $json.calendar_file_path }}',
    dataPropertyName: 'data',
    options: {},
  }),

  node('b2000000-0032-4000-8000-000000000032', 'Send Confirmation Email', 'n8n-nodes-base.code', [660, 480], { jsCode: SEND_EMAIL }),

  node('b2000000-0012-4000-8000-000000000012', 'Send Confirmation', 'n8n-nodes-base.code', [900, 480], { jsCode: SEND_TELEGRAM }),

  node('b2000000-0013-4000-8000-000000000013', 'Send Telegram Reply', 'n8n-nodes-base.code', [420, 560], { jsCode: SEND_TELEGRAM }),

  node('b2000000-0014-4000-8000-000000000014', 'Return Result', 'n8n-nodes-base.code', [2100, 480], { jsCode: RETURN_RESULT }),

  node('b2000000-0015-4000-8000-000000000015', 'Reminder Schedule', 'n8n-nodes-base.scheduleTrigger', [-1500, 900], {
    rule: {
      interval: [{ field: 'minutes', minutesInterval: 15 }],
    },
  }, { typeVersion: 1.2 }),

  node('b2000000-0016-4000-8000-000000000016', 'Check Upcoming Reminders', 'n8n-nodes-base.code', [-1260, 900], { jsCode: CHECK_REMINDERS }),

  node('b2000000-0017-4000-8000-000000000017', 'IF Reminders Due?', 'n8n-nodes-base.if', [-1020, 900], {
    conditions: {
      options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
      conditions: [{
        id: 'has-reminders',
        leftValue: '={{ ($json.action || "").toString() }}',
        rightValue: 'send_reminder',
        operator: { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  }, { typeVersion: 2.2 }),

  node('b2000000-0018-4000-8000-000000000018', 'Send Reminder', 'n8n-nodes-base.code', [-780, 820], { jsCode: SEND_TELEGRAM }),

  node('b2000000-0019-4000-8000-000000000019', 'Mark Reminder Sent', 'n8n-nodes-base.code', [-540, 820], { jsCode: MARK_REMINDER_SENT }),

  node('b2000000-0029-4000-8000-000000000029', 'Prepare Bookings File (Reminder)', 'n8n-nodes-base.code', [-300, 820], { jsCode: PREPARE_BOOKINGS_FILE }),

  node('b2000000-0030-4000-8000-000000000030', 'Write Bookings File (Reminder)', 'n8n-nodes-base.writeBinaryFile', [-60, 820], {
    fileName: '={{ $json.bookings_file_path }}',
    dataPropertyName: 'data',
    options: {},
  }),

  node('b2000000-0020-4000-8000-000000000020', 'Return Reminder Result', 'n8n-nodes-base.code', [180, 820], { jsCode: RETURN_RESULT }),

  node('b2000000-0021-4000-8000-000000000021', 'Note: Workflow', 'n8n-nodes-base.stickyNote', [-1520, -80], {
    width: 540,
    height: 300,
    content: '## Appointment Booking Agent\n\n**Flow:** Category → Service → (Venue) → Date → Time → Details → Book → Email + Telegram Confirm → Reminder\n\n**Catalog:** `scripts/appointment-services.js` + requirements in `scripts/appointment-requirements.js`\n\n**Email:** SMTP via `.env` (SMTP_USER, SMTP_PASS, EMAIL_FROM) — sent to customer email on booking\n\n**Telegram:** `/book` to start, `/cancel` to reset, `back` to change category\n\n**Webhooks:**\n- `POST /webhook/appointment-booking-agent-telegram`\n- `POST /webhook/appointment-booking-agent`',
  }),
];

const connections = {
  'Telegram Webhook': { main: [[{ node: 'Adapt Telegram Payload', type: 'main', index: 0 }]] },
  'Adapt Telegram Payload': { main: [[{ node: 'Merge Triggers', type: 'main', index: 0 }]] },
  'Webhook Trigger': { main: [[{ node: 'Merge Triggers', type: 'main', index: 0 }]] },
  'Manual Trigger': { main: [[{ node: 'Set: Sample Payload', type: 'main', index: 0 }]] },
  'Set: Sample Payload': { main: [[{ node: 'Merge Triggers', type: 'main', index: 1 }]] },
  'Merge Triggers': { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
  'Normalize Input': { main: [[{ node: 'Process Booking Conversation', type: 'main', index: 0 }]] },
  'Process Booking Conversation': { main: [[{ node: 'IF Storage Dirty?', type: 'main', index: 0 }]] },
  'IF Storage Dirty?': {
    main: [
      [{ node: 'Prepare Sessions File', type: 'main', index: 0 }],
      [{ node: 'Switch on Action', type: 'main', index: 0 }],
    ],
  },
  'Prepare Sessions File': { main: [[{ node: 'Write Sessions File', type: 'main', index: 0 }]] },
  'Write Sessions File': { main: [[{ node: 'Restore Session Context', type: 'main', index: 0 }]] },
  'Restore Session Context': { main: [[{ node: 'Switch on Action', type: 'main', index: 0 }]] },
  'Switch on Action': {
    main: [
      [{ node: 'Save in DB', type: 'main', index: 0 }],
      [{ node: 'Send Telegram Reply', type: 'main', index: 0 }],
      [{ node: 'Return Result', type: 'main', index: 0 }],
    ],
  },
  'Save in DB': {
    main: [[
      { node: 'Send Confirmation Email', type: 'main', index: 0 },
      { node: 'Prepare Bookings File', type: 'main', index: 0 },
    ]],
  },
  'Prepare Bookings File': { main: [[{ node: 'Write Bookings File', type: 'main', index: 0 }]] },
  'Write Bookings File': { main: [[{ node: 'Prepare Calendar File', type: 'main', index: 0 }]] },
  'Prepare Calendar File': { main: [[{ node: 'Write Calendar File', type: 'main', index: 0 }]] },
  'Send Confirmation Email': { main: [[{ node: 'Send Confirmation', type: 'main', index: 0 }]] },
  'Send Confirmation': { main: [[{ node: 'Return Result', type: 'main', index: 0 }]] },
  'Send Telegram Reply': { main: [[{ node: 'Return Result', type: 'main', index: 0 }]] },
  'Reminder Schedule': { main: [[{ node: 'Check Upcoming Reminders', type: 'main', index: 0 }]] },
  'Check Upcoming Reminders': { main: [[{ node: 'IF Reminders Due?', type: 'main', index: 0 }]] },
  'IF Reminders Due?': {
    main: [
      [{ node: 'Send Reminder', type: 'main', index: 0 }],
      [{ node: 'Return Reminder Result', type: 'main', index: 0 }],
    ],
  },
  'Send Reminder': { main: [[{ node: 'Mark Reminder Sent', type: 'main', index: 0 }]] },
  'Mark Reminder Sent': { main: [[{ node: 'Prepare Bookings File (Reminder)', type: 'main', index: 0 }]] },
  'Prepare Bookings File (Reminder)': { main: [[{ node: 'Write Bookings File (Reminder)', type: 'main', index: 0 }]] },
  'Write Bookings File (Reminder)': { main: [[{ node: 'Return Reminder Result', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'Appointment Booking Agent',
  nodes,
  connections,
  active: true,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    callerPolicy: 'workflowsFromSameOwner',
  },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [
    { name: 'appointment' },
    { name: 'telegram' },
    { name: 'booking' },
  ],
};

const outPath = path.join(__dirname, '..', 'workflows', 'appointment-booking-agent.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2) + '\n');
console.log('Wrote', outPath);
