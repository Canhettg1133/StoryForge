function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonCandidate(text = '') {
  const source = String(text || '').trim();
  if (!source) {
    return '';
  }

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return '';
  }

  return source.slice(start, end + 1);
}

function mergeArrays(left = [], right = []) {
  const result = [...left];

  for (const item of right) {
    if (item == null) {
      continue;
    }

    const serialized = JSON.stringify(item);
    const exists = result.some((existing) => JSON.stringify(existing) === serialized);
    if (!exists) {
      result.push(item);
    }
  }

  return result;
}

function deepMerge(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return mergeArrays(left, right);
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    const output = {};

    for (const key of keys) {
      if (!(key in left)) {
        output[key] = right[key];
        continue;
      }

      if (!(key in right)) {
        output[key] = left[key];
        continue;
      }

      output[key] = deepMerge(left[key], right[key]);
    }

    return output;
  }

  return right === undefined ? left : right;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeParsedPart(part, index) {
  const parsed = safeJsonParse(String(part || '').trim())
    || safeJsonParse(extractJsonCandidate(part));

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (!parsed.meta || typeof parsed.meta !== 'object') {
    parsed.meta = {};
  }

  if (parsed.meta.part == null) {
    parsed.meta.part = index + 1;
  }

  return parsed;
}

export function shouldContinueOutput({ text, finishReason, maxOutputTokens = 65536 }) {
  const normalizedReason = String(finishReason || '').toLowerCase();
  const hasLengthReason = normalizedReason.includes('length') || normalizedReason.includes('max');

  const parsed = normalizeParsedPart(text, 0);
  let parsedHasMore = null;
  let parsedComplete = null;

  if (parsed) {
    parsedHasMore = parsed?.meta?.hasMore === true || parsed?.hasMore === true;
    parsedComplete = parsed?.meta?.complete === false || parsed?.complete === false;
  }

  const textLen = String(text || '').length;
  const lengthFallback = textLen >= Math.max(20000, Math.floor(maxOutputTokens * 0.4));
  const result = hasLengthReason || parsedHasMore || parsedComplete || lengthFallback;

  // #region agent log
  fetch('http://127.0.0.1:7318/ingest/696724e1-b2c9-4252-acee-7b5a42d39699',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c624c'},body:JSON.stringify({sessionId:'8c624c',location:'outputChunker.js:shouldContinueOutput',message:'shouldContinueOutput result',data:{hasLengthReason,parsedHasMore,parsedComplete,lengthFallback,textLen,result,finishReason},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion

  return result;
}

export function mergeOutputParts(parts = []) {
  const normalized = parts
    .map((part, index) => normalizeParsedPart(part, index))
    .filter(Boolean);

  // #region agent log
  fetch('http://127.0.0.1:7318/ingest/696724e1-b2c9-4252-acee-7b5a42d39699',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c624c'},body:JSON.stringify({sessionId:'8c624c',location:'outputChunker.js:mergeOutputParts',message:'mergeOutputParts entry',data:{totalParts:parts.length,normalizedCount:normalized.length,part0Length:String(parts[0]||'').length,part0First100:(String(parts[0]||'')).slice(0,100)},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion

  if (normalized.length > 0) {
    const merged = normalized.reduce((acc, current) => deepMerge(acc, current), {});

    if (!merged.meta || typeof merged.meta !== 'object') {
      merged.meta = {};
    }

    merged.meta.part = normalized.length;
    merged.meta.hasMore = false;
    merged.meta.complete = true;

    // #region agent log
    fetch('http://127.0.0.1:7318/ingest/696724e1-b2c9-4252-acee-7b5a42d39699',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c624c'},body:JSON.stringify({sessionId:'8c624c',location:'outputChunker.js:mergeOutputParts',message:'mergeOutputParts success',data:{layers:Object.keys(merged).filter(k=>k!=='meta'),normalizedCount:normalized.length},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

    return merged;
  }

  const combinedRaw = parts.map((part) => String(part || '').trim()).join('\n');
  const parsedCombined = safeJsonParse(extractJsonCandidate(combinedRaw));

  if (parsedCombined && typeof parsedCombined === 'object') {
    // #region agent log
    fetch('http://127.0.0.1:7318/ingest/696724e1-b2c9-4252-acee-7b5a42d39699',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8c624c'},body:JSON.stringify({sessionId:'8c624c',location:'outputChunker.js:mergeOutputParts',message:'mergeOutputParts fallback success',data:{layers:Object.keys(parsedCombined).filter(k=>k!=='meta')},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    return parsedCombined;
  }

  const error = new Error('Unable to merge analysis output into valid JSON.');
  error.code = 'INVALID_ANALYSIS_OUTPUT';
  throw error;
}

export function splitLayerResults(result = {}) {
  return {
    resultL1: result?.structural ? JSON.stringify(result.structural) : null,
    resultL2: result?.events ? JSON.stringify(result.events) : null,
    resultL3: result?.worldbuilding ? JSON.stringify(result.worldbuilding) : null,
    resultL4: result?.characters ? JSON.stringify(result.characters) : null,
    resultL5: result?.relationships ? JSON.stringify(result.relationships) : null,
    resultL6: result?.craft ? JSON.stringify(result.craft) : null,
  };
}

export function parseJsonField(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}