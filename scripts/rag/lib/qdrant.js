/**
 * Qdrant connection helpers for n8n Code nodes.
 */
module.exports.qdrantHelpersCode = `async function probeQdrant(url) {
  try {
    const res = await this.helpers.httpRequest({
      method: 'GET',
      url: \`\${url}/collections\`,
      json: true,
      timeout: 5000,
    });
    return res?.status === 'ok' || Array.isArray(res?.result?.collections);
  } catch (err) {
    return false;
  }
}

async function resolveQdrantUrl(item) {
  const configured = String(item.qdrant_url || '').replace(/\\/$/, '').trim();
  const envUrl = String($env.QDRANT_URL || '').replace(/\\/$/, '').trim();
  const candidates = [];
  if (envUrl) candidates.push(envUrl);
  if (configured) candidates.push(configured);
  candidates.push(
    'http://qdrant:6333',
    'http://host.docker.internal:6333',
    'http://127.0.0.1:6333',
    'http://localhost:6333',
  );

  const seen = new Set();
  for (const url of candidates) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (await probeQdrant.call(this, url)) return url;
  }

  throw new Error(
    'Cannot reach Qdrant. Run: docker compose up -d qdrant (or docker compose up -d). Tried: ' + [...seen].join(', ')
  );
}`;
