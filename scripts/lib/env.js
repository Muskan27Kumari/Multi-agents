#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(root) {
  const envPath = path.join(root || path.join(__dirname, '..', '..'), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function publicN8nUrl() {
  const base = String(process.env.N8N_PUBLIC_URL || process.env.WEBHOOK_URL || 'http://localhost:5678')
    .trim()
    .replace(/\/$/, '');
  return base || 'http://localhost:5678';
}

function internalN8nUrl() {
  return String(process.env.N8N_INTERNAL_URL || 'http://n8n:5678').trim().replace(/\/$/, '');
}

function webhookUrl(pathSuffix, fallbackPath) {
  const explicit = String(process.env[pathSuffix] || '').trim();
  if (explicit) return explicit;
  return `${publicN8nUrl()}${fallbackPath}`;
}

module.exports = {
  loadEnv,
  publicN8nUrl,
  internalN8nUrl,
  webhookUrl,
};
