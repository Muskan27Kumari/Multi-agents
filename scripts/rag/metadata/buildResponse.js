const { answerFormatHelpersCode } = require('../lib/answerFormat');

/**
 * Final query response shape returned to webhook clients.
 */
module.exports.returnQueryResultCode = `const item = $input.first().json;
return [{
  json: {
    success: item.success !== false,
    action: 'query',
    run_id: item.run_id,
    question: item.question,
    answer: item.answer,
    model_used: item.model_used,
    operation_mode: item.operation_mode || (item.out_of_scope ? 'out_of_scope' : (item.source_used === 'Qdrant Knowledge Base' ? 'document_rag' : 'knowledge_assistant')),
    out_of_scope: item.out_of_scope === true,
    kb_only: item.kb_only !== false,
    source_used: item.source_used || 'LLM General Knowledge',
    fallback_triggered: Boolean(item.fallback_triggered),
    retrieval_count: item.retrieval_count ?? 0,
    similarity_scores: item.similarity_scores || [],
    document_ids: item.document_ids || [],
    external_providers: item.external_providers || [],
    retrieved_chunks: item.retrieved_chunks || [],
    retrieval: item.retrieval || {
      rag_score_threshold: item.rag_score_threshold ?? 0.15,
      total_hits: item.retrieval_count_total ?? 0,
      relevant_hits: item.retrieval_count ?? 0,
      external_providers: item.external_providers || [],
      history_hits: item.history_relevant_count ?? 0,
      history_score_threshold: item.history_score_threshold ?? 0.4,
    },
    history: {
      enabled: item.enable_query_history !== false,
      saved: item.history_saved === true,
      save_error: item.history_save_error || null,
      collection: item.history_collection || item.history_collection_name || 'query_history',
      hits_used: item.history_hits || [],
      relevant_count: item.history_relevant_count ?? 0,
    },
    collection_name: item.collection_name || 'knowledge_base',
    user_id: item.user_id || null,
    channel: item.channel || 'webhook',
    notifications: {
      email: Boolean(item.notify_email),
      email_sent: item.email_sent === true,
      email_error: item.email_error || null,
      telegram: Boolean(item.notify_telegram && (item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN) && (item.telegram_chat_id || $env.TELEGRAM_CHAT_ID)),
      telegram_sent: item.telegram_sent === true,
      telegram_error: item.telegram_error || null,
    },
    completed_at: new Date().toISOString(),
  },
}];`;

module.exports.formatQueryResponseCode = `${answerFormatHelpersCode}

const item = $input.first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const question = String(item.question || '').trim();
const answer = item.model_used === 'chunk-excerpt-fallback'
  ? polishExcerptAnswer(String(item.answer || '').trim(), question)
  : lightPolishAnswer(String(item.answer || '').trim());

const emailHtml = \`
<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#111827;">
  <h3 style="color:#1d4ed8;margin-bottom:8px;">Question</h3>
  <p style="white-space:pre-wrap;margin-top:0;">\${esc(question)}</p>
  <h3 style="color:#1d4ed8;margin-bottom:8px;">Answer</h3>
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;white-space:pre-wrap;">\${esc(answer)}</div>
</div>\`;

const isTelegramChat = String(item.channel || '').toLowerCase() === 'telegram' || item.notify_telegram === true;
const telegramText = isTelegramChat
  ? answer
  : 'Question:\\n' + question + '\\n\\nAnswer:\\n' + answer;

return [{
  json: {
    ...item,
    success: true,
    email_subject: question.slice(0, 120) || 'RAG question',
    email_html: emailHtml,
    telegram_text: telegramText,
  },
}];`;
