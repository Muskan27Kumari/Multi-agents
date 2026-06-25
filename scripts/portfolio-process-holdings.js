const cfg = $input.first().json;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const httpRequest = this.helpers.httpRequest.bind(this.helpers);

const holdings = cfg.holdings || [];
const finnhub = String(cfg.finnhub_api_key || '').trim();
const alphaKey = String(cfg.alpha_vantage_api_key || '').trim();
const marketaux = String(cfg.marketaux_api_key || '').trim();

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
  if (isOpenRouterKey(apiKey)) headers['X-Title'] = 'Portfolio Market Report';
  return headers;
}

function normalizeModel(model, apiKey) {
  const m = String(model || 'gpt-4o-mini').trim();
  if (isOpenRouterKey(apiKey)) {
    return m.includes('/') ? m : `openai/${m.replace(/^openai\//, '')}`;
  }
  return m.replace(/^openai\//, '');
}

const apiKey = cleanKey(cfg.openai_api_key || cfg.openrouter_api_key);
const primaryModel = normalizeModel(cfg.openai_model || cfg.openrouter_model || 'gpt-4o-mini', apiKey);
const fallbackModels = [primaryModel, 'gpt-4o-mini'].filter((m, i, arr) => m && arr.indexOf(m) === i);

const systemPrompt = 'You are a portfolio research analyst. Return strict JSON only with keys: signal (BUY|HOLD|SELL), confidence (0-100), summary, catalysts (array), risks (array), key_levels (object with support and resistance numbers), horizon (short|medium|long), action_note.';
const validSignals = new Set(['BUY', 'HOLD', 'SELL']);
const analyzed = [];
const runWarnings = [];

function httpStatus(err) {
  return err?.statusCode || err?.response?.statusCode || err?.cause?.statusCode || null;
}

function errDetail(err) {
  const body = err?.response?.body;
  if (body?.error?.message) return body.error.message;
  if (typeof body?.error === 'string') return body.error;
  return String(err?.message || err || 'unknown error');
}

function ruleBasedSignal(merged_data) {
  const md = merged_data.market_data || {};
  const pos = merged_data.position || {};
  const fund = merged_data.fundamentals || {};
  const change = Number(md.change_percent || 0);
  const pnlPct = Number(pos.unrealized_pnl_percent || 0);
  const pe = Number(fund.pe_ratio || 0);

  let score = 0;
  if (change > 1.5) score += 1;
  else if (change < -1.5) score -= 1;
  if (pnlPct > 15) score -= 1;
  else if (pnlPct < -10) score += 1;
  if (pe > 0 && pe < 25) score += 1;
  else if (pe > 40) score -= 1;

  let action = 'HOLD';
  if (score >= 2) action = 'BUY';
  else if (score <= -2) action = 'SELL';

  const headlines = (merged_data.news_earnings?.news?.headlines || [])
    .map((h) => h.title)
    .filter(Boolean)
    .slice(0, 3);

  return {
    signal: action,
    confidence: Math.min(75, 50 + Math.abs(score) * 8),
    summary: `Rule-based ${action}: daily move ${change.toFixed(2)}%, unrealized P&L ${pnlPct.toFixed(1)}%${pe ? `, P/E ${pe}` : ''}. AI unavailable — check OPENAI_API_KEY for full analysis.`,
    catalysts: headlines,
    risks: ['Rule-based signal only. Not investment advice.'],
    key_levels: {
      support: Number((md.low || md.price * 0.97).toFixed(2)),
      resistance: Number((md.high || md.price * 1.03).toFixed(2)),
    },
    horizon: 'short',
    action_note: action === 'BUY' ? 'Monitor for entry' : action === 'SELL' ? 'Consider trimming' : 'Hold and watch',
    _analysis_mode: 'rule_based_fallback',
  };
}

for (let i = 0; i < holdings.length; i++) {
  const holding = holdings[i];
  const symbol = holding.symbol;
  const shares = Number(holding.shares || 0);
  const avgCost = Number(holding.avg_cost || 0);

  if (i > 0) {
    await sleep(13000);
  }

  let quote = {};
  const quoteErrors = [];
  try {
    quote = await httpRequest({
      method: 'GET',
      url: 'https://finnhub.io/api/v1/quote',
      qs: { symbol, token: finnhub },
      json: true,
      timeout: 30000,
    });
  } catch (e) {
    quoteErrors.push(`finnhub_quote: ${e.message}`);
  }

  const price = Number(quote.c || 0);
  if (!price) {
    throw new Error(`Finnhub quote unavailable for ${symbol}: ${quoteErrors.join(' | ') || 'empty_quote'}`);
  }

  const market_data = {
    symbol,
    price,
    open: Number(quote.o || 0),
    high: Number(quote.h || 0),
    low: Number(quote.l || 0),
    previous_close: Number(quote.pc || 0),
    change_percent: Number(quote.dp || 0),
    vendor: 'finnhub',
    collected_at: new Date().toISOString(),
    errors: quoteErrors,
  };

  let fundamentalsRaw = {};
  const fundErrors = [];
  try {
    fundamentalsRaw = await httpRequest({
      method: 'GET',
      url: 'https://www.alphavantage.co/query',
      qs: { function: 'OVERVIEW', symbol, apikey: alphaKey },
      json: true,
      timeout: 30000,
    });
  } catch (e) {
    fundErrors.push(`alpha_overview: ${e.message}`);
  }

  if (fundamentalsRaw?.Note || fundamentalsRaw?.Information) {
    fundErrors.push(String(fundamentalsRaw.Note || fundamentalsRaw.Information));
  }

  const fundamentals = {
    symbol,
    name: fundamentalsRaw.Name || null,
    sector: fundamentalsRaw.Sector || null,
    industry: fundamentalsRaw.Industry || null,
    market_cap: fundamentalsRaw.MarketCapitalization || null,
    pe_ratio: fundamentalsRaw.PERatio || null,
    eps: fundamentalsRaw.EPS || null,
    dividend_yield: fundamentalsRaw.DividendYield || null,
    fifty_two_week_high: fundamentalsRaw['52WeekHigh'] || null,
    fifty_two_week_low: fundamentalsRaw['52WeekLow'] || null,
    analyst_target: fundamentalsRaw.AnalystTargetPrice || null,
    collected_at: new Date().toISOString(),
    vendor: 'alpha_vantage',
    errors: fundErrors,
  };

  const technical = {
    symbol,
    vendor: 'derived',
    indicators: {
      day_range_pct: market_data.previous_close
        ? Number((((market_data.high - market_data.low) / market_data.previous_close) * 100).toFixed(2))
        : null,
      change_percent: market_data.change_percent,
    },
    errors: [],
    collected_at: new Date().toISOString(),
  };

  const today = new Date();
  const fromDate = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const news = { headlines: [], errors: [] };
  const earnings = { events: [], errors: [] };

  if (marketaux) {
    try {
      const articles = await httpRequest({
        method: 'GET',
        url: 'https://api.marketaux.com/v1/news/all',
        qs: { symbols: symbol, filter_entities: true, language: 'en', limit: 5, api_token: marketaux },
        json: true,
        timeout: 30000,
      });
      news.headlines = (articles.data || []).slice(0, 5).map((a) => ({
        title: a.title,
        url: a.url,
        published_at: a.published_at,
        source: a.source,
      }));
    } catch (e) {
      news.errors.push(`marketaux: ${e.message}`);
    }
  }

  if (!news.headlines.length && finnhub) {
    try {
      const fromNews = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const toNews = today.toISOString().slice(0, 10);
      const companyNews = await httpRequest({
        method: 'GET',
        url: 'https://finnhub.io/api/v1/company-news',
        qs: { symbol, from: fromNews, to: toNews, token: finnhub },
        json: true,
        timeout: 30000,
      });
      news.headlines = (Array.isArray(companyNews) ? companyNews : []).slice(0, 5).map((a) => ({
        title: a.headline || a.title,
        url: a.url,
        published_at: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
        source: a.source,
      }));
      news.vendor = 'finnhub';
    } catch (e) {
      news.errors.push(`finnhub_news: ${e.message}`);
    }
  }

  try {
    const cal = await httpRequest({
      method: 'GET',
      url: 'https://finnhub.io/api/v1/calendar/earnings',
      qs: { from: fromDate, to: toDate, symbol, token: finnhub },
      json: true,
      timeout: 30000,
    });
    earnings.events = (cal.earningsCalendar || []).slice(0, 3).map((e) => ({
      date: e.date,
      eps_estimate: e.epsEstimate,
      revenue_estimate: e.revenueEstimate,
      hour: e.hour,
    }));
  } catch (e) {
    earnings.errors.push(`finnhub_earnings: ${e.message}`);
  }

  const news_earnings = { symbol, news, earnings, collected_at: new Date().toISOString() };

  const marketValue = shares > 0 && price > 0 ? Number((shares * price).toFixed(2)) : null;
  const costBasis = shares > 0 && avgCost > 0 ? Number((shares * avgCost).toFixed(2)) : null;
  const unrealizedPnl = marketValue != null && costBasis != null ? Number((marketValue - costBasis).toFixed(2)) : null;
  const unrealizedPct = costBasis > 0 && unrealizedPnl != null ? Number(((unrealizedPnl / costBasis) * 100).toFixed(2)) : null;

  const merged_data = {
    symbol,
    position: {
      shares,
      avg_cost: avgCost,
      market_value: marketValue,
      cost_basis: costBasis,
      unrealized_pnl: unrealizedPnl,
      unrealized_pnl_percent: unrealizedPct,
    },
    market_data,
    fundamentals,
    technical,
    news_earnings,
    merged_at: new Date().toISOString(),
  };

  const userPrompt = JSON.stringify({
    portfolio_name: cfg.portfolio_name,
    symbol,
    position: merged_data.position,
    market_data,
    fundamentals,
    technical,
    news_earnings,
  }, null, 2);

  let analysis;
  let ai_analysis;
  let usedAi = false;

  if (apiKey) {
    const aiErrors = [];
    for (const model of fallbackModels) {
      try {
        const response = await httpRequest({
          method: 'POST',
          url: chatCompletionsUrl(apiKey),
          headers: chatHeaders(apiKey),
          body: {
            model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          },
          json: true,
          timeout: 90000,
        });

        const raw = response.choices?.[0]?.message?.content;
        if (!raw) throw new Error(`AI returned empty content (model: ${model})`);

        try {
          analysis = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          throw new Error(`Failed to parse AI JSON (model: ${model})`);
        }

        ai_analysis = {
          ...analysis,
          model: response.model || model,
          usage: response.usage || null,
          analyzed_at: new Date().toISOString(),
          _analysis_mode: isOpenRouterKey(apiKey) ? 'openrouter' : 'openai',
        };
        usedAi = true;
        break;
      } catch (err) {
        const status = httpStatus(err);
        const detail = errDetail(err);
        aiErrors.push(`${model}${status ? ` (${status})` : ''}: ${detail}`);
        if (status === 402) break;
      }
    }

    if (!usedAi) {
      const detail = aiErrors.join(' | ') || 'AI request failed';
      runWarnings.push(`${symbol}: AI fallback — ${detail}`);
    }
  } else {
    runWarnings.push(`${symbol}: OPENAI_API_KEY not set — using rule-based signal`);
  }

  if (!usedAi) {
    analysis = ruleBasedSignal(merged_data);
    ai_analysis = {
      ...analysis,
      model: 'rule_based_fallback',
      analyzed_at: new Date().toISOString(),
    };
  }

  const signalAction = String(analysis.signal || 'HOLD').toUpperCase();
  const confidence = Math.max(0, Math.min(100, Number(analysis.confidence || 0)));
  if (!validSignals.has(signalAction)) {
    throw new Error(`Invalid signal for ${symbol}: ${analysis.signal}`);
  }

  analyzed.push({
    symbol,
    shares,
    avg_cost: avgCost,
    merged_data,
    signal: {
      symbol,
      action: signalAction,
      confidence,
      summary: analysis.summary || '',
      catalysts: analysis.catalysts || [],
      risks: analysis.risks || [],
      key_levels: analysis.key_levels || {},
      horizon: analysis.horizon || 'medium',
      action_note: analysis.action_note || '',
      extracted_at: new Date().toISOString(),
      analysis_mode: ai_analysis._analysis_mode || ai_analysis.model || 'unknown',
    },
    ai_analysis,
  });
}

const counts = analyzed.reduce((acc, h) => {
  const s = h.signal?.action || 'HOLD';
  acc[s] = (acc[s] || 0) + 1;
  return acc;
}, {});

const avgConfidence = Number((analyzed.reduce((s, h) => s + Number(h.signal?.confidence || 0), 0) / analyzed.length).toFixed(1));

return [{
  json: {
    run_id: cfg.run_id,
    triggered_at: cfg.triggered_at,
    portfolio_name: cfg.portfolio_name,
    holdings_count: analyzed.length,
    holdings: analyzed,
    portfolio_summary: {
      signal_counts: counts,
      average_confidence: avgConfidence,
      generated_at: new Date().toISOString(),
      warnings: runWarnings,
    },
    finnhub_api_key: cfg.finnhub_api_key,
    alpha_vantage_api_key: cfg.alpha_vantage_api_key,
    marketaux_api_key: cfg.marketaux_api_key,
    openai_api_key: cfg.openai_api_key,
    openai_model: cfg.openai_model,
    recipient_email: cfg.recipient_email,
    sender_email: cfg.sender_email,
    slack_bot_token: cfg.slack_bot_token,
    slack_channel: cfg.slack_channel,
    notify_email: cfg.notify_email,
    notify_slack: cfg.notify_slack,
    telegram_bot_token: cfg.telegram_bot_token,
    telegram_chat_id: cfg.telegram_chat_id,
    notify_telegram: cfg.notify_telegram,
  },
}];
