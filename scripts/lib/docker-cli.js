#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');

const ROOT = path.resolve(__dirname, '..', '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yml');

function env(name) {
  return String(process.env[name] || '').trim();
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    shell: false,
    ...options,
  });
  return result;
}

function dockerComposeArgs(profiles = []) {
  const args = ['compose', '-f', COMPOSE_FILE];
  for (const profile of profiles) {
    args.push('--profile', profile);
  }
  return args;
}

function dockerCompose(profiles, composeArgs, options = {}) {
  const args = [...dockerComposeArgs(profiles), ...composeArgs];
  return run('docker', args, options);
}

function dockerComposeOut(profiles, composeArgs) {
  const result = dockerCompose(profiles, composeArgs);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `docker compose failed: ${composeArgs.join(' ')}`);
  }
  return (result.stdout || '').trim();
}

function dockerPsOut(args) {
  const result = run('docker', args);
  if (result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function n8nContainer() {
  if (env('N8N_CONTAINER')) return env('N8N_CONTAINER');

  const name = dockerComposeOut([], ['ps', '--format', '{{.Name}}', 'n8n']).split('\n')[0];
  if (name) return name;

  const filtered = dockerPsOut([
    'ps',
    '--filter', 'label=com.docker.compose.service=n8n',
    '--format', '{{.Names}}',
  ]);
  if (filtered) return filtered.split('\n')[0];

  return 'n8n-flow-n8n-1';
}

function serviceContainerId(profiles, service) {
  return dockerComposeOut(profiles, ['ps', '-q', service]).split('\n')[0] || '';
}

function stopContainersByLabel(service, keepId = '') {
  const ids = dockerPsOut([
    'ps', '-q', '--no-trunc',
    '--filter', `label=com.docker.compose.service=${service}`,
  ]).split('\n').filter(Boolean);

  for (const cid of ids) {
    if (keepId && cid === keepId) continue;
    const name = dockerPsOut(['inspect', '-f', '{{.Name}}', cid]).replace(/^\//, '') || cid;
    console.log(`Stopping duplicate ${service}: ${name}`);
    run('docker', ['stop', cid], { stdio: 'ignore' });
    run('docker', ['rm', cid], { stdio: 'ignore' });
  }
}

function stopDuplicateTelegramPollers() {
  const currentId = serviceContainerId(['telegram'], 'telegram-bot');
  stopContainersByLabel('telegram-bot', currentId);
}

function stopDuplicateDriveRagPollers() {
  if (!env('TELEGRAM_BOT_TOKEN_DRIVE_RAG')) return;
  const currentId = serviceContainerId(['telegram-dedicated'], 'telegram-bot-drive-rag');
  stopContainersByLabel('telegram-bot-drive-rag', currentId);
}

function stopDriveRagBot() {
  const id = serviceContainerId(['telegram-dedicated'], 'telegram-bot-drive-rag');
  if (!id) return;
  console.log('Stopping telegram-bot-drive-rag (token conflict with Knowledge Assistant)');
  dockerCompose(['telegram-dedicated'], ['stop', 'telegram-bot-drive-rag'], { stdio: 'inherit' });
  dockerCompose(['telegram-dedicated'], ['rm', '-f', 'telegram-bot-drive-rag'], { stdio: 'inherit' });
}

function stopLegacyRagBot() {
  const id = serviceContainerId(['telegram-rag-legacy'], 'telegram-bot-rag');
  if (!id) return;
  console.log('Stopping legacy telegram-bot-rag');
  dockerCompose(['telegram-rag-legacy'], ['stop', 'telegram-bot-rag'], { stdio: 'inherit' });
  dockerCompose(['telegram-rag-legacy'], ['rm', '-f', 'telegram-bot-rag'], { stdio: 'inherit' });
}

function startDedicatedBot(service, tokenVar, profile = 'telegram-dedicated') {
  if (!env(tokenVar)) {
    const id = serviceContainerId([profile], service);
    if (id) {
      console.log(`Stopping ${service} (no ${tokenVar})`);
      dockerCompose([profile], ['stop', service], { stdio: 'inherit' });
      dockerCompose([profile], ['rm', '-f', service], { stdio: 'inherit' });
    }
    return;
  }
  console.log(`Starting dedicated Telegram bot: ${service}`);
  dockerCompose([profile], ['up', '-d', '--force-recreate', service], { stdio: 'inherit' });
}

function startAllDedicatedTelegramBots() {
  loadEnv(ROOT);
  const driveToken = env('TELEGRAM_BOT_TOKEN_DRIVE_RAG');
  const ragToken = env('TELEGRAM_BOT_TOKEN_RAG');

  if (ragToken && driveToken && ragToken === driveToken) {
    stopDriveRagBot();
  }

  if (ragToken && (!driveToken || ragToken !== driveToken)) {
    startDedicatedBot('telegram-bot-rag', 'TELEGRAM_BOT_TOKEN_RAG', 'telegram-rag-legacy');
  } else {
    stopLegacyRagBot();
  }

  if (driveToken && (!ragToken || ragToken !== driveToken)) {
    stopDuplicateDriveRagPollers();
    startDedicatedBot('telegram-bot-drive-rag', 'TELEGRAM_BOT_TOKEN_DRIVE_RAG');
  } else {
    stopDriveRagBot();
  }

  startDedicatedBot('telegram-bot-review', 'TELEGRAM_BOT_TOKEN_REVIEW');
  startDedicatedBot('telegram-bot-booking', 'TELEGRAM_BOT_TOKEN_BOOKING');
  startDedicatedBot('telegram-bot-marketing', 'TELEGRAM_BOT_TOKEN_MARKETING');
  startDedicatedBot('telegram-bot-portfolio', 'TELEGRAM_BOT_TOKEN_PORTFOLIO');
  startDedicatedBot('telegram-bot-resume', 'TELEGRAM_BOT_TOKEN_RESUME');
  startDedicatedBot('telegram-bot-hr', 'TELEGRAM_BOT_TOKEN_HR');
}

function cmdUp(extraArgs = []) {
  loadEnv(ROOT);
  stopDuplicateTelegramPollers();
  const result = dockerCompose(['telegram'], ['up', '-d', ...extraArgs], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  startAllDedicatedTelegramBots();
}

function cmdDown(extraArgs = []) {
  const result = dockerCompose(
    ['telegram', 'telegram-dedicated', 'telegram-rag-legacy'],
    ['down', ...extraArgs],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}

function cmdStatus() {
  loadEnv(ROOT);
  console.log('Project root:', ROOT);
  console.log('n8n container:', n8nContainer());
  console.log('');
  dockerCompose([], ['ps'], { stdio: 'inherit' });
}

function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [
    process.env.BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function runBashScript(scriptName, args = []) {
  const bash = findBash();
  const scriptPath = path.join(ROOT, 'scripts', scriptName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }
  if (!bash) {
    console.error('Bash is required for deploy scripts on Windows.');
    console.error('Install Git for Windows (includes Git Bash): https://git-scm.com/download/win');
    console.error('Or use WSL, then run: npm run <command>');
    process.exit(1);
  }
  const result = spawnSync(bash, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

module.exports = {
  ROOT,
  COMPOSE_FILE,
  n8nContainer,
  cmdUp,
  cmdDown,
  cmdStatus,
  runBashScript,
  startAllDedicatedTelegramBots,
  stopDuplicateTelegramPollers,
};
