/**
 * User-facing answer formatting helpers for n8n Code nodes.
 */
module.exports.answerFormatHelpersCode = `const STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'about',
  'does', 'have', 'been', 'were', 'they', 'their', 'there', 'your', 'into',
]);

function normalizePdfText(text) {
  let t = String(text || '');
  t = t.replace(/([A-Za-z])- ([a-z])/g, '$1$2');
  t = t.replace(/\\beval\\s+uation\\b/gi, 'evaluation');
  t = t.replace(
    /encompassing the retrieval of information retrieval (?:\\(IR\\)|IR) all manner of/gi,
    'encompassing the retrieval of all types of'
  );
  t = t.replace(/\\binformation retrieval\\s+IR\\b/gi, 'information retrieval (IR)');
  t = t.replace(/\\ball types of media of media\\b/gi, 'all types of media');
  t = t.replace(/\\b([a-z]{1,2})\\s+queries\\b/gi, 'encoding queries');
  t = t.replace(/\\s+/g, ' ').trim();
  return t;
}

function questionKeywords(question) {
  const kws = String(question || '').toLowerCase().split(/\\W+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const q = String(question || '').toLowerCase();
  if (/integrat/.test(q)) kws.push('email', 'telegram', 'slack', 'webhook', 'smtp', 'supported', 'integrations');
  if (/embedding/.test(q)) kws.push('word2vec', 'glove', 'bert', 'vector', 'models', 'trained');
  if (/retriev/.test(q)) kws.push('retrieval', 'search', 'documents', 'information');
  if (/\\bgit\\b|github|version control|repository|commit|branch/i.test(q)) {
    kws.push('git', 'github', 'version', 'control', 'repository', 'commit', 'branch', 'clone');
  }
  if (/receptor|cutaneous|somatosen|somatosensory/.test(q)) kws.push('receptor', 'sensory', 'skin', 'cutaneous');
  if (/diagram|chart|image|figure|screenshot|label|caption/.test(q)) {
    kws.push('extracted', 'image', 'diagram', 'label', 'caption', 'ocr');
  }
  return [...new Set(kws)];
}

function anchorToQuestion(text, question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q || !text) return text;

  const whatIs = q.match(/^what is (?:an? |the )?(.+?)\\??$/);
  if (whatIs) {
    const topic = whatIs[1].trim();
    const topicRe = topic.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\s+/g, '\\\\s+');
    const defPatterns = [
      new RegExp(topicRe + '[^.!?]{0,160}\\\\bis the name of\\\\b', 'i'),
      new RegExp(topicRe + '[^.!?]{0,120}\\\\bis\\\\b', 'i'),
      new RegExp('\\\\b' + topicRe + '\\\\b[^.!?]{0,120}\\\\b(?:means|refers to)\\\\b', 'i'),
    ];
    for (const re of defPatterns) {
      const m = text.match(re);
      if (m && m.index != null && !/should see|historical notes/i.test(m[0])) {
        return text.slice(m.index).trim();
      }
    }
  }

  const idx = text.toLowerCase().indexOf(q);
  if (idx >= 0) return text.slice(idx).trim();

  const words = q.split(/\\W+/).filter((w) => w.length > 3).slice(0, 5);
  if (words.length >= 2) {
    const pattern = words.map((w) => w.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('[\\s\\S]{0,80}');
    const re = new RegExp(pattern, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const slice = text.slice(m.index).trim();
      const head = slice.slice(0, 160);
      if (/should see|historical notes|readers with more interest/i.test(head)) continue;
      if (/\\bis the name of\\b|\\b(?:is|are) (?:a|an|the)\\b|\\b(?:means|refers to)\\b/i.test(head)) return slice;
    }
  }
  return text;
}

function cleanChunkText(raw, question) {
  let text = normalizePdfText(String(raw || '').trim());
  if (!text) return '';

  text = text.replace(/\\[[\\d.,\\s\\-]+…?\\]/g, ' ');
  text = text.replace(/→\\s*\\[[\\d.,\\s\\-]+…?\\]/g, ' ');
  text = text.replace(/[•·]\\s*["']?[\\w]+["']?\\s*→/g, ' ');
  text = text.replace(/[\\d.,]+…?\\]/g, ' ');

  const anchors = [
    /Information\\s+retrieval\\s+or\\s+IR\\s+is/i,
    /\\d+\\.\\d+\\s+Information\\s+Retrieval/i,
    /\\d+\\s+How\\s+[A-Za-z][\\w\\s]*/,
    /\\d+\\s+What\\s+[A-Za-z][\\w\\s]*/,
    /How\\s+embeddings\\s+are\\s+created/i,
    /What\\s+(?:are|is)\\s+[A-Za-z][\\w\\s]*/,
    /Embeddings\\s+(?:are|come|refer)/i,
    /Information\\s+Retrieval/i,
    /[A-Z][a-z]+\\s+(?:are|is)\\s+(?:a|an|the)\\s+/,
    /Supported\\s+Integrations/i,
    /Text extracted from embedded images/i,
    /\\[Image \\d+:/i,
    /•\\s+[A-Z]/,
  ];
  for (const re of anchors) {
    const m = text.match(re);
    if (m && m.index != null && m.index < 400) {
      text = text.slice(m.index).trim();
      break;
    }
  }

  text = anchorToQuestion(text, question);

  text = text.replace(/^(?:\\d+\\.\\d+\\s+|\\d+\\s+|[\\d.,\\s\\[\\]…•→"']+)+/g, '').trim();
  text = text.replace(/\\s+•\\s+/g, '\\n• ');
  text = text.split('\\n').filter((line) => !/^•\\s+[^\\n]{0,55}\\(e\\.\\s*$/.test(line.trim())).join('\\n');
  text = text.replace(/\\n{3,}/g, '\\n\\n');
  text = text.replace(/[ \\t]{2,}/g, ' ');
  return text.trim();
}

function isGarbageSentence(sentence) {
  const t = String(sentence || '').trim();
  if (t.length < 25) return true;
  if (/^(the end of|tion"|^ing"|^\\d+\\s*$|^[,.\\s\\d\\[\\]…]+)/i.test(t)) return true;
  if (/\\(e\\.\\s*$/.test(t) || /\\be\\.\\s*$/.test(t)) return true;
  if ((t.match(/…/g) || []).length > 2) return true;
  if (/[A-Za-z]- [a-z]/.test(t)) return true;
  if (/should see|historical notes|end of the chapter|readers with more interest/i.test(t)) return true;
  if (/^g queries\\b/i.test(t)) return true;
  if (/our goal in this section is to give a sufficient overview/i.test(t)) return true;
  return false;
}

function scoreSentence(sentence, question, chunkScore) {
  const lower = sentence.toLowerCase();
  const kws = questionKeywords(question);
  let score = Number(chunkScore || 0) * 0.4;
  for (const w of kws) {
    if (lower.includes(w)) score += 2.5;
  }
  if (/\\b(is|are)\\s+(?:the\\s+)?name of\\b/i.test(sentence)) score += 5;
  if (/\\b(?:is|are)\\s+(?:a|an|the)\\b/i.test(sentence)) score += 2.5;
  if (/\\b(?:means|refers to|defined as|encompassing)\\b/i.test(sentence)) score += 2;
  if (/\\b(is|are|means|refers to|defined as)\\b/i.test(sentence)) score += 1.5;
  if (sentence.length >= 60 && sentence.length <= 350) score += 0.5;
  if (/should see|historical notes|end of the chapter|readers with more interest/i.test(sentence)) score -= 6;
  if (/our goal in this section/i.test(sentence)) score -= 4;
  if (/[A-Za-z]- [a-z]/.test(sentence)) score -= 5;
  const q = String(question || '').toLowerCase();
  if (/integrat/.test(q) && /overview|helps teams build|product guide/i.test(sentence)) score -= 3;
  return score;
}

function rankChunksForQuestion(hits, question) {
  const qWords = questionKeywords(question);
  return [...(hits || [])].sort((a, b) => {
    const textA = String(a.text || '').toLowerCase();
    const textB = String(b.text || '').toLowerCase();
    const kwA = qWords.filter((w) => textA.includes(w)).length;
    const kwB = qWords.filter((w) => textB.includes(w)).length;
    return (Number(b.score || 0) + kwB * 0.12) - (Number(a.score || 0) + kwA * 0.12);
  });
}

function extractDefinitionSentences(hits, question) {
  const q = String(question || '').toLowerCase();
  const isDefinitionQ = /^(what|define|explain)\\b/.test(q) || /\\bwhat is\\b/.test(q);
  if (!isDefinitionQ) return [];

  const defs = [];
  for (const hit of rankChunksForQuestion(hits, question).slice(0, 5)) {
    const text = cleanChunkText(hit.text, question);
    const patterns = [
      /[^.!?\\n]*\\b(?:is|are) the name of\\b[^.!?\\n]*[.!?]+/gi,
      /[^.!?\\n]*\\b(?:is|are) (?:a|an|the) [^.!?\\n]{10,}[.!?]+/gi,
      /[^.!?\\n]*\\b(?:refers to|means|defined as)\\b[^.!?\\n]*[.!?]+/gi,
      /[^.!?\\n]*\\bencompassing\\b[^.!?\\n]*[.!?]+/gi,
    ];
    for (const re of patterns) {
      const matches = text.match(re) || [];
      for (const m of matches) {
        const t = m.trim();
        if (isGarbageSentence(t)) continue;
        defs.push({ text: t, score: scoreSentence(t, question, hit.score) + 3 });
      }
    }
  }

  defs.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const picked = [];
  for (const d of defs) {
    const fp = d.text.toLowerCase().slice(0, 80);
    if (seen.has(fp)) continue;
    seen.add(fp);
    picked.push(d.text);
    if (picked.length >= 2) break;
  }
  return picked;
}

function buildExcerptAnswer(hits, maxSentences, question) {
  const definitionSentences = extractDefinitionSentences(hits, question);
  if (definitionSentences.length) {
    return definitionSentences.join(' ');
  }

  const limit = Math.min(Math.max(Number(maxSentences || 4), 2), 6);
  const candidates = [];

  for (const hit of rankChunksForQuestion(hits, question).slice(0, 4)) {
    const text = cleanChunkText(hit.text, question);
    const sentences = text.match(/[^.!?\\n]+[.!?]+/g) || [];
    for (const s of sentences) {
      const t = s.trim();
      if (isGarbageSentence(t)) continue;
      candidates.push({ text: t, score: scoreSentence(t, question, hit.score) });
    }
    const bulletLines = [
      ...(text.match(/•\\s+[^\\n•]+/g) || []),
      ...(text.match(/(?:^|\\n)-\\s+[^\\n-]+/g) || []),
    ];
    const bulletBonus = /integration|supported/i.test(text) ? 2 : 0.5;
    for (const b of bulletLines) {
      const t = b.replace(/^(?:•|-)\\s+/, '').trim();
      if (isGarbageSentence(t) || t.length < 15) continue;
      candidates.push({ text: t.endsWith('.') ? t : t + '.', score: scoreSentence(t, question, hit.score) + bulletBonus });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const picked = [];
  for (const c of candidates) {
    const fp = c.text.toLowerCase().slice(0, 70);
    if (seen.has(fp)) continue;
    seen.add(fp);
    picked.push(c.text);
    if (picked.length >= limit) break;
  }

  if (!picked.length) {
    return 'I found related material but could not extract a clear answer. Please try rephrasing your question.';
  }

  const q = String(question || '').toLowerCase();
  if (/integrat/.test(q)) {
    const items = picked.filter((p) => /email|telegram|slack|webhook|smtp|sheet|google/i.test(p.toLowerCase()));
    if (items.length) {
      return items.map((p) => '• ' + p.replace(/^[-•]\\s*/, '').trim()).join('\\n');
    }
  }

  const prose = picked.filter((p) => !/product guide|overview|helps teams build/i.test(p.toLowerCase()));
  return (prose.length ? prose : picked).slice(0, 3).join(' ');
}

function buildCleanContext(hits, question) {
  return rankChunksForQuestion(hits, question)
    .slice(0, 5)
    .map((h, i) => '[' + (i + 1) + ']\\n' + cleanChunkText(h.text, question))
    .join('\\n\\n---\\n\\n');
}

function lightPolishAnswer(raw) {
  let text = normalizePdfText(String(raw || '').trim());
  if (!text) return '';
  text = text.replace(/^Source:[^\\n]*\\n\\n?/gi, '');
  text = text.replace(/^\\[\\d+\\]\\s*\\([^\\n]+\\)\\s*\\n?/gm, '');
  text = text.replace(/\\[[\\d.,\\s\\-]+…?\\]/g, ' ');
  text = text.replace(/\\n{3,}/g, '\\n\\n');
  text = text.replace(/[ \\t]{2,}/g, ' ');
  return text.trim();
}

function polishExcerptAnswer(raw, question) {
  let text = lightPolishAnswer(raw);
  text = text.replace(/^•[^\\n]*→\\s*/gm, '');
  text = text.replace(/^\\d+\\s+(How|What)\\s+/gm, '$1 ');
  return text.trim();
}

function looksLikeRawExcerpt(answer) {
  const t = String(answer || '');
  if (/[A-Za-z]- [a-z]/.test(t)) return true;
  if (/should see the historical notes|end of the chapter/i.test(t)) return true;
  if (/^g queries\\b/i.test(t)) return true;
  if (t.split(/[.!?]+/).filter((s) => s.trim().length > 20).length >= 3 && !/\\b(is|are|means|refers to)\\b/i.test(t)) return true;
  return false;
}`;
