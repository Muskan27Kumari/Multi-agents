/**
 * Shared embedding helpers injected into n8n Code nodes.
 */
module.exports.embeddingHelpersCode = `const FREE_EMBEDDING_MODEL = String($env.EMBEDDING_MODEL || 'nvidia/llama-nemotron-embed-vl-1b-v2:free').trim();

function cleanKey(key) {
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

function resolveEmbeddingModel(model, useOpenRouter) {
  const m = String(model || FREE_EMBEDDING_MODEL).trim();
  if (!useOpenRouter) return m.replace(/^openai\\//, '');
  if (m.includes('/')) return m;
  return \`openai/\${m}\`;
}

function embeddingModelsToTry(requestedModel, useOpenRouter) {
  const primary = resolveEmbeddingModel(requestedModel, useOpenRouter);
  const models = [primary];
  if (primary !== FREE_EMBEDDING_MODEL && !/:free$/i.test(primary)) {
    models.push(FREE_EMBEDDING_MODEL);
  }
  return [...new Set(models)];
}

async function resolveEmbeddingAuth(payload) {
  const openaiKey = cleanKey(payload.openai_api_key || $env.OPENAI_API_KEY || '');
  const openrouterKey = cleanKey(payload.openrouter_api_key || $env.OPENROUTER_API_KEY || '');
  let credKey = '';
  try {
    const cred = await this.getCredentials('httpHeaderAuth');
    credKey = cleanKey(cred.value || cred.headerValue);
  } catch (e) {}

  const provider = String(payload.embedding_provider || $env.AI_PROVIDER || 'auto').toLowerCase();

  if (provider === 'openai') {
    const key = openaiKey && !isOpenRouterKey(openaiKey) ? openaiKey : '';
    if (!key || isPlaceholderKey(key)) {
      throw new Error('Missing valid openai_api_key for embeddings (sk-...).');
    }
    return { key, useOpenRouter: false };
  }

  if (provider === 'openrouter') {
    const key = openrouterKey || (isOpenRouterKey(credKey) ? credKey : '');
    if (!key || isPlaceholderKey(key)) {
      throw new Error('Missing valid openrouter_api_key for embeddings (sk-or-v1-...).');
    }
    return { key, useOpenRouter: true };
  }

  if (openaiKey && !isOpenRouterKey(openaiKey) && !isPlaceholderKey(openaiKey)) {
    return { key: openaiKey, useOpenRouter: false };
  }

  if (openrouterKey && !isPlaceholderKey(openrouterKey)) {
    return { key: openrouterKey, useOpenRouter: true };
  }
  if (openaiKey && isOpenRouterKey(openaiKey) && !isPlaceholderKey(openaiKey)) {
    return { key: openaiKey, useOpenRouter: true };
  }
  if (isOpenRouterKey(credKey) && !isPlaceholderKey(credKey)) {
    return { key: credKey, useOpenRouter: true };
  }
  if (credKey && !isOpenRouterKey(credKey) && !isPlaceholderKey(credKey)) {
    return { key: credKey, useOpenRouter: false };
  }

  throw new Error('Missing embedding API key. Pass openrouter_api_key (recommended) or openai_api_key in the request body, or attach HTTP Header Auth on embedding nodes.');
}

async function requestEmbeddings(auth, payload, model, input) {
  const { key, useOpenRouter } = auth;
  const url = useOpenRouter
    ? 'https://openrouter.ai/api/v1/embeddings'
    : 'https://api.openai.com/v1/embeddings';

  const headers = {
    Authorization: \`Bearer \${key}\`,
    'Content-Type': 'application/json',
  };
  if (useOpenRouter) {
    headers['HTTP-Referer'] = payload.brand_website || 'https://n8n-flow.local';
    headers['X-Title'] = 'RAG Knowledge Agent';
  }

  return this.helpers.httpRequest({
    method: 'POST',
    url,
    headers,
    body: { model, input },
    json: true,
    timeout: 120000,
  });
}

function isCreditsError(err) {
  const status = err?.statusCode || err?.response?.statusCode;
  const msg = String(err?.message || err?.description || err || '');
  return status === 402 || /402|insufficient credits|never purchased credits/i.test(msg);
}

async function createEmbeddings(payload, input) {
  const auth = await resolveEmbeddingAuth.call(this, payload);
  const models = embeddingModelsToTry(payload.embedding_model, auth.useOpenRouter);
  let lastErr = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return await requestEmbeddings.call(this, auth, payload, model, input);
    } catch (err) {
      lastErr = err;
      const status = err?.statusCode || err?.response?.statusCode;
      if (status === 401) {
        throw new Error(
          auth.useOpenRouter
            ? 'Embeddings API 401: invalid or expired openrouter_api_key. Create a key at openrouter.ai/keys and pass it as openrouter_api_key.'
            : 'Embeddings API 401: invalid openai_api_key. OpenRouter keys (sk-or-v1-...) must be sent as openrouter_api_key, not openai_api_key.'
        );
      }
      const canFallback = isCreditsError(err) && i < models.length - 1;
      if (canFallback) continue;
      if (isCreditsError(err)) {
        throw new Error('Embeddings API 402: insufficient OpenRouter credits. Using free model failed too — try again later or add credits at https://openrouter.ai/settings/credits');
      }
      throw err;
    }
  }

  throw lastErr || new Error('Embeddings request failed');
}`;
