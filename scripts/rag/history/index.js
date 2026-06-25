const { embeddingHelpersCode } = require('../lib/embeddings');
const { qdrantHelpersCode } = require('../lib/qdrant');

const DEFAULT_HISTORY_COLLECTION = 'query_history';

const searchQueryHistoryCode = `${qdrantHelpersCode}

const item = $input.first().json;
const enabled = item.enable_query_history !== false;

if (!enabled) {
  return [{
    json: {
      ...item,
      history_hits: [],
      history_context: '',
      history_relevant_count: 0,
      history_collection: item.history_collection_name || '${DEFAULT_HISTORY_COLLECTION}',
    },
  }];
}

const qdrantUrl = await resolveQdrantUrl.call(this, item);
const collection = String(item.history_collection_name || '${DEFAULT_HISTORY_COLLECTION}').trim();
const topK = Math.min(Math.max(Number(item.history_top_k || 3), 1), 10);
const threshold = Number(item.history_score_threshold ?? 0.4);
const vector = item.query_embedding;
const userId = String(item.user_id || '').trim();
const currentRunId = String(item.run_id || '').trim();

const searchBody = {
  vector,
  limit: topK + 2,
  with_payload: true,
};

const filterMust = [{ key: 'record_type', match: { value: 'query_history' } }];
if (userId) filterMust.push({ key: 'user_id', match: { value: userId } });
searchBody.filter = { must: filterMust };

let hits = [];
try {
  const searchResponse = await this.helpers.httpRequest({
    method: 'POST',
    url: \`\${qdrantUrl}/collections/\${collection}/points/search\`,
    body: searchBody,
    json: true,
    timeout: 60000,
  });
  hits = (searchResponse.result || [])
    .filter((h) => Number(h.score || 0) >= threshold)
    .filter((h) => String(h.payload?.run_id || '') !== currentRunId)
    .slice(0, topK)
    .map((h, i) => ({
      rank: i + 1,
      score: h.score,
      run_id: h.payload?.run_id,
      question: h.payload?.question,
      answer: h.payload?.answer,
      created_at: h.payload?.created_at,
    }));
} catch (err) {
  const status = err?.statusCode || err?.response?.statusCode;
  const msg = String(err?.message || '');
  if (status !== 404 && !msg.includes('404') && !msg.toLowerCase().includes("doesn't exist")) {
    throw err;
  }
}

const historyContext = hits
  .map((h, i) => \`[\${i + 1}] (prior Q&A | score \${(h.score || 0).toFixed(3)})\\nQ: \${h.question}\\nA: \${h.answer}\`)
  .join('\\n\\n---\\n\\n');

return [{
  json: {
    ...item,
    history_hits: hits,
    history_context: historyContext,
    history_relevant_count: hits.length,
    history_collection: collection,
    history_qdrant_url: qdrantUrl,
  },
}];`;

const saveQueryHistoryCode = `${qdrantHelpersCode}

async function ensureCollection(qdrantUrl, collection, vectorSize) {
  try {
    await this.helpers.httpRequest({
      method: 'PUT',
      url: \`\${qdrantUrl}/collections/\${collection}\`,
      body: { vectors: { size: vectorSize, distance: 'Cosine' } },
      json: true,
      timeout: 30000,
    });
  } catch (err) {
    const status = err?.statusCode || err?.response?.statusCode;
    const msg = String(err?.message || '');
    if (status === 409 || msg.includes('409') || msg.toLowerCase().includes('already exists')) return;
    throw err;
  }
}

const item = $input.first().json;
if (item.enable_query_history === false || item.action !== 'query') {
  return [{ json: { ...item, history_saved: false } }];
}

const question = String(item.question || '').trim();
const answer = String(item.answer || '').replace(/^Source:[^\\n]*\\n\\n?/i, '').trim();
if (!question || !answer) {
  return [{ json: { ...item, history_saved: false, history_save_error: 'Missing question or answer' } }];
}

const qdrantUrl = item.history_qdrant_url || (await resolveQdrantUrl.call(this, item));
const collection = String(item.history_collection_name || '${DEFAULT_HISTORY_COLLECTION}').trim();
const runId = String(item.run_id || \`rag_\${Date.now()}\`).trim();
const userId = String(item.user_id || '').trim();
const createdAt = item.answered_at || new Date().toISOString();

const historyText = 'Question: ' + question + '\\nAnswer: ' + answer;
let vector = item.query_embedding;
try {
  const embNode = $('Generate Query Embedding').first().json;
  if (embNode?.query_embedding?.length) vector = embNode.query_embedding;
} catch (e) {}
if (!vector?.length) {
  return [{ json: { ...item, history_saved: false, history_save_error: 'Missing query_embedding for history save' } }];
}
const vectorSize = vector.length;

await ensureCollection.call(this, qdrantUrl, collection, vectorSize);

function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function historyPointId(runId) {
  const key = 'history:' + runId;
  const parts = [
    fnv1a(key),
    fnv1a(key, 0x9e3779b9),
    fnv1a(key, 0x85ebca6b),
    fnv1a(key, 0xc2b2ae35),
  ].map((n) => n.toString(16).padStart(8, '0'));
  const hex = parts.join('');
  return \`\${hex.slice(0, 8)}-\${hex.slice(8, 12)}-\${hex.slice(12, 16)}-\${hex.slice(16, 20)}-\${hex.slice(20, 32)}\`;
}
const pointId = historyPointId(runId);

await this.helpers.httpRequest({
  method: 'PUT',
  url: \`\${qdrantUrl}/collections/\${collection}/points?wait=true\`,
  body: {
    points: [{
      id: pointId,
      vector,
      payload: {
        record_type: 'query_history',
        run_id: runId,
        question,
        answer,
        source_used: item.source_used || null,
        user_id: userId || null,
        created_at: createdAt,
        text: historyText,
      },
    }],
  },
  json: true,
  timeout: 60000,
});

let jsonlAppended = false;
try {
  const fs = require('fs');
  const dir = '/files/query-history';
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    run_id: runId,
    question,
    answer,
    source_used: item.source_used,
    user_id: userId || null,
    created_at: createdAt,
  });
  fs.appendFileSync(dir + '/history.jsonl', line + '\\n', 'utf8');
  jsonlAppended = true;
} catch (e) {
  // non-fatal — Qdrant is primary store
}

return [{
  json: {
    ...item,
    history_saved: true,
    history_save_error: null,
    history_jsonl_appended: jsonlAppended,
    history_point_id: pointId,
    history_collection: collection,
  },
}];`;

function historyPromptBlock(itemVar) {
  return `const historyCtx = String(${itemVar}.history_context || '').trim();
const historyBlock = historyCtx
  ? 'Prior related questions and answers from this user (use for continuity; prefer document/external context when they conflict):\\n' + historyCtx + '\\n\\n'
  : '';`;
}

module.exports = {
  DEFAULT_HISTORY_COLLECTION,
  searchQueryHistoryCode,
  saveQueryHistoryCode,
  historyPromptBlock,
};
