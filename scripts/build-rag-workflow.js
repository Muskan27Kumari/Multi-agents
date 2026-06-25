#!/usr/bin/env node
/**
 * Generates workflows/rag-knowledge-agent.json
 */
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env');

loadEnv(path.join(__dirname, '..'));

const { embeddingHelpersCode } = require('./rag/lib/embeddings');
const { qdrantHelpersCode } = require('./rag/lib/qdrant');
const { ocrPdfImagesCode } = require('./rag/lib/openrouterVision');
const {
  adaptChannelPayloadCode,
  adaptTelegramPayloadCode,
  returnTelegramReplyCode,
} = require('./rag/channels/adapters');
const {
  queryEmbeddingCode,
  searchQdrantCode,
  evaluateRetrievalCode,
  generateRagAnswerCode,
  generateExternalAnswerCode,
  generateLlmFallbackAnswerCode,
  generateNoFallbackAnswerCode,
  tryExternalProvidersCode,
  attachResponseMetadataCode,
} = require('./rag/query');
const {
  returnQueryResultCode,
  formatQueryResponseCode,
} = require('./rag/metadata/buildResponse');
const {
  searchQueryHistoryCode,
  saveQueryHistoryCode,
} = require('./rag/history');

const SAMPLE_INGEST_PAYLOAD = {
  action: 'ingest',
  document_title: 'Product Guide',
  document_file_path: '/files/knowledge/sample-product-guide.txt',
  document_id: 'sample-product-guide',
  collection_name: 'knowledge_base',
  chunk_size: 800,
  chunk_overlap: 150,
  notify_email: false,
  notify_telegram: false,
};

const SAMPLE_QUERY_PAYLOAD = {
  action: 'query',
  question: 'What integrations does the platform support?',
  collection_name: 'knowledge_base',
  top_k: 5,
  kb_only: true,
  enable_fallback: false,
  enable_query_history: false,
  notify_email: false,
  notify_telegram: false,
};

function sampleJsonOutput(obj) {
  return JSON.stringify(obj, null, 2);
}

const chunkDocumentCode = `const item = $input.first().json;
const text = String(item.extracted_document_text || item.document_text || '').trim();
if (!text) throw new Error('No document text available for chunking');

const chunkSize = Number(item.chunk_size || 1000);
const overlap = Number(item.chunk_overlap || 200);
const documentId = String(item.document_id || \`doc_\${Date.now()}\`).trim();
const documentTitle = String(item.document_title || item.document_filename || 'Untitled').trim();

function normalizePdfText(content) {
  let t = String(content || '');
  t = t.replace(/([A-Za-z])- ([a-z])/g, '$1$2');
  t = t.replace(/\\beval\\s+uation\\b/gi, 'evaluation');
  t = t.replace(
    /encompassing the retrieval of information retrieval (?:\\(IR\\)|IR) all manner of/gi,
    'encompassing the retrieval of all types of'
  );
  t = t.replace(/\\binformation retrieval\\s+IR\\b/gi, 'information retrieval (IR)');
  t = t.replace(/\\ball types of media of media\\b/gi, 'all types of media');
  t = t.replace(/\\b([a-z]{1,2})\\s+queries\\b/gi, 'encoding queries');
  return t;
}

function chunkText(content, size, lap) {
  const chunks = [];
  const clean = normalizePdfText(content).replace(/\\s+/g, ' ').trim();
  if (!clean) return chunks;
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push({
      chunk_index: chunks.length,
      text: clean.slice(start, end),
      char_start: start,
      char_end: end,
    });
    if (end >= clean.length) break;
    start = Math.max(0, end - lap);
  }
  return chunks;
}

const chunks = chunkText(text, chunkSize, overlap);
if (!chunks.length) throw new Error('Document produced zero chunks');

return [{
  json: {
    ...item,
    document_id: documentId,
    document_title: documentTitle,
    chunks,
    chunks_count: chunks.length,
    total_chars: text.length,
  }
}];`;

const generateEmbeddingsCode = `${embeddingHelpersCode}

function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pointId(documentId, chunkIndex) {
  const key = \`\${documentId}:\${chunkIndex}\`;
  const parts = [
    fnv1a(key),
    fnv1a(key, 0x9e3779b9),
    fnv1a(key, 0x85ebca6b),
    fnv1a(key, 0xc2b2ae35),
  ].map((n) => n.toString(16).padStart(8, '0'));
  const hex = parts.join('');
  return \`\${hex.slice(0, 8)}-\${hex.slice(8, 12)}-\${hex.slice(12, 16)}-\${hex.slice(16, 20)}-\${hex.slice(20, 32)}\`;
}

const item = $input.first().json;
const chunks = item.chunks || [];
const texts = chunks.map((c) => c.text);

const response = await createEmbeddings.call(this, item, texts);

const vectors = (response.data || []).map((row) => row.embedding);
if (vectors.length !== chunks.length) {
  throw new Error(\`Embedding count mismatch: expected \${chunks.length}, got \${vectors.length}\`);
}

const vectorSize = vectors[0]?.length || Number(item.embedding_dimensions || 2048);
const points = chunks.map((chunk, i) => ({
  id: pointId(item.document_id, chunk.chunk_index),
  vector: vectors[i],
  payload: {
    document_id: item.document_id,
    document_title: item.document_title,
    chunk_index: chunk.chunk_index,
    text: chunk.text,
    char_start: chunk.char_start,
    char_end: chunk.char_end,
    source_file: item.document_file_path || null,
    ingested_at: new Date().toISOString(),
    user_id: item.user_id || null,
    metadata: { ...(item.metadata || {}), user_id: item.user_id || null },
  },
}));

return [{
  json: {
    ...item,
    embedding_model: response.model || item.embedding_model || 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    vector_size: vectorSize,
    qdrant_points: points,
  }
}];`;

const storeInQdrantCode = `${qdrantHelpersCode}

async function getCollectionVectorSize(qdrantUrl, collection) {
  try {
    const res = await this.helpers.httpRequest({
      method: 'GET',
      url: \`\${qdrantUrl}/collections/\${collection}\`,
      json: true,
      timeout: 10000,
    });
    const vectors = res.result?.config?.params?.vectors;
    if (typeof vectors?.size === 'number') return vectors.size;
    if (vectors && typeof vectors === 'object') {
      const first = Object.values(vectors)[0];
      if (first && typeof first.size === 'number') return first.size;
    }
  } catch (err) {
    const status = err?.statusCode || err?.response?.statusCode;
    if (status === 404) return null;
  }
  return null;
}

async function ensureCollection(qdrantUrl, collection, vectorSize) {
  const existingSize = await getCollectionVectorSize.call(this, qdrantUrl, collection);
  if (existingSize && existingSize !== vectorSize) {
    await this.helpers.httpRequest({
      method: 'DELETE',
      url: \`\${qdrantUrl}/collections/\${collection}\`,
      json: true,
      timeout: 30000,
    });
  }

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

async function deleteDocumentPoints(qdrantUrl, collection, documentId) {
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: \`\${qdrantUrl}/collections/\${collection}/points/delete?wait=true\`,
      body: {
        filter: {
          must: [{ key: 'document_id', match: { value: documentId } }],
        },
      },
      json: true,
      timeout: 60000,
    });
  } catch (err) {
    const status = err?.statusCode || err?.response?.statusCode;
    const msg = String(err?.message || '');
    if (status === 404 || msg.includes('404') || msg.toLowerCase().includes('not found')) return;
    throw err;
  }
}

const item = $input.first().json;
const qdrantUrl = await resolveQdrantUrl.call(this, item);
const collection = String(item.collection_name || 'knowledge_base').trim();
const vectorSize = Number(item.vector_size || item.embedding_dimensions || 2048);
const points = item.qdrant_points || [];

if (!points.length) throw new Error('No Qdrant points to upsert');

await ensureCollection.call(this, qdrantUrl, collection, vectorSize);
await deleteDocumentPoints.call(this, qdrantUrl, collection, item.document_id);

await this.helpers.httpRequest({
  method: 'PUT',
  url: \`\${qdrantUrl}/collections/\${collection}/points?wait=true\`,
  body: { points },
  json: true,
  timeout: 120000,
});

return [{
  json: {
    ...item,
    qdrant: {
      url: qdrantUrl,
      collection,
      points_upserted: points.length,
      document_id: item.document_id,
    },
  }
}];`;

const validateInputCode = `const input = $input.first().json;
const action = String(input.action || '').trim().toLowerCase();

if (!['ingest', 'query'].includes(action)) {
  throw new Error('Invalid action "' + (input.action || '') + '". Use "ingest" or "query".');
}

const out = { ...input, action };

if (action === 'ingest') {
  const hasText = Boolean(String(out.document_text || '').trim());
  const hasPath = Boolean(String(out.document_file_path || '').trim());
  const hasB64 = Boolean(String(out.document_base64 || '').trim());
  if (!hasText && !hasPath && !hasB64) {
    throw new Error('ingest requires document_file_path (recommended), document_text, or document_base64');
  }
}

if (action === 'query') {
  if (!String(out.question || '').trim()) {
    throw new Error('query requires question');
  }
  if (!String(out.openrouter_api_key || out.openai_api_key || $env.OPENROUTER_API_KEY || '').trim()) {
    throw new Error('query requires openrouter_api_key (or openai_api_key) for embeddings and answers');
  }
}

if (out.user_id) {
  out.metadata = { ...(out.metadata || {}), user_id: out.user_id };
}

if (out.fallback_providers && typeof out.fallback_providers === 'string') {
  try {
    out.fallback_providers = JSON.parse(out.fallback_providers);
  } catch (e) {
    out.fallback_providers = out.fallback_providers.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

return [{
  json: {
    ...out,
    rag_score_threshold: Number(out.rag_score_threshold ?? 0.15),
    kb_only: out.kb_only !== false,
    enable_fallback: out.kb_only !== false ? out.enable_fallback === true : out.enable_fallback !== false,
    enable_query_history: out.kb_only !== false ? out.enable_query_history === true : out.enable_query_history !== false,
    run_id: out.run_id || \`rag_\${Date.now()}_\${Math.random().toString(16).slice(2, 8)}\`,
    processed_at: new Date().toISOString(),
  }
}];`;

const prepareDocumentCode = `const item = $input.first().json;
const runId = item.run_id;
const FILES_DIR = '/files';
const KNOWLEDGE_DIR = '/files/knowledge';
let ext = 'txt';
let filename = String(item.document_filename || 'document.txt').trim();
const filePathInput = String(item.document_file_path || '').trim();

function resolveDocumentPath(inputPath, id, fileExt) {
  if (!inputPath) {
    return FILES_DIR + '/' + id + '.' + fileExt;
  }

  let path = inputPath.trim();
  if (!path.startsWith('/files/')) {
    if (path.startsWith('files/')) path = '/' + path;
    else path = KNOWLEDGE_DIR + '/' + path.replace(/^\\.\\/?files\\/knowledge\\//, '');
  }

  const base = path.split('/').pop() || '';
  if (!base || base === 'knowledge' || !base.includes('.')) {
    throw new Error(
      'document_file_path must be a file path (e.g. /files/knowledge/doc.txt), got: ' + inputPath
    );
  }

  return path;
}

if (filePathInput) {
  const base = filePathInput.split('/').pop() || 'document.txt';
  filename = base;
  ext = (base.split('.').pop() || 'txt').toLowerCase();
} else {
  ext = (filename.split('.').pop() || 'txt').toLowerCase();
}

const allowed = new Set(['txt', 'pdf', 'md', 'markdown', 'docx']);
if (ext === 'doc') {
  throw new Error('Legacy .doc files are not supported. Convert to .docx, .pdf, or .txt.');
}
if (!allowed.has(ext)) ext = 'txt';

const documentFilePath = resolveDocumentPath(filePathInput, runId, ext);

const text = String(item.document_text || '').trim();
const b64 = String(item.document_base64 || '').trim();

function sniffPdfFromBase64(raw) {
  try {
    const head = Buffer.from(String(raw || '').trim().slice(0, 32), 'base64').slice(0, 5).toString('ascii');
    return head === '%PDF-';
  } catch (e) {
    return false;
  }
}

if (b64 && ext !== 'pdf' && sniffPdfFromBase64(b64)) {
  ext = 'pdf';
  if (!filename.toLowerCase().endsWith('.pdf')) {
    filename = filename.includes('.') ? filename.replace(/\\.[^.]+$/, '.pdf') : filename + '.pdf';
  }
}

let binary = null;
if (b64) {
  binary = {
    data: {
      data: b64,
      mimeType: ext === 'pdf'
        ? 'application/pdf'
        : ext === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/plain',
      fileName: filename,
    },
  };
} else if (text && !filePathInput) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  binary = {
    data: {
      data: btoa(bin),
      mimeType: 'text/plain',
      fileName: filename.endsWith('.txt') ? filename : \`\${filename}.txt\`,
    },
  };
}

return [{
  json: {
    ...item,
    document_filename: filename,
    document_file_ext: ext,
    is_pdf: ext === 'pdf',
    is_docx: ext === 'docx',
    document_file_path: documentFilePath,
    skip_write: Boolean(filePathInput && !b64 && !text),
  },
  ...(binary ? { binary } : {}),
}];`;

const useExistingDocumentCode = `const item = $input.first().json;
const filePath = String(item.document_file_path || '').trim();
if (!filePath) throw new Error('document_file_path is required for existing file mode');

const base = filePath.split('/').pop() || '';
if (!base || base === 'knowledge' || !base.includes('.')) {
  throw new Error(
    'document_file_path must point to a file (not a folder). Example: /files/knowledge/guide.txt'
  );
}
let normalizedPath = filePath;
if (!normalizedPath.startsWith('/files/')) {
  if (normalizedPath.startsWith('files/')) normalizedPath = '/' + normalizedPath;
  else throw new Error('document_file_path must start with /files/ or files/. Got: ' + filePath);
}

const ext = (base.split('.').pop() || 'txt').toLowerCase();

return [{
  json: {
    ...item,
    document_file_path: normalizedPath,
    document_file_ext: ext,
    is_pdf: ext === 'pdf',
    is_docx: ext === 'docx',
    document_filename: item.document_filename || base,
    used_existing_file: true,
  }
}];`;

const afterWriteWithBinaryCode = `const prep = $('Prepare Document File').first();
const binary = prep.binary || $input.first().binary;
if (!binary?.data) {
  throw new Error('Missing document binary after write for ' + (prep.json.document_file_path || 'unknown'));
}

return [{ json: prep.json, binary }];`;

const restoreMetaCode = `let meta = {};
try {
  const existing = $('Use Existing Document File').first();
  if (existing?.json?.document_file_path) meta = { ...existing.json };
} catch (e) {}

if (!meta.document_file_path) {
  try {
    meta = { ...$('After Write With Binary').first().json };
  } catch (e) {}
}

if (!meta.document_file_path) {
  try {
    meta = { ...$('Prepare Document File').first().json };
  } catch (e) {}
}

const binary = $input.first().binary || {};
if (!binary?.data) {
  throw new Error('No binary data available for ' + (meta.document_file_path || 'document'));
}

function extFromPath(filePath) {
  const base = String(filePath || '').split('/').pop() || '';
  return (base.split('.').pop() || '').toLowerCase();
}

let ext = String(meta.document_file_ext || extFromPath(meta.document_file_path) || '').toLowerCase();
if (!ext || ext === meta.document_file_path) ext = extFromPath(meta.document_file_path);

try {
  const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
  if (buf && buf.length >= 5 && buf.slice(0, 5).toString('ascii') === '%PDF-') {
    ext = 'pdf';
  }
} catch (e) {}

const mime = String(binary?.data?.mimeType || binary?.mimeType || '').toLowerCase();
if (mime === 'application/pdf') ext = 'pdf';

meta.document_file_ext = ext || 'txt';
meta.is_pdf = ext === 'pdf';
meta.is_docx = ext === 'docx';

return [{ json: meta, binary }];`;

const inlineTextOnlyCode = `const item = $input.first().json;
const text = String(item.document_text || '').trim();
if (!text) throw new Error('document_text is empty');

return [{
  json: {
    ...item,
    extracted_document_text: text,
    extraction_source: 'inline_text',
    document_id: item.document_id || \`doc_\${Date.now()}\`,
    document_title: item.document_title || item.document_filename || 'Untitled',
  }
}];`;

const combinePdfContentCode = `const ctx = $('Restore Meta After Read').first().json;

let nativeText = '';
try {
  const pdfRow = $('Extract PDF Text').first().json;
  nativeText = String(pdfRow.text || pdfRow.data || pdfRow.content || '').trim();
} catch (e) {}

let imageOcrText = '';
let imageDescriptionText = '';
let ocrMeta = {};
try {
  const ocrRow = $('OCR PDF Images').first().json;
  imageOcrText = String(ocrRow.pdf_image_ocr_text || '').trim();
  imageDescriptionText = String(ocrRow.pdf_image_description_text || '').trim();
  if (!imageOcrText && !imageDescriptionText) {
    imageOcrText = String(ocrRow.pdf_image_analysis_text || '').trim();
  }
  ocrMeta = {
    pdf_images_detected: ocrRow.pdf_images_detected ?? 0,
    pdf_images_ocrd: ocrRow.pdf_images_ocrd ?? 0,
    pdf_images_described: ocrRow.pdf_images_described ?? ocrRow.pdf_images_ocrd ?? 0,
    pdf_image_analysis_failures: ocrRow.pdf_image_analysis_failures ?? 0,
    pdf_image_analysis_errors: ocrRow.pdf_image_analysis_errors || [],
    ocr_skipped: ocrRow.ocr_skipped === true,
    ocr_vision_model: ocrRow.ocr_vision_model,
  };
} catch (e) {}

const sections = [];
if (nativeText) sections.push(nativeText);
const ocrdCount = ocrMeta.pdf_images_ocrd ?? 0;
const describedCount = ocrMeta.pdf_images_described ?? 0;
if (imageOcrText && ocrdCount > 0) {
  sections.push('--- Text extracted from embedded images (OCR) ---\\n' + imageOcrText);
}
if (imageDescriptionText && describedCount > 0) {
  sections.push('--- Visual description of embedded images ---\\n' + imageDescriptionText);
}

const combined = sections.join('\\n\\n').trim();
if (!combined) {
  throw new Error(
    'No text extracted from PDF. The file may be empty, encrypted, or use unsupported image encoding. Provide a text-based PDF or ensure openrouter_api_key is set for vision OCR.'
  );
}

return [{
  json: {
    ...ctx,
    extracted_document_text: combined,
    pdf_native_text_chars: nativeText.length,
    pdf_image_ocr_chars: imageOcrText.length,
    pdf_image_description_chars: imageDescriptionText.length,
    extraction_source: (imageOcrText || imageDescriptionText)
      ? (nativeText ? 'pdf_text_and_image_ocr' : 'pdf_image_ocr_only')
      : 'saved_pdf_file',
    analyzed_from: ctx.document_file_path,
    ...ocrMeta,
  },
}];`;

const extractTxtCode = `const ctx = $('Restore Meta After Read').first().json;
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
const text = buffer.toString('utf8').trim();
if (!text) throw new Error('Saved TXT/MD file is empty');

return [{
  json: {
    ...ctx,
    extracted_document_text: text,
    extraction_source: 'saved_txt_file',
    analyzed_from: ctx.document_file_path,
  }
}];`;

const extractDocxCode = `function extractDocxXmlText(xml) {
  const parts = [];
  const re = /<w:t[^>]*>([^<]*)<\\/w:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) parts.push(m[1]);
  }
  return parts.join(' ').replace(/\\s+/g, ' ').trim();
}

function extractDocxFromBuffer(buffer) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) throw new Error('word/document.xml not found in DOCX');
    const xml = entry.getData().toString('utf8');
    const text = extractDocxXmlText(xml);
    if (text) return text;
  } catch (e) {
    // fallback below
  }

  const raw = buffer.toString('binary');
  const marker = 'word/document.xml';
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const slice = raw.slice(idx, idx + 500000);
    const text = extractDocxXmlText(slice);
    if (text) return text;
  }

  throw new Error(
    'Could not extract DOCX text. Add adm-zip to NODE_FUNCTION_ALLOW_EXTERNAL in docker-compose.yml, or convert to PDF/TXT.'
  );
}

const ctx = $('Restore Meta After Read').first().json;
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
const text = extractDocxFromBuffer(buffer);
if (!text) throw new Error('DOCX file produced no extractable text');

return [{
  json: {
    ...ctx,
    extracted_document_text: text,
    extraction_source: 'docx_file',
    analyzed_from: ctx.document_file_path,
  }
}];`;

const formatIngestResponseCode = `const item = $input.first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pdfInfo = item.extraction_source
  ? '<p><strong>Extraction:</strong> ' + esc(item.extraction_source) + '</p>'
    + (item.pdf_images_detected != null
      ? '<p><strong>PDF images OCR:</strong> ' + esc(item.pdf_images_ocrd) + ' / ' + esc(item.pdf_images_detected) + '</p>'
      : '')
  : '';

const emailHtml = \`
<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#111827;">
  <h2 style="color:#1d4ed8;">Document ingested</h2>
  <p style="color:#6b7280;font-size:14px;">Run: \${esc(item.run_id)}</p>
  <p><strong>Title:</strong> \${esc(item.document_title)}</p>
  <p><strong>Document ID:</strong> \${esc(item.document_id)}</p>
  <p><strong>File:</strong> \${esc(item.document_file_path)}</p>
  <p><strong>Chunks:</strong> \${esc(item.chunks_count)}</p>
  <p><strong>Collection:</strong> \${esc(item.collection_name || 'knowledge_base')}</p>
  \${pdfInfo}
  <p><strong>Qdrant points:</strong> \${esc(item.qdrant?.points_upserted)}</p>
</div>\`;

return [{
  json: {
    ...item,
    action: 'ingest',
    email_subject: 'RAG ingest complete: ' + String(item.document_title || item.document_id || 'document').slice(0, 60),
    email_html: emailHtml,
    telegram_text: 'Document ingested: ' + String(item.document_title || item.document_id || 'document')
      + '\\nFile: ' + String(item.document_file_path || 'inline')
      + '\\nChunks: ' + String(item.chunks_count ?? 0)
      + '\\nCollection: ' + String(item.collection_name || 'knowledge_base'),
  },
}];`;

const returnIngestResultCode = `const item = $input.first().json;
return [{
  json: {
    success: true,
    action: 'ingest',
    run_id: item.run_id,
    document_id: item.document_id,
    document_title: item.document_title,
    document_file_path: item.document_file_path,
    chunks_count: item.chunks_count,
    extraction_source: item.extraction_source,
    pdf_images_detected: item.pdf_images_detected,
    pdf_images_ocrd: item.pdf_images_ocrd,
    pdf_images_described: item.pdf_images_described,
    pdf_image_analysis_failures: item.pdf_image_analysis_failures,
    pdf_image_analysis_errors: item.pdf_image_analysis_errors,
    collection_name: item.collection_name || 'knowledge_base',
    user_id: item.user_id || null,
    qdrant: item.qdrant,
    notifications: {
      email: Boolean(item.notify_email),
      email_sent: item.email_sent === true,
      email_error: item.email_error || null,
      telegram: Boolean(item.notify_telegram && (item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN) && (item.telegram_chat_id || $env.TELEGRAM_CHAT_ID)),
      telegram_sent: item.telegram_sent === true,
      telegram_error: item.telegram_error || null,
    },
    completed_at: new Date().toISOString(),
  }
}];`;

const sendEmailSmtpCode = `const item = $input.first().json;
const host = String(item.smtp_host || 'smtpout.secureserver.net').trim();
const port = Number(item.smtp_port || 465);
const user = String(item.smtp_user || item.sender_email || '').trim();
const pass = String(item.smtp_pass || '').trim();
const from = String(item.sender_email || user).trim();
const to = String(item.recipient_email || '').trim();
const subject = String(item.email_subject || 'RAG Knowledge Agent').trim();
const html = String(item.email_html || '').trim();

if (!to) {
  return [{ json: { ...item, email_sent: false, email_error: 'Missing recipient_email. Set recipient_email in the request or EMAIL_TO in .env' } }];
}
if (!user || !pass) {
  return [{
    json: {
      ...item,
      email_sent: false,
      email_error: 'SMTP not configured. Add SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO to .env and restart: docker compose up -d',
    },
  }];
}
if (!html) {
  return [{ json: { ...item, email_sent: false, email_error: 'Missing email_html content' } }];
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  return [{
    json: {
      ...item,
      email_sent: false,
      email_error: 'nodemailer not available. Add NODE_FUNCTION_ALLOW_EXTERNAL=nodemailer to docker-compose.yml and restart.',
    },
  }];
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
});

try {
  const info = await transporter.sendMail({ from, to, subject, html });
  return [{
    json: {
      ...item,
      email_sent: true,
      email_to: to,
      email_from: from,
      email_message_id: info.messageId || null,
    },
  }];
} catch (err) {
  return [{
    json: {
      ...item,
      email_sent: false,
      email_error: String(err.message || err),
      email_to: to,
    },
  }];
}`;

const sendTelegramCode = `const item = $input.first().json;
const token = String(item.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || '').trim();
const chatId = String(item.telegram_chat_id || $env.TELEGRAM_CHAT_ID || '').trim();
const text = String(item.telegram_text || '').trim();

if (!token || !chatId) {
  return [{
    json: {
      ...item,
      telegram_sent: false,
      telegram_error: 'Missing telegram_bot_token or telegram_chat_id. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env',
    },
  }];
}
if (!text) {
  return [{ json: { ...item, telegram_sent: false, telegram_error: 'Empty telegram message text' } }];
}

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: \`https://api.telegram.org/bot\${token}/sendMessage\`,
    body: { chat_id: chatId, text: text.slice(0, 4000) },
    json: true,
    timeout: 30000,
  });
  return [{ json: { ...item, telegram_sent: true, telegram_error: null } }];
} catch (err) {
  return [{
    json: {
      ...item,
      telegram_sent: false,
      telegram_error: String(err.message || err),
    },
  }];
}`;

const nodes = [
  {
    id: 'k1000000-0060-4000-8000-000000000060',
    name: 'Telegram Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [-1280, 120],
    parameters: {
      httpMethod: 'POST',
      path: 'rag-knowledge-agent-telegram',
      responseMode: 'lastNode',
      options: {},
    },
    webhookId: 'rag-knowledge-agent-telegram',
  },
  {
    id: 'k1000000-0061-4000-8000-000000000061',
    name: 'Adapt Telegram Payload',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1040, 120],
    parameters: { jsCode: adaptTelegramPayloadCode },
  },
  {
    id: 'k1000000-0062-4000-8000-000000000062',
    name: 'IF Telegram Skip?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-800, 120],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [{
          id: 'telegram-skip',
          leftValue: '={{ Boolean($json.telegram_skip) }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0063-4000-8000-000000000063',
    name: 'IF Telegram Reply?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-560, 180],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
        conditions: [{
          id: 'telegram-reply',
          leftValue: '={{ ($json.action || "").toString().trim().toLowerCase() }}',
          rightValue: 'telegram_reply',
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0064-4000-8000-000000000064',
    name: 'Send Telegram (Quick Reply)',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-320, 80],
    parameters: { jsCode: sendTelegramCode },
  },
  {
    id: 'k1000000-0065-4000-8000-000000000065',
    name: 'Return Telegram Reply',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-80, 80],
    parameters: { jsCode: returnTelegramReplyCode },
  },
  {
    id: 'k1000000-0001-4000-8000-000000000001',
    name: 'Webhook Trigger',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [-1280, 300],
    parameters: {
      httpMethod: 'POST',
      path: 'rag-knowledge-agent',
      responseMode: 'lastNode',
      options: {},
    },
    webhookId: 'rag-knowledge-agent-webhook',
  },
  {
    id: 'k1000000-0002-4000-8000-000000000002',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [-1280, 520],
    parameters: {},
  },
  {
    id: 'k1000000-0036-4000-8000-000000000036',
    name: 'Manual Trigger (Query)',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [-1280, 680],
    parameters: {},
  },
  {
    id: 'k1000000-0003-4000-8000-000000000003',
    name: 'Set: Sample Ingest',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-1040, 460],
    parameters: {
      mode: 'raw',
      jsonOutput: sampleJsonOutput(SAMPLE_INGEST_PAYLOAD),
      options: {},
    },
  },
  {
    id: 'k1000000-0004-4000-8000-000000000004',
    name: 'Set: Sample Query',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-1040, 620],
    parameters: {
      mode: 'raw',
      jsonOutput: sampleJsonOutput(SAMPLE_QUERY_PAYLOAD),
      options: {},
    },
  },
  {
    id: 'k1000000-0005-4000-8000-000000000005',
    name: 'Merge Triggers',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [-800, 400],
    parameters: { mode: 'append' },
  },
  {
    id: 'k1000000-0048-4000-8000-000000000048',
    name: 'Adapt Webhook Payload',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1040, 300],
    parameters: { jsCode: adaptChannelPayloadCode },
  },
  {
    id: 'k1000000-0006-4000-8000-000000000006',
    name: 'Normalize Input',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-560, 400],
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'action', name: 'action', value: '={{ ($json.body?.action || $json.action || "query").toString().trim().toLowerCase() }}', type: 'string' },
          { id: 'document_text', name: 'document_text', value: '={{ ($json.body?.document_text || $json.document_text || "").toString() }}', type: 'string' },
          { id: 'document_file_path', name: 'document_file_path', value: '={{ ($json.body?.document_file_path || $json.document_file_path || "").toString().trim() }}', type: 'string' },
          { id: 'document_base64', name: 'document_base64', value: '={{ ($json.body?.document_base64 || $json.document_base64 || "").toString().trim() }}', type: 'string' },
          { id: 'document_filename', name: 'document_filename', value: '={{ ($json.body?.document_filename || $json.document_filename || "document.txt").toString().trim() }}', type: 'string' },
          { id: 'document_title', name: 'document_title', value: '={{ ($json.body?.document_title || $json.document_title || "").toString().trim() }}', type: 'string' },
          { id: 'document_id', name: 'document_id', value: '={{ ($json.body?.document_id || $json.document_id || "").toString().trim() }}', type: 'string' },
          { id: 'collection_name', name: 'collection_name', value: '={{ ($json.body?.collection_name || $json.collection_name || "knowledge_base").toString().trim() }}', type: 'string' },
          { id: 'question', name: 'question', value: '={{ ($json.body?.question || $json.question || "").toString().trim() }}', type: 'string' },
          { id: 'chunk_size', name: 'chunk_size', value: '={{ Number($json.body?.chunk_size ?? $json.chunk_size ?? 1000) }}', type: 'number' },
          { id: 'chunk_overlap', name: 'chunk_overlap', value: '={{ Number($json.body?.chunk_overlap ?? $json.chunk_overlap ?? 200) }}', type: 'number' },
          { id: 'top_k', name: 'top_k', value: '={{ Number($json.body?.top_k ?? $json.top_k ?? 5) }}', type: 'number' },
          { id: 'score_threshold', name: 'score_threshold', value: '={{ Number($json.body?.score_threshold ?? $json.score_threshold ?? 0) }}', type: 'number' },
          { id: 'rag_score_threshold', name: 'rag_score_threshold', value: '={{ Number($json.body?.rag_score_threshold ?? $json.rag_score_threshold ?? 0.15) }}', type: 'number' },
          { id: 'kb_only', name: 'kb_only', value: '={{ $json.body?.kb_only ?? $json.kb_only ?? true }}', type: 'boolean' },
          { id: 'enable_fallback', name: 'enable_fallback', value: '={{ $json.body?.enable_fallback ?? $json.enable_fallback ?? false }}', type: 'boolean' },
          { id: 'enable_web_search', name: 'enable_web_search', value: '={{ $json.body?.enable_web_search ?? $json.enable_web_search ?? true }}', type: 'boolean' },
          { id: 'web_search_provider', name: 'web_search_provider', value: '={{ ($json.body?.web_search_provider || $json.web_search_provider || "duckduckgo").toString().trim().toLowerCase() }}', type: 'string' },
          { id: 'web_search_api_key', name: 'web_search_api_key', value: '={{ ($json.body?.web_search_api_key || $json.web_search_api_key || "").toString().trim() }}', type: 'string' },
          { id: 'fallback_api_url', name: 'fallback_api_url', value: '={{ ($json.body?.fallback_api_url || $json.fallback_api_url || "").toString().trim() }}', type: 'string' },
          { id: 'fallback_api_method', name: 'fallback_api_method', value: '={{ ($json.body?.fallback_api_method || $json.fallback_api_method || "POST").toString().trim().toUpperCase() }}', type: 'string' },
          { id: 'fallback_api_headers', name: 'fallback_api_headers', value: '={{ $json.body?.fallback_api_headers || $json.fallback_api_headers || {} }}', type: 'object' },
          { id: 'fallback_api_body', name: 'fallback_api_body', value: '={{ $json.body?.fallback_api_body || $json.fallback_api_body || null }}', type: 'object' },
          { id: 'notion_api_key', name: 'notion_api_key', value: '={{ ($json.body?.notion_api_key || $json.notion_api_key || "").toString().trim() }}', type: 'string' },
          { id: 'notion_database_id', name: 'notion_database_id', value: '={{ ($json.body?.notion_database_id || $json.notion_database_id || "").toString().trim() }}', type: 'string' },
          { id: 'confluence_base_url', name: 'confluence_base_url', value: '={{ ($json.body?.confluence_base_url || $json.confluence_base_url || "").toString().trim() }}', type: 'string' },
          { id: 'confluence_email', name: 'confluence_email', value: '={{ ($json.body?.confluence_email || $json.confluence_email || "").toString().trim() }}', type: 'string' },
          { id: 'confluence_api_token', name: 'confluence_api_token', value: '={{ ($json.body?.confluence_api_token || $json.confluence_api_token || "").toString().trim() }}', type: 'string' },
          { id: 'database_query_url', name: 'database_query_url', value: '={{ ($json.body?.database_query_url || $json.database_query_url || "").toString().trim() }}', type: 'string' },
          { id: 'database_query_headers', name: 'database_query_headers', value: '={{ $json.body?.database_query_headers || $json.database_query_headers || {} }}', type: 'object' },
          { id: 'user_id', name: 'user_id', value: '={{ ($json.body?.user_id || $json.user_id || "").toString().trim() }}', type: 'string' },
          { id: 'filter_results_by_user_id', name: 'filter_results_by_user_id', value: '={{ $json.body?.filter_results_by_user_id ?? $json.filter_results_by_user_id ?? false }}', type: 'boolean' },
          { id: 'embedding_model', name: 'embedding_model', value: '={{ ($json.body?.embedding_model || $json.embedding_model || $env.EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free").toString().trim() }}', type: 'string' },
          { id: 'embedding_provider', name: 'embedding_provider', value: '={{ ($json.body?.embedding_provider || $json.embedding_provider || "auto").toString().trim().toLowerCase() }}', type: 'string' },
          { id: 'embedding_dimensions', name: 'embedding_dimensions', value: '={{ Number($json.body?.embedding_dimensions ?? $json.embedding_dimensions ?? $env.EMBEDDING_DIMENSIONS ?? 2048) }}', type: 'number' },
          { id: 'brand_website', name: 'brand_website', value: '={{ ($json.body?.brand_website || $json.brand_website || "").toString().trim() }}', type: 'string' },
          { id: 'openai_api_key', name: 'openai_api_key', value: '={{ ($json.body?.openai_api_key || $json.openai_api_key || "").toString().trim().replace(/^Bearer\\s+/i, "") }}', type: 'string' },
          { id: 'openrouter_api_key', name: 'openrouter_api_key', value: '={{ ($json.body?.openrouter_api_key || $json.openrouter_api_key || $env.OPENROUTER_API_KEY || "").toString().trim().replace(/^Bearer\\s+/i, "") }}', type: 'string' },
          { id: 'channel', name: 'channel', value: '={{ ($json.body?.channel || $json.channel || "").toString().trim().toLowerCase() }}', type: 'string' },
          { id: 'fallback_providers', name: 'fallback_providers', value: '={{ $json.body?.fallback_providers || $json.fallback_providers || null }}', type: 'object' },
          { id: 'openrouter_model', name: 'openrouter_model', value: '={{ ($json.body?.openrouter_model || $json.openrouter_model || $env.OPENROUTER_MODEL || "").toString().trim() }}', type: 'string' },
          { id: 'enable_pdf_ocr', name: 'enable_pdf_ocr', value: '={{ $json.body?.enable_pdf_ocr ?? $json.enable_pdf_ocr ?? true }}', type: 'boolean' },
          { id: 'enable_pdf_image_analysis', name: 'enable_pdf_image_analysis', value: '={{ $json.body?.enable_pdf_image_analysis ?? $json.enable_pdf_image_analysis ?? true }}', type: 'boolean' },
          { id: 'ocr_vision_model', name: 'ocr_vision_model', value: '={{ ($json.body?.ocr_vision_model || $json.ocr_vision_model || $env.OCR_VISION_MODEL || $env.OPENROUTER_MODEL || "").toString().trim() }}', type: 'string' },
          { id: 'max_pdf_ocr_images', name: 'max_pdf_ocr_images', value: '={{ Number($json.body?.max_pdf_ocr_images ?? $json.max_pdf_ocr_images ?? 25) }}', type: 'number' },
          { id: 'pdf_ocr_max_tokens', name: 'pdf_ocr_max_tokens', value: '={{ Number($json.body?.pdf_ocr_max_tokens ?? $json.pdf_ocr_max_tokens ?? 700) }}', type: 'number' },
          { id: 'qdrant_url', name: 'qdrant_url', value: '={{ ($json.body?.qdrant_url || $json.qdrant_url || $env.QDRANT_URL || "").toString().trim().replace(/\\/$/, "") }}', type: 'string' },
          { id: 'enable_query_history', name: 'enable_query_history', value: '={{ $json.body?.enable_query_history ?? $json.enable_query_history ?? false }}', type: 'boolean' },
          { id: 'history_collection_name', name: 'history_collection_name', value: '={{ ($json.body?.history_collection_name || $json.history_collection_name || "query_history").toString().trim() }}', type: 'string' },
          { id: 'history_top_k', name: 'history_top_k', value: '={{ Number($json.body?.history_top_k ?? $json.history_top_k ?? 3) }}', type: 'number' },
          { id: 'history_score_threshold', name: 'history_score_threshold', value: '={{ Number($json.body?.history_score_threshold ?? $json.history_score_threshold ?? 0.4) }}', type: 'number' },
          { id: 'metadata', name: 'metadata', value: '={{ $json.body?.metadata || $json.metadata || {} }}', type: 'object' },
          { id: 'notify_email', name: 'notify_email', value: '={{ $json.body?.notify_email ?? $json.notify_email ?? ($env.EMAIL_TO && $env.SMTP_USER && $env.SMTP_PASS ? true : false) }}', type: 'boolean' },
          { id: 'notify_telegram', name: 'notify_telegram', value: '={{ $json.body?.notify_telegram ?? $json.notify_telegram ?? ($env.TELEGRAM_BOT_TOKEN && $env.TELEGRAM_CHAT_ID ? true : false) }}', type: 'boolean' },
          { id: 'sender_email', name: 'sender_email', value: '={{ ($json.body?.sender_email || $json.sender_email || $env.EMAIL_FROM || "").toString().trim() }}', type: 'string' },
          { id: 'recipient_email', name: 'recipient_email', value: '={{ ($json.body?.recipient_email || $json.recipient_email || $env.EMAIL_TO || "").toString().trim() }}', type: 'string' },
          { id: 'smtp_host', name: 'smtp_host', value: '={{ ($json.body?.smtp_host || $json.smtp_host || $env.SMTP_HOST || "smtpout.secureserver.net").toString().trim() }}', type: 'string' },
          { id: 'smtp_port', name: 'smtp_port', value: '={{ Number($json.body?.smtp_port ?? $json.smtp_port ?? $env.SMTP_PORT ?? 465) }}', type: 'number' },
          { id: 'smtp_user', name: 'smtp_user', value: '={{ ($json.body?.smtp_user || $json.smtp_user || $env.SMTP_USER || "").toString().trim() }}', type: 'string' },
          { id: 'smtp_pass', name: 'smtp_pass', value: '={{ ($json.body?.smtp_pass || $json.smtp_pass || $env.SMTP_PASS || "").toString() }}', type: 'string' },
          { id: 'telegram_bot_token', name: 'telegram_bot_token', value: '={{ ($json.body?.telegram_bot_token || $json.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || "").toString().trim() }}', type: 'string' },
          { id: 'telegram_chat_id', name: 'telegram_chat_id', value: '={{ ($json.body?.telegram_chat_id || $json.telegram_chat_id || $env.TELEGRAM_CHAT_ID || "").toString().trim() }}', type: 'string' },
        ],
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0007-4000-8000-000000000007',
    name: 'Validate Input',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-320, 400],
    parameters: { jsCode: validateInputCode },
  },
  {
    id: 'k1000000-0008-4000-8000-000000000008',
    name: 'IF Ingest?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [-80, 280],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
        conditions: [{
          id: 'is-ingest',
          leftValue: '={{ ($json.action || "").toString().trim().toLowerCase() }}',
          rightValue: 'ingest',
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0009-4000-8000-000000000009',
    name: 'Prepare Document File',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [200, 120],
    parameters: { jsCode: prepareDocumentCode },
  },
  {
    id: 'k1000000-0032-4000-8000-000000000032',
    name: 'Inline Text Only?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [200, 240],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
        conditions: [
          {
            id: 'has-inline-text',
            leftValue: '={{ ($json.document_text || "").toString().trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
          {
            id: 'no-file-path',
            leftValue: '={{ ($json.document_file_path || "").toString().trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'empty' },
          },
          {
            id: 'no-base64',
            leftValue: '={{ ($json.document_base64 || "").toString().trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'empty' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0033-4000-8000-000000000033',
    name: 'Use Inline Text',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [420, 160],
    parameters: { jsCode: inlineTextOnlyCode },
  },
  {
    id: 'k1000000-0010-4000-8000-000000000010',
    name: 'Use Existing File?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [420, 320],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
          conditions: [{
            id: 'skip-write',
            leftValue: '={{ $json.skip_write === true }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0034-4000-8000-000000000034',
    name: 'Use Existing Document File',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [640, 260],
    parameters: { jsCode: useExistingDocumentCode },
  },
  {
    id: 'k1000000-0011-4000-8000-000000000011',
    name: 'Write Document File',
    type: 'n8n-nodes-base.writeBinaryFile',
    typeVersion: 1,
    position: [640, 200],
    parameters: {
      fileName: '={{ $json.document_file_path }}',
      dataPropertyName: 'data',
      options: {},
    },
  },
  {
    id: 'k1000000-0035-4000-8000-000000000035',
    name: 'After Write With Binary',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [860, 400],
    parameters: { jsCode: afterWriteWithBinaryCode },
  },
  {
    id: 'k1000000-0013-4000-8000-000000000013',
    name: 'Read Document File',
    type: 'n8n-nodes-base.readBinaryFile',
    typeVersion: 1,
    position: [860, 260],
    parameters: {
      filePath: '={{ $json.document_file_path }}',
      dataPropertyName: 'data',
      options: {},
    },
  },
  {
    id: 'k1000000-0012-4000-8000-000000000012',
    name: 'Restore Meta After Read',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1080, 320],
    parameters: { jsCode: restoreMetaCode },
  },
  {
    id: 'k1000000-0014-4000-8000-000000000014',
    name: 'Is PDF?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1300, 320],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: false, typeValidation: 'loose' },
        conditions: [
          {
            id: 'is-pdf-ext',
            leftValue: '={{ ($json.document_file_ext || "").toString().toLowerCase() }}',
            rightValue: 'pdf',
            operator: { type: 'string', operation: 'equals' },
          },
          {
            id: 'is-pdf-flag',
            leftValue: '={{ $json.is_pdf }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
          {
            id: 'is-pdf-path',
            leftValue: '={{ ($json.document_file_path || "").toString().toLowerCase() }}',
            rightValue: '.pdf',
            operator: { type: 'string', operation: 'endsWith' },
          },
        ],
        combinator: 'or',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0015-4000-8000-000000000015',
    name: 'Extract PDF Text',
    type: 'n8n-nodes-base.extractFromFile',
    typeVersion: 1,
    position: [1520, 240],
    parameters: { operation: 'pdf', binaryPropertyName: 'data', options: {} },
  },
  {
    id: 'k1000000-0038-4000-8000-000000000038',
    name: 'OCR PDF Images',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1520, 120],
    parameters: { jsCode: ocrPdfImagesCode },
  },
  {
    id: 'k1000000-0039-4000-8000-000000000039',
    name: 'Merge PDF Branches',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [1740, 200],
    parameters: { mode: 'combine', combineBy: 'combineAll', options: {} },
  },
  {
    id: 'k1000000-0040-4000-8000-000000000040',
    name: 'Combine PDF Content',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1960, 200],
    parameters: { jsCode: combinePdfContentCode },
  },
  {
    id: 'k1000000-0044-4000-8000-000000000044',
    name: 'Is DOCX?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1300, 480],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: false, typeValidation: 'loose' },
        conditions: [
          {
            id: 'is-docx-ext',
            leftValue: '={{ ($json.document_file_ext || "").toString().toLowerCase() }}',
            rightValue: 'docx',
            operator: { type: 'string', operation: 'equals' },
          },
          {
            id: 'is-docx-flag',
            leftValue: '={{ $json.is_docx }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
          {
            id: 'is-docx-path',
            leftValue: '={{ ($json.document_file_path || "").toString().toLowerCase() }}',
            rightValue: '.docx',
            operator: { type: 'string', operation: 'endsWith' },
          },
        ],
        combinator: 'or',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0045-4000-8000-000000000045',
    name: 'Extract DOCX From File',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1520, 480],
    parameters: { jsCode: extractDocxCode },
  },
  {
    id: 'k1000000-0017-4000-8000-000000000017',
    name: 'Extract TXT From File',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1520, 400],
    parameters: { jsCode: extractTxtCode },
  },
  {
    id: 'k1000000-0018-4000-8000-000000000018',
    name: 'Chunk Document',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2180, 320],
    parameters: { jsCode: chunkDocumentCode },
  },
  {
    id: 'k1000000-0019-4000-8000-000000000019',
    name: 'Generate Embeddings',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2400, 320],
    parameters: { jsCode: generateEmbeddingsCode },
  },
  {
    id: 'k1000000-0020-4000-8000-000000000020',
    name: 'Store in Qdrant',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2620, 320],
    parameters: { jsCode: storeInQdrantCode },
  },
  {
    id: 'k1000000-0041-4000-8000-000000000041',
    name: 'Format Ingest Response',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2840, 320],
    parameters: { jsCode: formatIngestResponseCode },
  },
  {
    id: 'k1000000-0042-4000-8000-000000000042',
    name: 'Notify Email? (Ingest)',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [3060, 280],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [
          {
            id: 'notify-email-ingest',
            leftValue: '={{ Boolean($json.notify_email) }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
          {
            id: 'has-recipient-ingest',
            leftValue: '={{ ($json.recipient_email || "").trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0043-4000-8000-000000000043',
    name: 'Send Email (Ingest)',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3280, 240],
    parameters: { jsCode: sendEmailSmtpCode },
  },
  {
    id: 'k1000000-0049-4000-8000-000000000049',
    name: 'Notify Telegram? (Ingest)',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [3500, 280],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [
          {
            id: 'notify-telegram-ingest',
            leftValue: '={{ Boolean($json.notify_telegram) }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
          {
            id: 'has-bot-token-ingest',
            leftValue: '={{ ($json.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || "").trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
          {
            id: 'has-chat-id-ingest',
            leftValue: '={{ ($json.telegram_chat_id || $env.TELEGRAM_CHAT_ID || "").trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0050-4000-8000-000000000050',
    name: 'Send Telegram (Ingest)',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3720, 240],
    parameters: { jsCode: sendTelegramCode },
  },
  {
    id: 'k1000000-0021-4000-8000-000000000021',
    name: 'Return Ingest Result',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3940, 320],
    parameters: { jsCode: returnIngestResultCode },
  },
  // --- QUERY PATH (modular routing) ---
  {
    id: 'k1000000-0022-4000-8000-000000000022',
    name: 'Generate Query Embedding',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [200, 520],
    parameters: { jsCode: queryEmbeddingCode },
  },
  {
    id: 'k1000000-0065-4000-8000-000000000065',
    name: 'IF Query Error?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [320, 520],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
        conditions: [{
          id: 'query-error',
          leftValue: '={{ Boolean($json.query_error_reply) }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0052-4000-8000-000000000052',
    name: 'Search Query History',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [420, 520],
    parameters: { jsCode: searchQueryHistoryCode },
  },
  {
    id: 'k1000000-0023-4000-8000-000000000023',
    name: 'Search Qdrant',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [640, 520],
    parameters: { jsCode: searchQdrantCode },
  },
  {
    id: 'k1000000-0049-4000-8000-000000000049',
    name: 'Evaluate Retrieval',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [640, 520],
    parameters: { jsCode: evaluateRetrievalCode },
  },
  {
    id: 'k1000000-0050-4000-8000-000000000050',
    name: 'IF RAG Relevant?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [860, 520],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [{
          id: 'rag-relevant',
          leftValue: '={{ $json.rag_relevant === true }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0051-4000-8000-000000000051',
    name: 'Generate RAG Answer',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1080, 400],
    parameters: { jsCode: generateRagAnswerCode },
  },
  {
    id: 'k1000000-0052-4000-8000-000000000052',
    name: 'IF Enable Fallback?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1080, 620],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [{
          id: 'enable-fallback',
          leftValue: '={{ $json.enable_fallback !== false }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0053-4000-8000-000000000053',
    name: 'Try External Providers',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1300, 560],
    parameters: { jsCode: tryExternalProvidersCode },
  },
  {
    id: 'k1000000-0054-4000-8000-000000000054',
    name: 'IF External Context?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [1520, 560],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [{
          id: 'has-external',
          leftValue: '={{ $json.has_external_context === true }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true' },
        }],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0055-4000-8000-000000000055',
    name: 'Generate External Answer',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1740, 480],
    parameters: { jsCode: generateExternalAnswerCode },
  },
  {
    id: 'k1000000-0056-4000-8000-000000000056',
    name: 'Generate LLM Fallback Answer',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1740, 640],
    parameters: { jsCode: generateLlmFallbackAnswerCode },
  },
  {
    id: 'k1000000-0057-4000-8000-000000000057',
    name: 'Generate No Fallback Answer',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1300, 720],
    parameters: { jsCode: generateNoFallbackAnswerCode },
  },
  {
    id: 'k1000000-0058-4000-8000-000000000058',
    name: 'Merge Query Answer',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [1960, 520],
    parameters: { mode: 'append' },
  },
  {
    id: 'k1000000-0059-4000-8000-000000000059',
    name: 'Attach Response Metadata',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2180, 520],
    parameters: { jsCode: attachResponseMetadataCode },
  },
  {
    id: 'k1000000-0053-4000-8000-000000000053',
    name: 'Save Query History',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2300, 520],
    parameters: { jsCode: saveQueryHistoryCode },
  },
  {
    id: 'k1000000-0025-4000-8000-000000000025',
    name: 'Format Query Response',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2400, 520],
    parameters: { jsCode: formatQueryResponseCode },
  },
  {
    id: 'k1000000-0026-4000-8000-000000000026',
    name: 'Notify Email?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [2620, 460],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [
          {
            id: 'notify-email-query',
            leftValue: '={{ Boolean($json.notify_email) }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
          {
            id: 'has-recipient-query',
            leftValue: '={{ ($json.recipient_email || "").trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0027-4000-8000-000000000027',
    name: 'Send Email',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2840, 440],
    parameters: { jsCode: sendEmailSmtpCode },
  },
  {
    id: 'k1000000-0028-4000-8000-000000000028',
    name: 'Notify Telegram?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [2620, 600],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'loose' },
        conditions: [
          {
            id: 'notify-telegram',
            leftValue: '={{ Boolean($json.notify_telegram) }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true' },
          },
          {
            id: 'has-bot-token',
            leftValue: '={{ ($json.telegram_bot_token || $env.TELEGRAM_BOT_TOKEN || "").trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
          {
            id: 'has-chat-id',
            leftValue: '={{ ($json.telegram_chat_id || $env.TELEGRAM_CHAT_ID || "").trim() }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty' },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  },
  {
    id: 'k1000000-0029-4000-8000-000000000029',
    name: 'Send Telegram',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2840, 580],
    parameters: { jsCode: sendTelegramCode },
  },
  {
    id: 'k1000000-0030-4000-8000-000000000030',
    name: 'Return Query Result',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3060, 520],
    parameters: { jsCode: returnQueryResultCode },
  },
  {
    id: 'k1000000-0031-4000-8000-000000000031',
    name: 'Note: Workflow',
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-1300, -120],
    parameters: {
      width: 520,
      height: 280,
      content: '## RAG Knowledge Agent V5\\n\\n**Webhook:** POST /webhook/rag-knowledge-agent\\n**Telegram:** POST /webhook/rag-knowledge-agent-telegram (set TELEGRAM_BOT_TOKEN + register webhook)\\n**Manual:** Manual Trigger → sample ingest | Manual Trigger (Query) → sample query\\n**Keys:** OPENROUTER_API_KEY in .env (not required in sample nodes)',
    },
  },
];

const connections = {
  'Telegram Webhook': { main: [[{ node: 'Adapt Telegram Payload', type: 'main', index: 0 }]] },
  'Adapt Telegram Payload': { main: [[{ node: 'IF Telegram Skip?', type: 'main', index: 0 }]] },
  'IF Telegram Skip?': {
    main: [
      [],
      [{ node: 'IF Telegram Reply?', type: 'main', index: 0 }],
    ],
  },
  'IF Telegram Reply?': {
    main: [
      [{ node: 'Send Telegram (Quick Reply)', type: 'main', index: 0 }],
      [{ node: 'Normalize Input', type: 'main', index: 0 }],
    ],
  },
  'Send Telegram (Quick Reply)': { main: [[{ node: 'Return Telegram Reply', type: 'main', index: 0 }]] },
  'Webhook Trigger': { main: [[{ node: 'Adapt Webhook Payload', type: 'main', index: 0 }]] },
  'Adapt Webhook Payload': { main: [[{ node: 'Merge Triggers', type: 'main', index: 0 }]] },
  'Manual Trigger': { main: [[{ node: 'Set: Sample Ingest', type: 'main', index: 0 }]] },
  'Manual Trigger (Query)': { main: [[{ node: 'Set: Sample Query', type: 'main', index: 0 }]] },
  'Set: Sample Ingest': { main: [[{ node: 'Merge Triggers', type: 'main', index: 1 }]] },
  'Set: Sample Query': { main: [[{ node: 'Merge Triggers', type: 'main', index: 1 }]] },
  'Merge Triggers': { main: [[{ node: 'Normalize Input', type: 'main', index: 0 }]] },
  'Normalize Input': { main: [[{ node: 'Validate Input', type: 'main', index: 0 }]] },
  'Validate Input': {
    main: [[{ node: 'IF Ingest?', type: 'main', index: 0 }]],
  },
  'IF Ingest?': {
    main: [
      [{ node: 'Inline Text Only?', type: 'main', index: 0 }],
      [{ node: 'Generate Query Embedding', type: 'main', index: 0 }],
    ],
  },
  'Inline Text Only?': {
    main: [
      [{ node: 'Use Inline Text', type: 'main', index: 0 }],
      [{ node: 'Prepare Document File', type: 'main', index: 0 }],
    ],
  },
  'Use Inline Text': { main: [[{ node: 'Chunk Document', type: 'main', index: 0 }]] },
  'Prepare Document File': { main: [[{ node: 'Use Existing File?', type: 'main', index: 0 }]] },
  'Use Existing File?': {
    main: [
      [{ node: 'Use Existing Document File', type: 'main', index: 0 }],
      [{ node: 'Write Document File', type: 'main', index: 0 }],
    ],
  },
  'Use Existing Document File': { main: [[{ node: 'Read Document File', type: 'main', index: 0 }]] },
  'Write Document File': { main: [[{ node: 'After Write With Binary', type: 'main', index: 0 }]] },
  'After Write With Binary': { main: [[{ node: 'Restore Meta After Read', type: 'main', index: 0 }]] },
  'Read Document File': { main: [[{ node: 'Restore Meta After Read', type: 'main', index: 0 }]] },
  'Restore Meta After Read': { main: [[{ node: 'Is PDF?', type: 'main', index: 0 }]] },
  'Is PDF?': {
    main: [
      [
        { node: 'Extract PDF Text', type: 'main', index: 0 },
        { node: 'OCR PDF Images', type: 'main', index: 0 },
      ],
      [{ node: 'Is DOCX?', type: 'main', index: 0 }],
    ],
  },
  'Is DOCX?': {
    main: [
      [{ node: 'Extract DOCX From File', type: 'main', index: 0 }],
      [{ node: 'Extract TXT From File', type: 'main', index: 0 }],
    ],
  },
  'Extract DOCX From File': { main: [[{ node: 'Chunk Document', type: 'main', index: 0 }]] },
  'Extract PDF Text': { main: [[{ node: 'Merge PDF Branches', type: 'main', index: 0 }]] },
  'OCR PDF Images': { main: [[{ node: 'Merge PDF Branches', type: 'main', index: 1 }]] },
  'Merge PDF Branches': { main: [[{ node: 'Combine PDF Content', type: 'main', index: 0 }]] },
  'Combine PDF Content': { main: [[{ node: 'Chunk Document', type: 'main', index: 0 }]] },
  'Extract TXT From File': { main: [[{ node: 'Chunk Document', type: 'main', index: 0 }]] },
  'Chunk Document': { main: [[{ node: 'Generate Embeddings', type: 'main', index: 0 }]] },
  'Generate Embeddings': { main: [[{ node: 'Store in Qdrant', type: 'main', index: 0 }]] },
  'Store in Qdrant': { main: [[{ node: 'Format Ingest Response', type: 'main', index: 0 }]] },
  'Format Ingest Response': { main: [[{ node: 'Notify Email? (Ingest)', type: 'main', index: 0 }]] },
  'Notify Email? (Ingest)': {
    main: [
      [{ node: 'Send Email (Ingest)', type: 'main', index: 0 }],
      [{ node: 'Notify Telegram? (Ingest)', type: 'main', index: 0 }],
    ],
  },
  'Send Email (Ingest)': { main: [[{ node: 'Notify Telegram? (Ingest)', type: 'main', index: 0 }]] },
  'Notify Telegram? (Ingest)': {
    main: [
      [{ node: 'Send Telegram (Ingest)', type: 'main', index: 0 }],
      [{ node: 'Return Ingest Result', type: 'main', index: 0 }],
    ],
  },
  'Send Telegram (Ingest)': { main: [[{ node: 'Return Ingest Result', type: 'main', index: 0 }]] },
  'Generate Query Embedding': { main: [[{ node: 'IF Query Error?', type: 'main', index: 0 }]] },
  'IF Query Error?': {
    main: [
      [{ node: 'Notify Telegram?', type: 'main', index: 0 }],
      [{ node: 'Search Query History', type: 'main', index: 0 }],
    ],
  },
  'Search Query History': { main: [[{ node: 'Search Qdrant', type: 'main', index: 0 }]] },
  'Search Qdrant': { main: [[{ node: 'Evaluate Retrieval', type: 'main', index: 0 }]] },
  'Evaluate Retrieval': { main: [[{ node: 'IF RAG Relevant?', type: 'main', index: 0 }]] },
  'IF RAG Relevant?': {
    main: [
      [{ node: 'Generate RAG Answer', type: 'main', index: 0 }],
      [{ node: 'IF Enable Fallback?', type: 'main', index: 0 }],
    ],
  },
  'Generate RAG Answer': { main: [[{ node: 'Merge Query Answer', type: 'main', index: 0 }]] },
  'IF Enable Fallback?': {
    main: [
      [{ node: 'Try External Providers', type: 'main', index: 0 }],
      [{ node: 'Generate No Fallback Answer', type: 'main', index: 0 }],
    ],
  },
  'Try External Providers': { main: [[{ node: 'IF External Context?', type: 'main', index: 0 }]] },
  'IF External Context?': {
    main: [
      [{ node: 'Generate External Answer', type: 'main', index: 0 }],
      [{ node: 'Generate LLM Fallback Answer', type: 'main', index: 0 }],
    ],
  },
  'Generate External Answer': { main: [[{ node: 'Merge Query Answer', type: 'main', index: 0 }]] },
  'Generate LLM Fallback Answer': { main: [[{ node: 'Merge Query Answer', type: 'main', index: 0 }]] },
  'Generate No Fallback Answer': { main: [[{ node: 'Merge Query Answer', type: 'main', index: 0 }]] },
  'Merge Query Answer': { main: [[{ node: 'Attach Response Metadata', type: 'main', index: 0 }]] },
  'Attach Response Metadata': { main: [[{ node: 'Save Query History', type: 'main', index: 0 }]] },
  'Save Query History': { main: [[{ node: 'Format Query Response', type: 'main', index: 0 }]] },
  'Format Query Response': { main: [[{ node: 'Notify Email?', type: 'main', index: 0 }]] },
  'Notify Email?': {
    main: [
      [{ node: 'Send Email', type: 'main', index: 0 }],
      [{ node: 'Notify Telegram?', type: 'main', index: 0 }],
    ],
  },
  'Send Email': { main: [[{ node: 'Notify Telegram?', type: 'main', index: 0 }]] },
  'Notify Telegram?': {
    main: [
      [{ node: 'Send Telegram', type: 'main', index: 0 }],
      [{ node: 'Return Query Result', type: 'main', index: 0 }],
    ],
  },
  'Send Telegram': { main: [[{ node: 'Return Query Result', type: 'main', index: 0 }]] },
};

const workflow = {
  name: 'RAG Knowledge Agent',
  id: 'RagKnowledgeAgentV5',
  nodes,
  connections,
  active: true,
  isArchived: false,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    callerPolicy: 'workflowsFromSameOwner',
    errorWorkflow: '',
  },
  pinData: {},
  tags: [{ name: 'rag' }, { name: 'qdrant' }, { name: 'openrouter' }],
};

const outPath = path.join(__dirname, '..', 'workflows', 'rag-knowledge-agent.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));
console.log('Wrote', outPath);
