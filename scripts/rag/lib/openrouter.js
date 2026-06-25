/**
 * Chat completion helpers for n8n Code nodes (OpenAI direct or OpenRouter).
 */
module.exports.openRouterChatHelpersCode = `function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\\s+/i, '');
}

function isPlaceholderKey(key) {
  const k = cleanKey(key).toLowerCase();
  return !k
    || k.includes('your-key')
    || k.includes('your-openai')
    || k === 'sk-or-v1-your-key'
    || k === 'sk-your-key-here';
}

function isOpenRouterKey(key) {
  return /^sk-or-/i.test(cleanKey(key));
}

function aiProviderPrefersOpenAI() {
  return String($env.AI_PROVIDER || 'openai').toLowerCase() === 'openai';
}

function chatCompletionsUrl(apiKey) {
  return isOpenRouterKey(apiKey)
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}

function chatHeaders(apiKey, title) {
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
  };
  if (isOpenRouterKey(apiKey) && title) headers['X-Title'] = title;
  return headers;
}

function normalizeChatModel(model, apiKey) {
  const m = String(model || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL || 'gpt-4o-mini').trim();
  if (isOpenRouterKey(apiKey)) {
    return m.includes('/') ? m : 'openai/' + m.replace(/^openai\\//, '');
  }
  return m.replace(/^openai\\//, '');
}

async function getChatApiKey(payload) {
  const preferOpenAI = aiProviderPrefersOpenAI();
  let openaiKey = cleanKey(payload?.openai_api_key || $env.OPENAI_API_KEY || '');
  let orKey = cleanKey(payload?.openrouter_api_key || $env.OPENROUTER_API_KEY || '');

  if (preferOpenAI && openaiKey && !isPlaceholderKey(openaiKey)) {
    return { key: openaiKey, useOpenRouter: false };
  }
  if (orKey && !isPlaceholderKey(orKey) && isOpenRouterKey(orKey)) {
    return { key: orKey, useOpenRouter: true };
  }
  if (openaiKey && !isPlaceholderKey(openaiKey) && !isOpenRouterKey(openaiKey)) {
    return { key: openaiKey, useOpenRouter: false };
  }

  let credKey = '';
  try {
    const cred = await this.getCredentials('httpHeaderAuth');
    credKey = cleanKey(cred.value || cred.headerValue);
  } catch (e) {}

  if (credKey && !isPlaceholderKey(credKey)) {
    return { key: credKey, useOpenRouter: isOpenRouterKey(credKey) };
  }

  throw new Error('Missing AI API key. Set OPENAI_API_KEY in .env (recommended) or openrouter_api_key in the request body.');
}

async function getOpenRouterKey(payload) {
  const auth = await getChatApiKey.call(this, payload || {});
  return auth.key;
}

function chatModels(primary, payload) {
  const authKey = cleanKey(payload?.openai_api_key || payload?.openrouter_api_key || $env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '');
  const models = [];
  const main = normalizeChatModel(primary || payload?.openrouter_model || $env.OPENAI_MODEL || $env.OPENROUTER_MODEL, authKey);
  if (main) models.push(main);
  const fallback = normalizeChatModel($env.OPENAI_MODEL_SPECIALIST || $env.OPENROUTER_FALLBACK_MODEL || 'gpt-4o-mini', authKey);
  if (fallback && !models.includes(fallback)) models.push(fallback);
  if (!models.length) models.push(normalizeChatModel('gpt-4o-mini', authKey));
  return [...new Set(models)];
}

async function chatCompletionOnce(apiKey, model, systemPrompt, userPrompt, temperature) {
  const normalizedModel = normalizeChatModel(model, apiKey);
  let response;
  try {
    response = await this.helpers.httpRequest({
      method: 'POST',
      url: chatCompletionsUrl(apiKey),
      headers: chatHeaders(apiKey, 'RAG Knowledge Agent'),
      body: {
        model: normalizedModel,
        temperature: temperature ?? 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      json: true,
      timeout: 90000,
      ignoreHttpStatusErrors: true,
    });
  } catch (err) {
    const wrapped = new Error(err.message || 'AI chat completion failed.');
    wrapped.statusCode = Number(err.statusCode || err.httpCode || 500);
    throw wrapped;
  }

  if (response?.error) {
    const err = new Error(response.error.message || 'AI chat completion failed.');
    err.statusCode = Number(response.error.code || 500);
    throw err;
  }

  const answer = response.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('AI returned an empty answer.');
  return {
    answer,
    model_used: response.model || normalizedModel,
  };
}

async function chatCompletion(apiKey, model, systemPrompt, userPrompt, temperature, payload) {
  const models = chatModels(model, payload || {});
  let lastErr;
  for (const candidate of models) {
    try {
      return await chatCompletionOnce.call(this, apiKey, candidate, systemPrompt, userPrompt, temperature);
    } catch (err) {
      lastErr = err;
      const code = Number(err.statusCode || err.httpCode || 0);
      if (code === 402 || code === 429 || code >= 500) continue;
      throw err;
    }
  }
  throw lastErr || new Error('AI chat completion failed.');
}`;
