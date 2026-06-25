#!/usr/bin/env node
'use strict';

const { cmdUp, cmdDown, cmdStatus, runBashScript } = require('./lib/docker-cli');

const USAGE = `n8n-flow — cross-platform project commands (macOS, Linux, Windows)

Usage:
  node scripts/run.js <command> [options]

Commands:
  up              Start n8n + Qdrant + Telegram + dedicated bots
  down            Stop all services (including Telegram profiles)
  status          Show running containers
  setup-bots      Configure Telegram bot names and menus
  deploy:rag      Build and deploy RAG Knowledge Agent
  deploy:review   Deploy Customer Review Responder
  deploy:booking  Deploy Appointment Booking Agent
  deploy:aux      Deploy marketing, portfolio, resume, HR workflows
  deploy:all      Deploy every workflow

npm shortcuts (same commands):
  npm start       → up
  npm stop        → down
  npm run status
  npm run setup:bots
  npm run deploy:all

Windows: install Docker Desktop + Git for Windows (Git Bash) for deploy scripts.
macOS:   Docker Desktop + Node.js 18+.
`;

const command = String(process.argv[2] || 'help').toLowerCase();
const extraArgs = process.argv.slice(3);

switch (command) {
  case 'up':
  case 'start':
    cmdUp(extraArgs);
    break;
  case 'down':
  case 'stop':
    cmdDown(extraArgs);
    break;
  case 'status':
    cmdStatus();
    break;
  case 'setup-bots':
  case 'setup:bots':
    runBashScript('setup-telegram-bots.sh', extraArgs);
    break;
  case 'deploy:rag':
    runBashScript('deploy-rag-workflow.sh', extraArgs);
    break;
  case 'deploy:review':
    runBashScript('deploy-customer-review-responder.sh', extraArgs);
    break;
  case 'deploy:booking':
    runBashScript('deploy-appointment-booking-workflow.sh', extraArgs);
    break;
  case 'deploy:aux':
    runBashScript('deploy-aux-workflows.sh', extraArgs);
    break;
  case 'deploy:all':
    runBashScript('deploy-rag-workflow.sh');
    runBashScript('deploy-customer-review-responder.sh');
    runBashScript('deploy-appointment-booking-workflow.sh');
    runBashScript('deploy-aux-workflows.sh');
    break;
  case 'help':
  case '-h':
  case '--help':
    process.stdout.write(USAGE);
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    process.stdout.write(USAGE);
    process.exit(1);
}
