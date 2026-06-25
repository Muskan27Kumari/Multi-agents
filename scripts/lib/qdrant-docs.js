/**
 * Stable document IDs and Qdrant helpers (shared by CLI, sync, and deploy scripts).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');

loadEnv(path.join(__dirname, '../..'));

const COLLECTION = 'knowledge_base';

function qdrantCandidates() {
  const configured = String(process.env.QDRANT_URL || '').trim().replace(/\/$/, '');
  const port = process.env.QDRANT_PORT || 6333;
  const candidates = [];
  if (configured) candidates.push(configured);
  candidates.push(`http://127.0.0.1:${port}`, `http://localhost:${port}`);
  if (!configured || !configured.includes('qdrant:')) {
    candidates.push('http://qdrant:6333');
  }
  return [...new Set(candidates)];
}

let resolvedQdrantUrl = '';

function qdrantUrl() {
  if (resolvedQdrantUrl) return resolvedQdrantUrl;
  resolvedQdrantUrl = qdrantCandidates()[0];
  return resolvedQdrantUrl;
}

function contentHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function documentIdFromFile(filePath) {
  return `doc_${contentHash(filePath).slice(0, 16)}`;
}

function documentIdForUser(filePath, userId) {
  const hash = contentHash(filePath);
  const userPart = crypto.createHash('sha256').update(String(userId || '')).digest('hex').slice(0, 8);
  return `doc_${userPart}_${hash.slice(0, 16)}`;
}

function documentIdFromText(text) {
  return `doc_${crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16)}`;
}

async function qdrantRequest(endpoint, body) {
  let lastErr;
  for (const base of qdrantCandidates()) {
    try {
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.status?.error || JSON.stringify(data).slice(0, 200));
      }
      resolvedQdrantUrl = base;
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Cannot reach Qdrant');
}

async function qdrantHasDocument(documentId) {
  try {
    const data = await qdrantRequest(`/collections/${COLLECTION}/points/count`, {
      filter: { must: [{ key: 'document_id', match: { value: documentId } }] },
      exact: true,
    });
    return Number(data.result?.count || 0) > 0;
  } catch {
    return false;
  }
}

async function qdrantChunkCount(documentId) {
  try {
    const data = await qdrantRequest(`/collections/${COLLECTION}/points/count`, {
      filter: { must: [{ key: 'document_id', match: { value: documentId } }] },
      exact: true,
    });
    return Number(data.result?.count || 0);
  } catch {
    return 0;
  }
}

async function qdrantDeleteDocument(documentId) {
  try {
    await qdrantRequest(`/collections/${COLLECTION}/points/delete?wait=true`, {
      filter: { must: [{ key: 'document_id', match: { value: documentId } }] },
    });
    return true;
  } catch (err) {
    if (String(err.message).includes('404')) return false;
    throw err;
  }
}

async function qdrantDeleteByUserId(userId) {
  const id = String(userId || '').trim();
  if (!id) return 0;
  try {
    const countData = await qdrantRequest(`/collections/${COLLECTION}/points/count`, {
      filter: { must: [{ key: 'user_id', match: { value: id } }] },
      exact: true,
    });
    const count = Number(countData.result?.count || 0);
    if (!count) return 0;
    await qdrantRequest(`/collections/${COLLECTION}/points/delete?wait=true`, {
      filter: { must: [{ key: 'user_id', match: { value: id } }] },
    });
    return count;
  } catch (err) {
    if (String(err.message).includes('404')) return 0;
    throw err;
  }
}

async function qdrantScrollAll() {
  const points = [];
  let offset = null;
  do {
    const body = { limit: 256, with_payload: true };
    if (offset) body.offset = offset;
    const data = await qdrantRequest(`/collections/${COLLECTION}/points/scroll`, body);
    points.push(...(data.result?.points || []));
    offset = data.result?.next_page_offset ?? null;
  } while (offset);
  return points;
}

module.exports = {
  COLLECTION,
  qdrantUrl,
  contentHash,
  documentIdFromFile,
  documentIdForUser,
  documentIdFromText,
  qdrantHasDocument,
  qdrantChunkCount,
  qdrantDeleteDocument,
  qdrantDeleteByUserId,
  qdrantScrollAll,
};
