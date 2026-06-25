/**
 * Shared AI helper code injected into Resume Analysis Agent n8n Code nodes.
 */
module.exports.resumeAiHelpersCode = `function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\\s+/i, '');
}
function isOpenRouterKey(key) {
  return /^sk-or-/i.test(cleanKey(key));
}
function chatCompletionsUrl(apiKey) {
  return isOpenRouterKey(apiKey)
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}
function normalizeModel(model, apiKey) {
  const m = String(model || $env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  if (isOpenRouterKey(apiKey)) {
    return m.includes('/') ? m : 'openai/' + m.replace(/^openai\\//, '');
  }
  return m.replace(/^openai\\//, '');
}
async function getAiApiKey(payload) {
  let key = cleanKey(payload?.openai_api_key || payload?.openrouter_api_key);
  if (!key) key = cleanKey($env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '');
  if (!key) {
    try {
      const cred = await this.getCredentials('httpHeaderAuth');
      key = cleanKey(cred.value || cred.headerValue);
    } catch (e) {}
  }
  if (!key) throw new Error('Missing OPENAI_API_KEY. Set in .env or pass openai_api_key in the webhook body.');
  return key;
}
`;
