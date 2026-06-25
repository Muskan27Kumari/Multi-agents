/**
 * Google Drive API helpers and RAG ingest sync (shared by admin sync + user Drive bot).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  contentHash,
  documentIdFromFile,
  documentIdForUser,
  qdrantHasDocument,
  qdrantDeleteDocument,
} = require('./qdrant-docs');

const SUPPORTED = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'text/html': '.html',
  'application/rtf': '.rtf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.google-apps.document': '.txt',
  'application/vnd.google-apps.spreadsheet': '.csv',
  'application/vnd.google-apps.presentation': '.txt',
};

function looksLikeBareDriveId(raw) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(raw)) return false;
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return false;
  if (!/[a-zA-Z]/.test(raw)) return false;
  return true;
}

function extractDriveResource(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const folderMatch = raw.match(/drive\.google\.com\/(?:drive\/)?folders\/([a-zA-Z0-9_-]+)/i)
    || raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return { type: 'folder', id: folderMatch[1], url: raw };
  }

  const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i)
    || raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return { type: 'file', id: fileMatch[1], url: raw };
  }

  if (looksLikeBareDriveId(raw)) {
    return { type: 'folder', id: raw, url: raw };
  }

  return null;
}

function isDriveUrl(text) {
  return Boolean(extractDriveResource(text));
}

function loadCredentials(credentialsFile) {
  if (!fs.existsSync(credentialsFile)) {
    throw new Error(
      `Service account file not found: ${credentialsFile}\n` +
      'Create a service account, enable Drive API, download JSON, and share the folder with the service account email.'
    );
  }
  const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Invalid service account JSON: missing client_email or private_key');
  }
  return creds;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signInput = `${header}.${claim}`;
  const signature = crypto.createSign('RSA-SHA256').update(signInput).sign(credentials.private_key, 'base64url');
  const jwt = `${signInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  }
  return data.access_token;
}

async function driveRequest(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

async function getFileMetadata(token, fileId) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set('fields', 'id,name,mimeType,modifiedTime,size');
  const res = await driveRequest(token, url.toString());
  return res.json();
}

async function listFolderItems(token, folderId) {
  const items = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,modifiedTime,size)');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await driveRequest(token, url.toString());
    const data = await res.json();
    items.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function listFolderFiles(token, folderId, recursive = true) {
  const files = [];
  const queue = [folderId];

  while (queue.length) {
    const currentFolderId = queue.shift();
    const items = await listFolderItems(token, currentFolderId);
    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        if (recursive) queue.push(item.id);
        continue;
      }
      files.push({ ...item, drive_folder_id: currentFolderId });
    }
  }

  return files;
}

async function resolveDriveFiles(token, resource, recursive = true) {
  if (!resource || !resource.id) return [];
  if (resource.type === 'file') {
    const meta = await getFileMetadata(token, resource.id);
    return [{ ...meta, drive_folder_id: resource.id }];
  }
  return listFolderFiles(token, resource.id, recursive);
}

function safeFilename(name, ext) {
  const base = String(name || 'document')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const lower = base.toLowerCase();
  if (ext && lower.endsWith(ext.toLowerCase())) return base;
  return ext ? `${base}${ext}` : base;
}

async function downloadFile(token, file, downloadDir) {
  const mime = file.mimeType;
  let downloadUrl;
  let ext = EXT_BY_MIME[mime] || '';

  if (mime === 'application/vnd.google-apps.document') {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
    ext = '.txt';
  } else if (mime === 'application/vnd.google-apps.spreadsheet') {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
    ext = '.csv';
  } else if (mime === 'application/vnd.google-apps.presentation') {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
    ext = '.txt';
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    if (!ext) {
      const fromName = (file.name || '').match(/(\.[a-z0-9]+)$/i);
      ext = fromName ? fromName[1].toLowerCase() : '.bin';
    }
  }

  const res = await driveRequest(token, downloadUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = safeFilename(file.name, ext);
  fs.mkdirSync(downloadDir, { recursive: true });
  const localPath = path.join(downloadDir, filename);
  fs.writeFileSync(localPath, buf);
  return { localPath, filename };
}

function toContainerPath(localPath, filesRoot) {
  const rel = path.relative(filesRoot, localPath).split(path.sep).join('/');
  return `/files/${rel}`;
}

function buildIngestPayload({
  localPath,
  file,
  containerPath,
  documentId,
  userId,
  folderId,
  ingestWebhook,
  qdrantUrl,
  source,
}) {
  const title = String(file.name || documentId).replace(/\.[^.]+$/, '');
  return {
    action: 'ingest',
    document_title: title,
    document_id: documentId,
    document_file_path: containerPath,
    collection_name: 'knowledge_base',
    chunk_size: 1000,
    chunk_overlap: 200,
    enable_pdf_ocr: true,
    enable_pdf_image_analysis: true,
    ocr_vision_model: String(process.env.OCR_VISION_MODEL || process.env.OPENROUTER_MODEL || '').trim(),
    max_pdf_ocr_images: Number(process.env.MAX_PDF_OCR_IMAGES || 25),
    pdf_ocr_max_tokens: Number(process.env.PDF_OCR_MAX_TOKENS || 700),
    kb_only: true,
    qdrant_url: String(qdrantUrl || process.env.QDRANT_URL || 'http://qdrant:6333').trim(),
    user_id: userId || undefined,
    metadata: {
      source: source || (userId ? 'user_drive' : 'google_drive'),
      drive_file_id: file.id,
      drive_folder_id: folderId || file.drive_folder_id,
      drive_modified_time: file.modifiedTime,
      ...(userId ? { user_id: userId } : {}),
    },
  };
}

async function ingestFile(payload, ingestWebhook) {
  const timeoutMs = Number(process.env.INGEST_TIMEOUT_MS || process.env.TELEGRAM_WEBHOOK_TIMEOUT_MS || 600000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ingestWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if (!res.ok && !data.success) {
      throw new Error(`Ingest failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ingest timed out after ${Math.round(timeoutMs / 1000)}s — try /resync`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sync Drive folder or file into the RAG knowledge base.
 */
async function syncDriveToRag(options) {
  const {
    token,
    resource,
    userId = '',
    downloadDir,
    filesRoot,
    ingestWebhook,
    qdrantUrl,
    recursive = true,
    state = { files: {} },
    rootFolderId = resource?.type === 'folder' ? resource.id : '',
    onProgress = null,
    forceReingest = false,
  } = options;

  const files = await resolveDriveFiles(token, resource, recursive);
  const result = {
    ingested: 0,
    skipped: 0,
    failed: 0,
    total: files.length,
    totalChunks: 0,
    errors: [],
    files: [],
  };

  const resolveDocumentId = userId
    ? (localPath) => documentIdForUser(localPath, userId)
    : (localPath) => documentIdFromFile(localPath);

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!SUPPORTED.has(file.mimeType)) {
      result.skipped += 1;
      if (onProgress) {
        onProgress({ phase: 'skip', file, index: i + 1, total: files.length, reason: 'unsupported' });
      }
      continue;
    }

    const prev = state.files[file.id];
    if (onProgress) {
      onProgress({ phase: 'start', file, index: i + 1, total: files.length });
    }

    try {
      const { localPath } = await downloadFile(token, file, downloadDir);
      const hash = contentHash(localPath);
      const documentId = resolveDocumentId(localPath);
      const containerPath = toContainerPath(localPath, filesRoot);

      if (!forceReingest && prev && prev.content_hash === hash && prev.document_id === documentId) {
        if (await qdrantHasDocument(documentId)) {
          result.skipped += 1;
          result.files.push({ name: file.name, document_id: documentId, status: 'skipped' });
          if (onProgress) {
            onProgress({ phase: 'skip', file, index: i + 1, total: files.length, reason: 'unchanged' });
          }
          continue;
        }
      } else if (prev?.document_id && prev.document_id !== documentId) {
        await qdrantDeleteDocument(prev.document_id);
      }

      const payload = buildIngestPayload({
        localPath,
        file,
        containerPath,
        documentId,
        userId,
        folderId: rootFolderId || file.drive_folder_id,
        ingestWebhook,
        qdrantUrl,
      });

      const ingestResult = await ingestFile(payload, ingestWebhook);
      const chunks = Number(ingestResult.chunks_count || 0);
      result.totalChunks += chunks;
      state.files[file.id] = {
        name: file.name,
        modifiedTime: file.modifiedTime,
        document_id: documentId,
        content_hash: hash,
        local_path: localPath,
        chunks_count: chunks,
        ingested_at: new Date().toISOString(),
      };
      result.ingested += 1;
      result.files.push({
        name: file.name,
        document_id: documentId,
        chunks_count: chunks,
        status: 'ingested',
      });
      if (onProgress) {
        onProgress({
          phase: 'done',
          file,
          index: i + 1,
          total: files.length,
          chunks,
          documentId,
        });
      }
    } catch (err) {
      result.failed += 1;
      const message = String(err.message || err);
      result.errors.push({ name: file.name, error: message });
      if (onProgress) {
        onProgress({ phase: 'error', file, index: i + 1, total: files.length, error: message });
      }
    }
  }

  return result;
}

module.exports = {
  SUPPORTED,
  EXT_BY_MIME,
  extractDriveResource,
  isDriveUrl,
  loadCredentials,
  getAccessToken,
  driveRequest,
  getFileMetadata,
  listFolderItems,
  listFolderFiles,
  resolveDriveFiles,
  safeFilename,
  downloadFile,
  toContainerPath,
  buildIngestPayload,
  ingestFile,
  syncDriveToRag,
};
