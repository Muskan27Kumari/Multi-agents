const { embeddingHelpersCode } = require('../lib/embeddings');
const { qdrantHelpersCode } = require('../lib/qdrant');
const { openRouterChatHelpersCode } = require('../lib/openrouter');
const { answerFormatHelpersCode } = require('../lib/answerFormat');
const { tryExternalProvidersCode } = require('../providers/registry');

const SOURCE_QDRANT = 'Qdrant Knowledge Base';
const SOURCE_EXTERNAL = 'External Search';
const SOURCE_LLM = 'LLM General Knowledge';
const SOURCE_OUT_OF_SCOPE = 'Out of Scope';

const OUT_OF_SCOPE_MESSAGE =
  "I can only answer questions that are covered in our knowledge base. Your question doesn't match any ingested documents. Please ask about a topic from our uploaded materials, or contact the team if you need help with something else.";

const searchQdrantCode = `${qdrantHelpersCode}

const item = $input.first().json;
const qdrantUrl = await resolveQdrantUrl.call(this, item);
const collection = String(item.collection_name || 'knowledge_base').trim();
const topK = Math.min(Math.max(Number(item.top_k || 5), 1), 20);
const vector = item.query_embedding;
const targetDocumentId = String(item.document_id || '').trim();
const userId = String(item.user_id || '').trim();
const filterByUser = item.filter_results_by_user_id === true;

const searchBody = {
  vector,
  limit: topK,
  with_payload: true,
  score_threshold: Number(item.score_threshold || 0),
};

const filterMust = [];
if (targetDocumentId) {
  filterMust.push({ key: 'document_id', match: { value: targetDocumentId } });
}
if (filterByUser && userId) {
  filterMust.push({ key: 'user_id', match: { value: userId } });
}
if (filterMust.length) {
  searchBody.filter = { must: filterMust };
}

const searchResponse = await this.helpers.httpRequest({
  method: 'POST',
  url: \`\${qdrantUrl}/collections/\${collection}/points/search\`,
  body: searchBody,
  json: true,
  timeout: 60000,
});

const hits = (searchResponse.result || []).map((hit, i) => ({
  rank: i + 1,
  score: hit.score,
  document_id: hit.payload?.document_id,
  document_title: hit.payload?.document_title,
  chunk_index: hit.payload?.chunk_index,
  text: hit.payload?.text,
  source_file: hit.payload?.source_file,
}));

return [{
  json: {
    ...item,
    retrieved_chunks: hits,
    retrieval_count_total: hits.length,
    qdrant_search_url: qdrantUrl,
  },
}];`;

const evaluateRetrievalCode = `${answerFormatHelpersCode}

const item = $input.first().json;
const hits = item.retrieved_chunks || [];
const question = String(item.question || '').trim();
const ragThreshold = Number(item.rag_score_threshold ?? 0.15);
const kbOnly = item.kb_only !== false;
const filterByUser = item.filter_results_by_user_id === true;
let relevantHits = hits.filter((h) => Number(h.score || 0) >= ragThreshold);

// kb_only: embedding scores are often 0.12–0.22 with free models — trust Qdrant top-k when plausible
if (kbOnly && relevantHits.length === 0 && hits.length > 0) {
  const bestScore = Number(hits[0]?.score || 0);
  const softFloor = filterByUser ? Math.min(ragThreshold, 0.06) : Math.min(ragThreshold, 0.12);
  // Per-user Drive folders: prefer the user's own chunks over a false "no match"
  if (filterByUser && bestScore > 0) {
    relevantHits = hits.slice(0, Math.min(5, hits.length));
  } else if (bestScore >= softFloor) {
    relevantHits = hits.slice(0, Math.min(5, hits.length));
  }
}

const docContext = buildCleanContext(relevantHits, question);

const historyContext = String(item.history_context || '').trim();
const contextParts = [];
if (!kbOnly && historyContext) contextParts.push('--- Prior related Q&A ---\\n' + historyContext);
if (docContext) contextParts.push('--- Ingested documents ---\\n' + docContext);
const ragContext = contextParts.join('\\n\\n');

const documentIds = [...new Set(relevantHits.map((h) => h.document_id).filter(Boolean))];
const similarityScores = relevantHits.map((h) => h.score);
const hasDocRag = relevantHits.length > 0;
const hasHistory = (item.history_relevant_count || 0) > 0;

return [{
  json: {
    ...item,
    kb_only: kbOnly,
    rag_relevant_chunks: relevantHits,
    rag_relevant: kbOnly ? hasDocRag : (hasDocRag || hasHistory),
    rag_score_threshold: ragThreshold,
    rag_context: ragContext,
    retrieval_count: relevantHits.length,
    document_ids: documentIds,
    similarity_scores: similarityScores,
    fallback_triggered: kbOnly ? !hasDocRag : (!hasDocRag && !hasHistory),
    operation_mode: hasDocRag ? 'document_rag' : (kbOnly ? 'out_of_scope' : (hasHistory ? 'history_assistant' : 'knowledge_assistant')),
  },
}];`;

const generateRagAnswerCode = `${openRouterChatHelpersCode}
${answerFormatHelpersCode}

const item = $input.first().json;
const apiKey = await getOpenRouterKey.call(this, item);
const model = item.openrouter_model || $env.OPENROUTER_MODEL || '';
const question = String(item.question || '').trim();
const context = String(item.rag_context || '').trim();
const relevantHits = item.rag_relevant_chunks || [];
const hasHistory = (item.history_relevant_count || 0) > 0;

const kbOnly = item.kb_only !== false;
const systemPrompt = kbOnly
  ? 'You are a helpful learning assistant. Answer using ONLY the provided context, including OCR text and image descriptions. Synthesize a clear, direct answer in 2-4 sentences — do NOT copy raw sentences verbatim. Ignore boilerplate like "see the Historical Notes section" or chapter references. For "what is X" questions, give a definition first. Fix obvious PDF/OCR typos. Do not mention document or PDF names. If the context lacks enough information, reply with exactly: I cannot answer this from the knowledge base.'
  : 'You are a document-based knowledge assistant. Synthesize a clear answer from the provided context in 2-4 sentences. Do not copy raw excerpts. Do not mention document or PDF names. If the answer is not in the context, say you do not have enough information.';

const contextForLlm = buildCleanContext(relevantHits, question) || context;
const llmContext = contextForLlm.length > 5000 ? contextForLlm.slice(0, 5000) + '\\n...' : contextForLlm;

let result;
let usedExcerptFallback = false;
try {
  result = await chatCompletion.call(
    this,
    apiKey,
    model,
    systemPrompt,
    'Context:\\n' + llmContext + '\\n\\nQuestion: ' + question,
    0.2,
    item
  );
  if (relevantHits.length && looksLikeRawExcerpt(result.answer)) {
    usedExcerptFallback = true;
    result = {
      answer: buildExcerptAnswer(relevantHits, 3, question),
      model_used: 'chunk-excerpt-fallback',
    };
  }
} catch (llmErr) {
  if (!relevantHits.length) throw llmErr;
  usedExcerptFallback = true;
  result = {
    answer: buildExcerptAnswer(relevantHits, 3, question),
    model_used: 'chunk-excerpt-fallback',
  };
}

let answer = usedExcerptFallback
  ? polishExcerptAnswer(String(result.answer || '').trim(), question)
  : lightPolishAnswer(String(result.answer || '').trim());
let sourceUsed = relevantHits.length > 0
  ? '${SOURCE_QDRANT}'
  : (hasHistory ? 'Query History' : '${SOURCE_QDRANT}');
let outOfScope = false;

if (kbOnly && /cannot answer this from the knowledge base/i.test(answer)) {
  const channel = String(item.channel || '').toLowerCase();
  const driveRag = channel === 'drive_rag' || item.metadata?.drive_rag === true;
  answer = driveRag
    ? "I couldn't find a clear answer in your connected Google Drive documents for that question. Try rephrasing or send /resync if you recently added files."
    : ${JSON.stringify(OUT_OF_SCOPE_MESSAGE)};
  sourceUsed = '${SOURCE_OUT_OF_SCOPE}';
  outOfScope = true;
}

return [{
  json: {
    ...item,
    answer,
    model_used: result.model_used,
    source_used: sourceUsed,
    out_of_scope: outOfScope,
    fallback_triggered: outOfScope,
    retrieval_count: relevantHits.length,
    retrieved_chunks: relevantHits,
    external_providers: [],
    answer_branch: outOfScope ? 'no_fallback' : 'rag',
    operation_mode: outOfScope ? 'out_of_scope' : 'document_rag',
  },
}];`;

const generateExternalAnswerCode = `${openRouterChatHelpersCode}

const item = $input.first().json;
const apiKey = await getOpenRouterKey.call(this, item);
const model = item.openrouter_model || $env.OPENROUTER_MODEL || '';
const question = String(item.question || '').trim();
const externalContext = String(item.external_context || '').trim();
const historyContext = String(item.history_context || '').trim();
const blocks = [];
if (historyContext) blocks.push('Prior related Q&A:\\n' + historyContext);
if (externalContext) blocks.push('External knowledge:\\n' + externalContext);

const result = await chatCompletion.call(
  this,
  apiKey,
  model,
  'You are a knowledge assistant. Use prior Q&A and external sources below. Prefer external facts for new topics; use prior Q&A for continuity when the user refers to earlier conversation.',
  blocks.join('\\n\\n') + '\\n\\nQuestion: ' + question,
  0.3
);

return [{
  json: {
    ...item,
    answer: result.answer,
    model_used: result.model_used,
    source_used: '${SOURCE_EXTERNAL}',
    fallback_triggered: true,
    retrieval_count: 0,
    document_ids: [],
    similarity_scores: [],
    retrieved_chunks: [],
    answer_branch: 'external',
  },
}];`;

const generateLlmFallbackAnswerCode = `${openRouterChatHelpersCode}

const item = $input.first().json;
const apiKey = await getOpenRouterKey.call(this, item);
const model = item.openrouter_model || $env.OPENROUTER_MODEL || '';
const question = String(item.question || '').trim();
const historyContext = String(item.history_context || '').trim();
const historyBlock = historyContext
  ? 'Prior related Q&A (use for continuity):\\n' + historyContext + '\\n\\n'
  : '';

const result = await chatCompletion.call(
  this,
  apiKey,
  model,
  'You are a helpful assistant. No relevant document chunks were found. Use prior Q&A if provided for continuity. Otherwise use general knowledge and note that no document context was found.',
  historyBlock + 'Question: ' + question,
  0.4
);

return [{
  json: {
    ...item,
    answer: result.answer,
    model_used: result.model_used,
    source_used: '${SOURCE_LLM}',
    fallback_triggered: true,
    retrieval_count: 0,
    document_ids: [],
    similarity_scores: [],
    retrieved_chunks: item.retrieved_chunks || [],
    external_providers: item.external_providers || [],
    answer_branch: 'llm',
  },
}];`;

const generateNoFallbackAnswerCode = `const item = $input.first().json;
const kbOnly = item.kb_only !== false;
const channel = String(item.channel || '').toLowerCase();
const driveRag = channel === 'drive_rag' || item.metadata?.drive_rag === true;
const driveOutOfScope =
  "I couldn't find an answer in your connected Google Drive documents for that question. "
  + 'Try rephrasing, ask about a specific topic from your files, or send /resync if you recently added documents.';

return [{
  json: {
    ...item,
    answer: kbOnly
      ? (driveRag ? driveOutOfScope : ${JSON.stringify(OUT_OF_SCOPE_MESSAGE)})
      : 'No relevant document chunks were found in the knowledge base (similarity below threshold), and external fallback is disabled.',
    model_used: null,
    source_used: kbOnly ? '${SOURCE_OUT_OF_SCOPE}' : '${SOURCE_LLM}',
    fallback_triggered: true,
    out_of_scope: kbOnly,
    retrieval_count: 0,
    document_ids: [],
    similarity_scores: [],
    retrieved_chunks: item.retrieved_chunks || [],
    external_providers: [],
    answer_branch: 'no_fallback',
    operation_mode: kbOnly ? 'out_of_scope' : 'knowledge_assistant',
  },
}];`;

const attachResponseMetadataCode = `${answerFormatHelpersCode}

const SOURCE_LABELS = {
  'Qdrant Knowledge Base': 'Source: Qdrant Knowledge Base (ingested documents)',
  'Query History': 'Source: Query History (prior related questions)',
  'External Search': 'Source: External Search / APIs',
  'LLM General Knowledge': 'Source: LLM General Knowledge (no document context found)',
  'Out of Scope': 'Out of scope',
};

const item = $input.first().json;
let answer = String(item.answer || '').trim();
const sourceUsed = item.source_used || 'LLM General Knowledge';
const label = SOURCE_LABELS[sourceUsed] || ('Source: ' + sourceUsed);
const channel = String(item.channel || '').toLowerCase();
const isTelegram = channel === 'telegram' || channel === 'drive_rag' || item.notify_telegram === true;
const skipSourcePrefix = item.out_of_scope === true
  || item.answer_branch === 'no_fallback'
  || sourceUsed === 'Out of Scope'
  || isTelegram
  || item.model_used === 'chunk-excerpt-fallback';

answer = item.model_used === 'chunk-excerpt-fallback'
  ? polishExcerptAnswer(answer, item.question)
  : lightPolishAnswer(answer);
if (answer && !answer.startsWith('Source:') && !skipSourcePrefix) {
  answer = label + '\\n\\n' + answer;
}

const retrieval = {
  rag_score_threshold: Number(item.rag_score_threshold ?? 0.15),
  total_hits: item.retrieval_count_total ?? (item.retrieved_chunks || []).length,
  relevant_hits: item.retrieval_count ?? 0,
  external_providers: item.external_providers || [],
  history_hits: item.history_relevant_count ?? (item.history_hits || []).length,
  history_score_threshold: Number(item.history_score_threshold ?? 0.4),
};

return [{
  json: {
    ...item,
    answer,
    source_used: sourceUsed,
    fallback_triggered: Boolean(item.fallback_triggered),
    retrieval_count: item.retrieval_count ?? 0,
    similarity_scores: item.similarity_scores || [],
    document_ids: item.document_ids || [],
    operation_mode: item.operation_mode || (sourceUsed === 'Qdrant Knowledge Base' ? 'document_rag' : 'knowledge_assistant'),
    retrieval,
    answered_at: new Date().toISOString(),
  },
}];`;

const QUERY_CREDITS_MESSAGE =
  'Sorry, VGI SKILL UNIVERSE cannot answer questions right now — the AI service needs more credits. Add credits at https://openrouter.ai/settings/credits then try again.';

const queryEmbeddingCode = `${embeddingHelpersCode}

function queryErrorReply(item, message) {
  const isTelegram = String(item.channel || '').toLowerCase() === 'telegram';
  return {
    json: {
      ...item,
      query_error_reply: true,
      success: false,
      answer: message,
      telegram_text: isTelegram ? message : '',
      notify_telegram: isTelegram,
      notify_email: false,
      source_used: 'Error',
      operation_mode: 'error',
      out_of_scope: false,
    },
  };
}

function isCreditsError(err) {
  const status = err?.statusCode || err?.response?.statusCode;
  const msg = String(err?.message || err?.description || err || '');
  return status === 402 || /402|insufficient credits|never purchased credits/i.test(msg);
}

const item = $input.first().json;
const question = String(item.question || '').trim();
if (!question) throw new Error('Query requires question');

try {
  const response = await createEmbeddings.call(this, item, question);
  const vector = response.data?.[0]?.embedding;
  if (!vector?.length) throw new Error('Failed to generate query embedding');
  return [{
    json: {
      ...item,
      query_embedding: vector,
      embedding_model: response.model || item.embedding_model || 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    },
  }];
} catch (err) {
  if (isCreditsError(err)) {
    return [queryErrorReply(item, ${JSON.stringify(QUERY_CREDITS_MESSAGE)})];
  }
  const status = err?.statusCode || err?.response?.statusCode;
  if (status === 401) {
    return [queryErrorReply(item, 'Sorry, the AI API key is invalid or expired. Please contact your admin.')];
  }
  if (String(item.channel || '').toLowerCase() === 'telegram') {
    return [queryErrorReply(item, 'Sorry, something went wrong while processing your question. Please try again in a moment.')];
  }
  throw err;
}`;

module.exports = {
  queryEmbeddingCode,
  searchQdrantCode,
  evaluateRetrievalCode,
  generateRagAnswerCode,
  generateExternalAnswerCode,
  generateLlmFallbackAnswerCode,
  generateNoFallbackAnswerCode,
  tryExternalProvidersCode,
  attachResponseMetadataCode,
};
