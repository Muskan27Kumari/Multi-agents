'use strict';

const http = require('http');
const https = require('https');

function safeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const reqModule = isHttps ? https : http;

    const headers = {};
    if (options.headers) {
      for (const [key, val] of Object.entries(options.headers)) {
        headers[key.toLowerCase()] = val;
      }
    }

    const method = (options.method || 'GET').toUpperCase();
    let body = options.body || null;

    if (body && typeof body === 'object' && !(body instanceof Buffer)) {
      if (body.constructor && body.constructor.name === 'URLSearchParams') {
        body = body.toString();
        if (!headers['content-type']) {
          headers['content-type'] = 'application/x-www-form-urlencoded';
        }
      } else {
        body = JSON.stringify(body);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      }
    }

    if (body) {
      headers['content-length'] = Buffer.byteLength(body);
    }

    const reqOptions = {
      method,
      headers,
      signal: options.signal,
    };

    const req = reqModule.request(urlObj, reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: {
            get: (name) => res.headers[String(name).toLowerCase()] || null,
          },
          text: async () => buffer.toString('utf8'),
          json: async () => JSON.parse(buffer.toString('utf8')),
          arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.signal) {
      const onAbort = () => {
        req.destroy();
        const abortErr = new Error('The operation was aborted.');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener('abort', onAbort);
      }
    }

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

module.exports = { safeFetch };
