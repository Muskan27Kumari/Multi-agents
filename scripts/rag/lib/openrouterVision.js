/**
 * OpenRouter vision helpers for PDF embedded-image OCR + analysis (n8n Code nodes).
 */
module.exports.openRouterVisionHelpersCode = `function cleanKey(key) {
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

function normalizeVisionModel(model, apiKey) {
  const m = String(model || $env.OCR_VISION_MODEL || $env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  if (isOpenRouterKey(apiKey)) {
    return m.includes('/') ? m : 'openai/' + m.replace(/^openai\\//, '');
  }
  return m.replace(/^openai\\//, '');
}

async function getOpenRouterKey(payload) {
  const preferOpenAI = String($env.AI_PROVIDER || 'openai').toLowerCase() === 'openai';
  let apiKey = '';
  if (preferOpenAI) {
    apiKey = cleanKey(payload.openai_api_key || $env.OPENAI_API_KEY || '');
    if (apiKey && !isOpenRouterKey(apiKey)) return apiKey;
  }
  apiKey = cleanKey(payload.openrouter_api_key || payload.openai_api_key);
  if (!apiKey) {
    try {
      const cred = await this.getCredentials('httpHeaderAuth');
      apiKey = cleanKey(cred.value || cred.headerValue);
    } catch (e) {}
  }
  if (!apiKey) apiKey = cleanKey($env.OPENAI_API_KEY || $env.OPENROUTER_API_KEY || '');
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY for PDF image analysis.');
  return apiKey;
}`;

module.exports.ocrPdfImagesCode = `${module.exports.openRouterVisionHelpersCode}

function extractEmbeddedImages(buffer, minBytes) {
  const images = [];
  const seen = new Set();

  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) {
      let end = i + 3;
      while (end < buffer.length - 1) {
        if (buffer[end] === 0xff && buffer[end + 1] === 0xd9) {
          end += 2;
          break;
        }
        end++;
      }
      const slice = buffer.slice(i, end);
      const key = 'jpeg:' + slice.length + ':' + slice[10];
      if (slice.length >= minBytes && !seen.has(key)) {
        seen.add(key);
        images.push({ mimeType: 'image/jpeg', data: slice, label: 'jpeg_' + (images.length + 1) });
      }
      i = end;
    }
  }

  for (let i = 0; i < buffer.length - 8; i++) {
    if (
      buffer[i] === 0x89 && buffer[i + 1] === 0x50 && buffer[i + 2] === 0x4e &&
      buffer[i + 3] === 0x47 && buffer[i + 4] === 0x0d && buffer[i + 5] === 0x0a
    ) {
      let end = i + 8;
      while (end < buffer.length - 8) {
        if (
          buffer[end] === 0x49 && buffer[end + 1] === 0x45 && buffer[end + 2] === 0x4e &&
          buffer[end + 3] === 0x44 && buffer[end + 4] === 0xae && buffer[end + 5] === 0x42 &&
          buffer[end + 6] === 0x60 && buffer[end + 7] === 0x82
        ) {
          end += 8;
          break;
        }
        end++;
      }
      const slice = buffer.slice(i, end);
      const key = 'png:' + slice.length;
      if (slice.length >= minBytes && !seen.has(key)) {
        seen.add(key);
        images.push({ mimeType: 'image/png', data: slice, label: 'png_' + (images.length + 1) });
      }
      i = end;
    }
  }

  return images;
}

function parseImageAnalysis(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ocr: '', visual: '', combined: '' };

  const ocrMatch = text.match(/EXTRACTED_TEXT:\\s*([\\s\\S]*?)(?:\\nVISUAL_SUMMARY:|$)/i);
  const visualMatch = text.match(/VISUAL_SUMMARY:\\s*([\\s\\S]*)/i);
  let ocr = String(ocrMatch?.[1] || '').trim();
  if (/^none\\.?$/i.test(ocr)) ocr = '';

  let visual = String(visualMatch?.[1] || '').trim();
  if (!ocr && !visual) {
    return { ocr: text, visual: '', combined: text };
  }
  const combined = [ocr, visual].filter(Boolean).join('\\n\\n');
  return { ocr, visual, combined };
}

async function analyzeImage(apiKey, model, image, index, total, maxTokens) {
  const b64 = image.data.toString('base64');
  const response = await this.helpers.httpRequest({
    method: 'POST',
    url: chatCompletionsUrl(apiKey),
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'X-Title': 'RAG Knowledge Agent Image OCR',
    },
    body: {
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze PDF image ' + index + '/' + total + ' for a searchable knowledge base.\\n\\n'
              + 'Reply in exactly this format:\\n\\n'
              + 'EXTRACTED_TEXT:\\n'
              + '- [List EVERY piece of visible text verbatim: titles, headings, labels, captions, table cells, code, UI text, legends, axis labels, annotations, numbers. One line per item with "- " prefix.]\\n'
              + '- [If there is no readable text, write "none"]\\n\\n'
              + 'VISUAL_SUMMARY:\\n'
              + '[1-3 sentences: image type (chart/diagram/table/screenshot/photo), layout, and what the image shows. Include relationships between labeled elements.]',
          },
          {
            type: 'image_url',
            image_url: { url: 'data:' + image.mimeType + ';base64,' + b64 },
          },
        ],
      }],
    },
    json: true,
    timeout: 120000,
  });
  return parseImageAnalysis(String(response.choices?.[0]?.message?.content || '').trim());
}

const ctx = $input.first().json;
const enableImageAnalysis = ctx.enable_pdf_image_analysis !== false && ctx.enable_pdf_ocr !== false;

if (!enableImageAnalysis) {
  return [{
    json: {
      ...ctx,
      pdf_image_ocr_text: '',
      pdf_image_description_text: '',
      pdf_image_analysis_text: '',
      pdf_images_detected: 0,
      pdf_images_ocrd: 0,
      pdf_images_described: 0,
      pdf_image_analysis_failures: 0,
      pdf_image_analysis_errors: [],
      ocr_skipped: true,
    },
  }];
}

const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
const minBytes = Math.max(Number(ctx.pdf_ocr_min_image_bytes || 2048), 512);
const maxImages = Math.min(Math.max(Number(ctx.max_pdf_ocr_images || 25), 1), 50);
const maxTokens = Math.min(Math.max(Number(ctx.pdf_ocr_max_tokens || 700), 150), 1500);
const model = String(ctx.ocr_vision_model || $env.OCR_VISION_MODEL || ctx.openrouter_model || $env.OPENROUTER_MODEL || '').trim();

const images = extractEmbeddedImages(buffer, minBytes).slice(0, maxImages);
const apiKey = await getOpenRouterKey.call(this, ctx);

const ocrParts = [];
const visualParts = [];
const errors = [];
let ocrd = 0;
let described = 0;

for (let i = 0; i < images.length; i++) {
  try {
    const { ocr, visual, combined } = await analyzeImage.call(
      this, apiKey, model, images[i], i + 1, images.length, maxTokens
    );
    if (ocr) {
      ocrParts.push('[Image ' + (i + 1) + ': ' + images[i].label + ']\\n' + ocr);
      ocrd++;
    }
    if (visual) {
      visualParts.push('[Image ' + (i + 1) + ': ' + images[i].label + ']\\n' + visual);
    }
    if (combined) described++;
  } catch (err) {
    errors.push({
      image: images[i].label,
      error: String(err.message || err).slice(0, 200),
    });
  }
}

const imageOcrText = ocrParts.join('\\n\\n');
const imageDescriptionText = visualParts.join('\\n\\n');
const imageAnalysisText = [imageOcrText, imageDescriptionText].filter(Boolean).join('\\n\\n');

return [{
  json: {
    ...ctx,
    pdf_image_ocr_text: imageOcrText,
    pdf_image_description_text: imageDescriptionText,
    pdf_image_analysis_text: imageAnalysisText,
    pdf_images_detected: images.length,
    pdf_images_ocrd: ocrd,
    pdf_images_described: described,
    pdf_image_analysis_failures: errors.length,
    pdf_image_analysis_errors: errors,
    ocr_vision_model: model,
    ocr_skipped: false,
  },
}];`;
