#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadEnv } = require('./lib/env');

loadEnv(path.join(__dirname, '..'));

const TOKENS_TO_CHECK = [
  { name: 'TELEGRAM_BOT_TOKEN', label: 'Shared Universe Bot' },
  { name: 'TELEGRAM_BOT_TOKEN_RAG', label: 'RAG Knowledge Assistant' },
  { name: 'TELEGRAM_BOT_TOKEN_REVIEW', label: 'Review Analyzer' },
  { name: 'TELEGRAM_BOT_TOKEN_BOOKING', label: 'Appointment Booking' },
  { name: 'TELEGRAM_BOT_TOKEN_MARKETING', label: 'Marketing Content' },
  { name: 'TELEGRAM_BOT_TOKEN_PORTFOLIO', label: 'Portfolio Report' },
  { name: 'TELEGRAM_BOT_TOKEN_RESUME', label: 'Resume Analyzer' },
  { name: 'TELEGRAM_BOT_TOKEN_HR', label: 'HR Recruitment' },
  { name: 'TELEGRAM_BOT_TOKEN_DRIVE_RAG', label: 'Drive Assistant' }
];

function fetchTelegram(token, method) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function diagnose() {
  console.log('=== VGI Telegram Bot Diagnostics ===\n');
  
  for (const item of TOKENS_TO_CHECK) {
    const token = process.env[item.name];
    if (!token) {
      console.log(`[ ] ${item.label} (${item.name}): NOT CONFIGURED (empty/missing in .env)`);
      continue;
    }
    
    console.log(`[*] Checking ${item.label} (${item.name})...`);
    try {
      const data = await fetchTelegram(token, 'getMe');
      if (data.ok) {
        console.log(`    --> SUCCESS! Username: @${data.result.username}, Name: "${data.result.first_name}"`);
      } else {
        console.log(`    --> FAILED: ${data.description || 'Unknown error'}`);
      }
    } catch (e) {
      console.log(`    --> ERROR: ${e.message}`);
    }
  }
}

diagnose();
