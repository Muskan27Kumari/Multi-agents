#!/usr/bin/env node
/**
 * CLI for stable document IDs and Qdrant deduplication.
 *
 * Usage:
 *   node document-id.js from-file <path>
 *   node document-id.js should-ingest <path> [--force]
 *   node document-id.js dedupe [--apply]
 */
const fs = require('fs');
const path = require('path');
const {
  contentHash,
  documentIdFromFile,
  documentIdFromText,
  qdrantHasDocument,
  qdrantDeleteDocument,
  qdrantScrollAll,
} = require('./qdrant-docs');

async function cmdDedupe(apply) {
  const points = await qdrantScrollAll();
  const byTitle = new Map();

  for (const point of points) {
    const title = String(point.payload?.document_title || '').trim() || '(untitled)';
    const docId = String(point.payload?.document_id || '').trim();
    if (!docId) continue;
    if (!byTitle.has(title)) byTitle.set(title, new Map());
    const ids = byTitle.get(title);
    ids.set(docId, (ids.get(docId) || 0) + 1);
  }

  const toDelete = [];
  for (const [title, idCounts] of byTitle) {
    const ids = [...idCounts.keys()];
    if (ids.length <= 1) continue;

    const preferred = ids.find((id) => /^doc_[a-f0-9]{16}$/.test(id))
      || ids.find((id) => id.startsWith('gdrive_'))
      || ids.reduce((a, b) => (idCounts.get(a) >= idCounts.get(b) ? a : b));

    for (const id of ids) {
      if (id !== preferred) toDelete.push({ title, document_id: id, chunks: idCounts.get(id) });
    }
  }

  if (!toDelete.length) {
    console.log('No duplicate document embeddings found.');
    return;
  }

  console.log(`Found ${toDelete.length} duplicate document_id(s) to remove:`);
  for (const row of toDelete) {
    console.log(`  - ${row.title}: ${row.document_id} (${row.chunks} chunks)`);
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with: node scripts/lib/document-id.js dedupe --apply');
    return;
  }

  for (const row of toDelete) {
    await qdrantDeleteDocument(row.document_id);
    console.log(`  ✓ deleted ${row.document_id}`);
  }
  console.log('Dedupe complete.');
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force') || arg === '--force';
  const apply = rest.includes('--apply') || arg === '--apply';

  switch (cmd) {
    case 'from-file': {
      if (!arg || !fs.existsSync(arg)) {
        console.error('Usage: document-id.js from-file <path>');
        process.exit(1);
      }
      console.log(documentIdFromFile(path.resolve(arg)));
      break;
    }
    case 'content-hash': {
      if (!arg || !fs.existsSync(arg)) {
        console.error('Usage: document-id.js content-hash <path>');
        process.exit(1);
      }
      console.log(contentHash(path.resolve(arg)));
      break;
    }
    case 'from-text': {
      console.log(documentIdFromText(arg || ''));
      break;
    }
    case 'exists': {
      process.exit((await qdrantHasDocument(arg)) ? 0 : 1);
    }
    case 'should-ingest': {
      if (!arg || !fs.existsSync(arg)) {
        console.error('Usage: document-id.js should-ingest <path> [--force]');
        process.exit(2);
      }
      if (force) process.exit(0);
      const docId = documentIdFromFile(path.resolve(arg));
      process.exit((await qdrantHasDocument(docId)) ? 1 : 0);
    }
    case 'delete': {
      if (!arg) {
        console.error('Usage: document-id.js delete <documentId>');
        process.exit(1);
      }
      await qdrantDeleteDocument(arg);
      console.log(`Deleted embeddings for ${arg}`);
      break;
    }
    case 'dedupe': {
      await cmdDedupe(apply);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd || '(none)'}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
