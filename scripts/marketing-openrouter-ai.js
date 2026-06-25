const brief = $input.first().json;
const httpRequest = this.helpers.httpRequest.bind(this.helpers);

function cleanKey(key) {
  return String(key || '').trim().replace(/^Bearer\s+/i, '');
}

function isOpenRouterKey(key) {
  return /^sk-or-/i.test(cleanKey(key));
}

function chatCompletionsUrl(apiKey) {
  return isOpenRouterKey(apiKey)
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
}

function chatHeaders(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (isOpenRouterKey(apiKey)) {
    headers['HTTP-Referer'] = brief.brand_website || 'https://n8n.io';
    headers['X-Title'] = 'Marketing Content Agent';
  }
  return headers;
}

function normalizeModel(model, apiKey) {
  const m = String(model || 'gpt-4o-mini').trim();
  if (isOpenRouterKey(apiKey)) {
    return m.includes('/') ? m : `openai/${m.replace(/^openai\//, '')}`;
  }
  return m.replace(/^openai\//, '');
}

let apiKey = cleanKey(brief.openai_api_key || brief.openrouter_api_key);

if (!apiKey || apiKey === 'PASTE_YOUR_OPENROUTER_KEY_HERE') {
  try {
    const cred = await this.getCredentials('httpHeaderAuth');
    const raw = String(cred.value || cred.headerValue || '').trim();
    apiKey = cleanKey(raw);
  } catch (e) {
    // credential not configured on this node
  }
}

const primaryModel = normalizeModel(
  brief.openai_model || brief.openrouter_model || 'gpt-4o-mini',
  apiKey
);
const fallbackModels = [primaryModel, 'gpt-4o-mini']
  .map((m) => normalizeModel(m, apiKey))
  .filter((m, i, arr) => m && arr.indexOf(m) === i);

function httpStatus(err) {
  return err?.statusCode || err?.response?.statusCode || null;
}

function errDetail(err) {
  const body = err?.response?.body;
  if (body?.error?.message) return body.error.message;
  if (typeof body?.error === 'string') return body.error;
  return String(err?.message || err || 'unknown error');
}

function buildTemplateContent(b) {
  const topic = String(b.topic || 'Marketing topic').trim();
  const brand = b.brand_name || 'Your Brand';
  const audience = b.audience || 'your audience';
  const cta = b.call_to_action || 'Learn more';
  const website = b.brand_website || '';

  return {
    blog: {
      title: `${topic} — Starter Guide for ${audience}`,
      meta_description: `Practical ideas on ${topic.toLowerCase()} for ${audience}.`,
      body_markdown: `## Introduction\n\n${topic} is a strong theme for teams that want clearer messaging and better engagement.\n\n## Three angles to explore\n\n1. **Pain first** — Name the problem ${audience} feels today.\n2. **Proof** — Share one example, lesson, or workflow ${brand} enables.\n3. **Action** — Close with a direct CTA: **${cta}**.\n\n## Suggested outline\n\n- Hook: why this topic matters now\n- Insight: one framework or checklist\n- CTA: ${cta}${website ? ` (${website})` : ''}\n\n_This is a template draft. Configure OPENAI_API_KEY for AI-polished copy._`,
    },
    linkedin: {
      post: `${topic}\n\nQuick framework we share with ${audience}:\n→ Name the pain\n→ Offer one useful insight\n→ Invite readers to ${cta}\n\nWhat's your take — what would you add?\n\n#marketing #content #B2B`,
      hashtags: ['#marketing', '#contentstrategy', '#B2B'],
    },
    twitter: {
      thread: [
        { tweet: 1, text: `${topic} — starter thread 🧵` },
        { tweet: 2, text: 'Mistake: leading with product specs instead of the customer problem.' },
        { tweet: 3, text: `Better: one insight + one example + one CTA (${cta}).` },
      ],
    },
    email: {
      subject_lines: [`Ideas: ${topic}`, `${brand} — ${topic}`],
      preview_text: `Starter copy on ${topic}`,
      body_html: `<p>Hi,</p><p>Here is draft messaging on <strong>${topic}</strong> for ${audience}.</p><p><a href="${website || '#'}">${cta}</a></p>`,
    },
    review_notes: [
      'Template draft generated without AI (API unavailable or missing key).',
    ],
  };
}

function templateResponse(b, reason) {
  return {
    choices: [{ message: { content: JSON.stringify(buildTemplateContent(b)) } }],
    model: 'template_fallback',
    _meta: {
      template_fallback: true,
      reason,
    },
  };
}

const systemPrompt = `You are an expert marketing content strategist for ${brief.brand_name}. Brand voice: ${brief.tone || 'professional and clear'}. Website: ${brief.brand_website || ''}. Generate multi-platform marketing content as a single JSON object. Only include platforms listed in the user request. Do not invent statistics or testimonials. Return valid JSON only with this structure: { "blog": { "title": "", "meta_description": "", "body_markdown": "" }, "linkedin": { "post": "", "hashtags": [] }, "twitter": { "thread": [{ "tweet": 1, "text": "" }] }, "email": { "subject_lines": [], "preview_text": "", "body_html": "" }, "review_notes": [] }`;

const userPrompt = `Campaign: ${brief.campaign_name}\nTopic: ${brief.topic}\nAudience: ${brief.audience}\nTone: ${brief.tone}\nPlatforms: ${(brief.platforms || []).join(', ')}\nKeywords: ${(brief.keywords || []).join(', ')}\nCTA: ${brief.call_to_action}\nGoal: ${brief.goal}\nContext: ${brief.context}`;

if (!apiKey) {
  return [{ json: templateResponse(brief, 'OPENAI_API_KEY not configured') }];
}

const errors = [];
for (const model of fallbackModels) {
  try {
    const response = await httpRequest({
      method: 'POST',
      url: chatCompletionsUrl(apiKey),
      headers: chatHeaders(apiKey),
      body: {
        model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      json: true,
      timeout: 120000,
    });
    return [{ json: response }];
  } catch (error) {
    const status = httpStatus(error);
    const detail = errDetail(error);
    errors.push(`${model}${status ? ` (${status})` : ''}: ${detail}`);
    if (status === 402) break;
  }
}

return [{ json: templateResponse(brief, errors.join(' | ') || 'AI request failed') }];
