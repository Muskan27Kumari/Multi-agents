#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, 'workflows', 'portfolio-market-report.json');
const codePath = path.join(__dirname, 'portfolio-process-holdings.js');

const wf = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = wf.nodes.find((n) => n.name === 'Process All Holdings');
if (!node) {
  console.error('Process All Holdings node not found');
  process.exit(1);
}

node.parameters.jsCode = fs.readFileSync(codePath, 'utf8');
fs.writeFileSync(workflowPath, `${JSON.stringify(wf, null, 2)}\n`);
console.log('Synced Process All Holdings code into portfolio-market-report.json');
