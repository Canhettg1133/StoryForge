import { ANALYSIS_CONFIG } from './analysisConfig.js';
import SessionClient from './sessionClient.js';
import { shouldContinueOutput, mergeOutputParts } from './outputChunker.js';
import { buildComprehensivePrompt } from './prompts/comprehensivePrompt.js';
import { countWords } from '../corpus/utils/textUtils.js';

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  throw createError('Đã hủy phân tích', 'ANALYSIS_CANCELLED');
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sumTokenUsage(parts = []) {
  const totals = {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
  };

  for (const part of parts) {
    totals.promptTokenCount += toNumber(part?.usageMetadata?.promptTokenCount, 0);
    totals.candidatesTokenCount += toNumber(part?.usageMetadata?.candidatesTokenCount, 0);
    totals.totalTokenCount += toNumber(part?.usageMetadata?.totalTokenCount, 0);
  }

  return totals;
}

export function buildCorpusSessionInput(chunks = [], maxWords = ANALYSIS_CONFIG.session.maxInputWords) {
  const safeMaxWords = Math.max(1000, Number(maxWords) || ANALYSIS_CONFIG.session.maxInputWords);
  const selectedChunks = [];
  let currentWords = 0;

  for (const chunk of chunks) {
    const text = String(chunk?.text || '').trim();
    if (!text) {
      continue;
    }

    const chunkWords = Math.max(0, Number(chunk?.wordCount) || countWords(text));

    if (selectedChunks.length > 0 && currentWords + chunkWords > safeMaxWords) {
      break;
    }

    selectedChunks.push({
      ...chunk,
      text,
      wordCount: chunkWords,
    });
    currentWords += chunkWords;
  }

  if (selectedChunks.length === 0) {
    throw createError('Corpus không có chunk văn bản để phân tích.', 'EMPTY_CORPUS_CHUNKS');
  }

  const combinedText = selectedChunks
    .map((chunk) => chunk.text)
    .join('\n\n')
    .trim();

  if (!combinedText) {
    throw createError('Văn bản corpus rỗng sau bước tiền xử lý.', 'EMPTY_CORPUS_TEXT');
  }

  return {
    text: combinedText,
    chunks: selectedChunks,
    wordCount: currentWords,
  };
}

export function buildCorpusSessionInputs(chunks = [], maxWords = ANALYSIS_CONFIG.session.maxInputWords) {
  const safeMaxWords = Math.max(1000, Number(maxWords) || ANALYSIS_CONFIG.session.maxInputWords);
  const normalizedChunks = [];

  for (const chunk of chunks) {
    const text = String(chunk?.text || '').trim();
    if (!text) {
      continue;
    }

    const chunkWords = Math.max(0, Number(chunk?.wordCount) || countWords(text));
    normalizedChunks.push({
      ...chunk,
      text,
      wordCount: chunkWords,
    });
  }

  if (!normalizedChunks.length) {
    throw createError('Corpus không có chunk văn bản để phân tích.', 'EMPTY_CORPUS_CHUNKS');
  }

  const sessions = [];
  let sessionChunks = [];
  let sessionWords = 0;

  const flushSession = () => {
    if (!sessionChunks.length) {
      return;
    }

    const text = sessionChunks
      .map((chunk) => chunk.text)
      .join('\n\n')
      .trim();

    if (!text) {
      return;
    }

    sessions.push({
      text,
      chunks: sessionChunks,
      wordCount: sessionWords,
    });

    sessionChunks = [];
    sessionWords = 0;
  };

  for (const chunk of normalizedChunks) {
    const chunkWords = Math.max(0, Number(chunk.wordCount) || countWords(chunk.text));
    const shouldFlush = (
      sessionChunks.length > 0
      && sessionWords + chunkWords > safeMaxWords
    );

    if (shouldFlush) {
      flushSession();
    }

    sessionChunks.push(chunk);
    sessionWords += chunkWords;
  }

  flushSession();

  if (!sessions.length) {
    throw createError('Văn bản corpus rỗng sau bước tiền xử lý.', 'EMPTY_CORPUS_TEXT');
  }

  return sessions;
}

export async function analyzeWithSession({
  text,
  layers,
  config,
  signal,
  onProgress = () => {},
  onPart = () => {},
}) {
  const sessionClient = new SessionClient({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    apiKeys: config.apiKeys,
    apiKeyCursorStart: config.apiKeyStartIndex,
    proxyUrl: config.proxyUrl,
    directUrl: config.directUrl,
    temperature: config.temperature,
    maxOutputTokens: ANALYSIS_CONFIG.session.maxOutputPerPart,
  });

  const maxParts = Math.max(1, Number(config.maxParts) || ANALYSIS_CONFIG.session.maxParts);
  const prompt = buildComprehensivePrompt({ layers });
  const partResults = [];

  try {
    throwIfAborted(signal);
    let index = 1;
    onProgress({
      phase: 'session_start',
      progress: 0.08,
      message: 'Bắt đầu session phân tích',
      part: index,
      totalParts: maxParts,
    });

    let response = await sessionClient.startSession(text, prompt, { signal });
    partResults.push(response);
    onPart({
      part: index,
      response,
      hasMore: shouldContinueOutput({
        text: response.text,
        finishReason: response.finishReason,
        maxOutputTokens: ANALYSIS_CONFIG.session.maxOutputPerPart,
      }),
    });

    let hasMore = shouldContinueOutput({
      text: response.text,
      finishReason: response.finishReason,
      maxOutputTokens: ANALYSIS_CONFIG.session.maxOutputPerPart,
    });

    while (hasMore && index < maxParts) {
      throwIfAborted(signal);
      index += 1;

      onProgress({
        phase: 'session_continue',
        progress: Math.min(0.95, 0.08 + (index / maxParts) * 0.84),
        message: `Đang lấy phần output ${index}`,
        part: index,
        totalParts: maxParts,
      });

      response = await sessionClient.continueSession(ANALYSIS_CONFIG.session.continuePrompt, {
        signal,
      });
      partResults.push(response);

      hasMore = shouldContinueOutput({
        text: response.text,
        finishReason: response.finishReason,
        maxOutputTokens: ANALYSIS_CONFIG.session.maxOutputPerPart,
      });

      onPart({
        part: index,
        response,
        hasMore,
      });
    }

    if (hasMore) {
      throw createError(
        `Output phân tích chưa đủ sau ${maxParts} phần. Hãy tăng maxParts và thử lại.`,
        'ANALYSIS_OUTPUT_INCOMPLETE',
      );
    }

    throwIfAborted(signal);
    const merged = mergeOutputParts(partResults.map((item) => item.text));

    onProgress({
      phase: 'merge',
      progress: 0.98,
      message: 'Đang ghép các phần phân tích',
      part: partResults.length,
      totalParts: partResults.length,
    });

    return {
      merged,
      parts: partResults,
      tokenUsage: sumTokenUsage(partResults),
    };
  } finally {
    sessionClient.endSession();
  }
}

export default {
  analyzeWithSession,
  buildCorpusSessionInputs,
  buildCorpusSessionInput,
};

