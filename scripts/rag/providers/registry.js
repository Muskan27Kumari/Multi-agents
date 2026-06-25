/**
 * Fallback provider registry — order defines default try sequence.
 * Optional request field fallback_providers: string[] overrides order.
 */
const FALLBACK_PROVIDERS = [
  { id: 'custom_api', label: 'Custom API' },
  { id: 'database', label: 'Database' },
  { id: 'notion', label: 'Notion' },
  { id: 'confluence', label: 'Confluence' },
  { id: 'web_search', label: 'Web Search' },
];

const DEFAULT_PROVIDER_ORDER = FALLBACK_PROVIDERS.map((p) => p.id);

const providerFetchFunctionsCode = `async function webSearch(item, question) {
  const provider = String(item.web_search_provider || 'duckduckgo').toLowerCase();
  const apiKey = String(item.web_search_api_key || '').trim();

  if (provider === 'tavily' && apiKey) {
    const res = await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://api.tavily.com/search',
      body: { api_key: apiKey, query: question, max_results: 5, include_answer: true },
      json: true,
      timeout: 30000,
    });
    const snippets = (res.results || [])
      .map((r) => (r.title ? r.title + ': ' : '') + (r.content || ''))
      .filter(Boolean)
      .join('\\n');
    return { text: [res.answer, snippets].filter(Boolean).join('\\n').trim(), provider: 'tavily' };
  }

  if (provider === 'brave' && apiKey) {
    const res = await this.helpers.httpRequest({
      method: 'GET',
      url: 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(question) + '&count=5',
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      json: true,
      timeout: 30000,
    });
    const snippets = (res.web?.results || [])
      .map((r) => (r.title || '') + ': ' + (r.description || ''))
      .join('\\n');
    return { text: snippets.trim(), provider: 'brave' };
  }

  if (provider === 'serpapi' && apiKey) {
    const res = await this.helpers.httpRequest({
      method: 'GET',
      url: 'https://serpapi.com/search.json?q=' + encodeURIComponent(question) + '&api_key=' + encodeURIComponent(apiKey) + '&num=5',
      json: true,
      timeout: 30000,
    });
    const snippets = (res.organic_results || [])
      .map((r) => (r.title || '') + ': ' + (r.snippet || ''))
      .join('\\n');
    return { text: snippets.trim(), provider: 'serpapi' };
  }

  const res = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://api.duckduckgo.com/?q=' + encodeURIComponent(question) + '&format=json&no_redirect=1',
    json: true,
    timeout: 20000,
  });
  const parts = [];
  if (res.AbstractText) parts.push(res.AbstractText);
  for (const t of (res.RelatedTopics || []).slice(0, 8)) {
    if (t.Text) parts.push(t.Text);
    else if (Array.isArray(t.Topics)) {
      for (const sub of t.Topics.slice(0, 3)) {
        if (sub.Text) parts.push(sub.Text);
      }
    }
  }
  return { text: parts.join('\\n').trim(), provider: 'duckduckgo' };
}

async function fetchCustomApi(item, question) {
  const url = String(item.fallback_api_url || '').trim();
  if (!url) return null;
  const method = String(item.fallback_api_method || 'POST').toUpperCase();
  const headers = item.fallback_api_headers && typeof item.fallback_api_headers === 'object'
    ? item.fallback_api_headers
    : { 'Content-Type': 'application/json' };
  const body = item.fallback_api_body || { question, query: question };
  const res = await this.helpers.httpRequest({
    method,
    url,
    headers,
    body: method === 'GET' ? undefined : body,
    json: true,
    timeout: 30000,
  });
  const text = typeof res === 'string'
    ? res
    : String(res.context || res.answer || res.text || res.content || JSON.stringify(res)).slice(0, 12000);
  return { text, provider: 'custom_api' };
}

async function fetchNotion(item, question) {
  const token = String(item.notion_api_key || '').trim();
  const databaseId = String(item.notion_database_id || '').trim();
  if (!token || !databaseId) return null;
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url: 'https://api.notion.com/v1/databases/' + databaseId + '/query',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: { page_size: 5, filter: { property: 'title', title: { contains: question.slice(0, 80) } } },
    json: true,
    timeout: 30000,
  });
  const rows = (res.results || []).map((page) => JSON.stringify(page.properties || {})).join('\\n');
  return rows ? { text: rows.slice(0, 12000), provider: 'notion' } : null;
}

async function fetchConfluence(item, question) {
  const base = String(item.confluence_base_url || '').trim().replace(/\\/$/, '');
  const token = String(item.confluence_api_token || '').trim();
  const email = String(item.confluence_email || '').trim();
  if (!base || !token) return null;
  const auth = email ? Buffer.from(email + ':' + token).toString('base64') : token;
  const res = await this.helpers.httpRequest({
    method: 'GET',
    url: base + '/wiki/rest/api/content/search?cql=text~' + encodeURIComponent('"' + question.slice(0, 120) + '"') + '&limit=5',
    headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' },
    json: true,
    timeout: 30000,
  });
  const snippets = (res.results || [])
    .map((r) => (r.title || '') + ': ' + (r.excerpt || r.body?.storage?.value || '').replace(/<[^>]+>/g, ' ').slice(0, 500))
    .join('\\n');
  return snippets.trim() ? { text: snippets.trim(), provider: 'confluence' } : null;
}

async function fetchDatabaseRecords(item, question) {
  const url = String(item.database_query_url || '').trim();
  if (!url) return null;
  const res = await this.helpers.httpRequest({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json', ...(item.database_query_headers || {}) },
    body: { question, query: question, limit: 5 },
    json: true,
    timeout: 30000,
  });
  const text = String(res.records || res.rows || res.data || res.result || JSON.stringify(res)).slice(0, 12000);
  return text ? { text, provider: 'database' } : null;
}

const PROVIDER_FETCHERS = {
  custom_api: fetchCustomApi,
  database: fetchDatabaseRecords,
  notion: fetchNotion,
  confluence: fetchConfluence,
  web_search: webSearch,
};`;

const tryExternalProvidersCode = `${providerFetchFunctionsCode}

function resolveProviderOrder(item) {
  const custom = item.fallback_providers;
  if (Array.isArray(custom) && custom.length) {
    return custom.map((id) => String(id).trim().toLowerCase()).filter(Boolean);
  }
  return ${JSON.stringify(DEFAULT_PROVIDER_ORDER)};
}

const item = $input.first().json;
const question = String(item.question || '').trim();
const order = resolveProviderOrder(item);
const sections = [];
const providers = [];

for (const providerId of order) {
  if (providerId === 'web_search' && item.enable_web_search === false) continue;
  const fetcher = PROVIDER_FETCHERS[providerId];
  if (!fetcher) continue;
  try {
    const result = await fetcher.call(this, item, question);
    if (result?.text) {
      sections.push('[' + result.provider + ']\\n' + result.text);
      providers.push(result.provider);
    }
  } catch (e) {
    // try next provider
  }
}

return [{
  json: {
    ...item,
    external_context: sections.join('\\n\\n---\\n\\n'),
    external_providers: providers,
    has_external_context: sections.length > 0,
  },
}];`;

module.exports = {
  FALLBACK_PROVIDERS,
  DEFAULT_PROVIDER_ORDER,
  tryExternalProvidersCode,
};
