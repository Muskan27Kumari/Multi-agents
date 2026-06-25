#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resumeAiHelpersCode } = require('./resume-ai-helpers');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, 'workflows', 'resume-analysis-agent.json');

const wf = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const normalize = wf.nodes.find((n) => n.name === 'Normalize Input');
if (!normalize) {
  console.error('Normalize Input node not found');
  process.exit(1);
}

const assignments = normalize.parameters.assignments.assignments;
const setField = (name, value) => {
  const field = assignments.find((a) => a.name === name);
  if (field) field.value = value;
  else assignments.push({ id: name, name, value, type: 'string' });
};

setField(
  'candidate_email',
  "={{ ($json.body?.candidate_email || $json.candidate_email || '').toString().trim() }}"
);
setField(
  'openai_api_key',
  "={{ ($json.body?.openai_api_key || $json.openai_api_key || $json.body?.openrouter_api_key || $json.openrouter_api_key || $env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '').toString().trim().replace(/^Bearer\\s+/i, '') }}"
);
setField(
  'openrouter_api_key',
  "={{ ($json.body?.openai_api_key || $json.openai_api_key || $json.body?.openrouter_api_key || $json.openrouter_api_key || $env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '').toString().trim().replace(/^Bearer\\s+/i, '') }}"
);
setField(
  'openai_model',
  "={{ ($json.body?.openai_model || $json.openai_model || $json.body?.openrouter_model || $json.openrouter_model || $env.OPENAI_MODEL || 'gpt-4o-mini').toString().trim() }}"
);
setField(
  'openrouter_model',
  "={{ ($json.body?.openai_model || $json.openai_model || $json.body?.openrouter_model || $json.openrouter_model || $env.OPENAI_MODEL || 'gpt-4o-mini').toString().trim() }}"
);
setField(
  'telegram_bot_token',
  "={{ ($json.body?.telegram_bot_token || $json.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').toString().trim() }}"
);
setField(
  'telegram_chat_id',
  "={{ ($json.body?.telegram_chat_id || $json.telegram_chat_id || $env.TELEGRAM_CHAT_ID || '').toString().trim() }}"
);
setField(
  'notify_email',
  '={{ Boolean($json.body?.notify_email ?? $json.notify_email ?? false) }}'
);

const AI_NODES = ['AI Resume Analysis', 'Extract Resume Job Title', 'Rank Best Job Title'];

for (const nodeName of AI_NODES) {
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node?.parameters?.jsCode) {
    console.error(`Node not found: ${nodeName}`);
    process.exit(1);
  }
  let code = node.parameters.jsCode;
  const bodyStart = code.search(/\nconst item = \$json;/);
  if (bodyStart === -1) {
    console.error(`Could not find main body in ${nodeName}`);
    process.exit(1);
  }
  code = `${resumeAiHelpersCode}\n${code.slice(bodyStart + 1)}`;
  code = code.replace(/await getOpenRouterKey\.call\(this, item\)/g, 'await getAiApiKey.call(this, item)');
  code = code.replace(
    /const apiKey = await getAiApiKey\.call\(this, item\);\s*const apiKey = await getAiApiKey\.call\(this, item\);/g,
    'const apiKey = await getAiApiKey.call(this, item);'
  );
  code = code.replace(
    /const apiKey = await getOpenRouterKey\.call\(this, item\);\s*const model = item\.openrouter_model \|\| 'openai\/gpt-4o-mini';/g,
    'const apiKey = await getAiApiKey.call(this, item);\nconst model = normalizeModel(item.openai_model || item.openrouter_model, apiKey);'
  );
  code = code.replace(
    /const model = item\.openrouter_model \|\| 'openai\/gpt-4o-mini';/g,
    'const model = normalizeModel(item.openai_model || item.openrouter_model, apiKey);'
  );
  code = code.replace(
    "url: 'https://openrouter.ai/api/v1/chat/completions'",
    'url: chatCompletionsUrl(apiKey)'
  );
  code = code.replace(
    'url: `https://openrouter.ai/api/v1/chat/completions`',
    'url: chatCompletionsUrl(apiKey)'
  );
  node.parameters.jsCode = code;
}

fs.writeFileSync(workflowPath, `${JSON.stringify(wf, null, 2)}\n`);
console.log('Synced resume workflow: Normalize Input + AI nodes');
