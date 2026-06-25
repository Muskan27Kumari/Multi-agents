#!/usr/bin/env node
'use strict';

const fs = require('fs');

const [workflowPath, importPath, workflowId] = process.argv.slice(2);
if (!workflowPath || !importPath || !workflowId) {
  console.error('Usage: prepare-import.js <workflow.json> <import.json> <workflow-id>');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
workflow.id = workflowId;
workflow.active = true;
workflow.isArchived = false;
fs.writeFileSync(importPath, JSON.stringify([workflow], null, 2));
