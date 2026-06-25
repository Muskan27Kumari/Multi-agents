#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, 'workflows', 'marketing-content-agent.json');
const codePath = path.join(__dirname, 'marketing-openrouter-ai.js');

const wf = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = wf.nodes.find((n) => n.name === 'OpenRouter AI');
if (!node) {
  console.error('OpenRouter AI node not found');
  process.exit(1);
}

node.parameters.jsCode = fs.readFileSync(codePath, 'utf8');
fs.writeFileSync(workflowPath, `${JSON.stringify(wf, null, 2)}\n`);
console.log('Synced OpenRouter AI code into marketing-content-agent.json');
