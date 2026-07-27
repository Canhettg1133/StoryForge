export const SUPREME_CHUNK_ERROR_CODES = Object.freeze({
  PROTECTED_OUTPUT_BLOCKED: 'PROTECTED_OUTPUT_BLOCKED',
  UNTRUSTED_INSTRUCTION_BLOCKED: 'UNTRUSTED_INSTRUCTION_BLOCKED',
  SUPREME_EMPTY_OUTPUT: 'SUPREME_EMPTY_OUTPUT',
});

export function getReusableSupremeChunkNote(chunk = {}) {
  if (String(chunk.ai_error_code || '').trim()) return '';
  return String(chunk.ai_notes || '').trim();
}

export function classifySupremeChunkResult(result = {}) {
  if (result.blocked === true) {
    return {
      note: '',
      errorCode: SUPREME_CHUNK_ERROR_CODES.PROTECTED_OUTPUT_BLOCKED,
    };
  }
  const skipped = Array.isArray(result.skippedAttachmentChunks)
    && result.skippedAttachmentChunks.length > 0;
  if (skipped) {
    return {
      note: '',
      errorCode: SUPREME_CHUNK_ERROR_CODES.UNTRUSTED_INSTRUCTION_BLOCKED,
    };
  }
  return {
    note: String(result.text || '').trim(),
    errorCode: '',
  };
}

export function classifySupremeMergeResult(result = {}) {
  const chunkOutcome = classifySupremeChunkResult(result);
  if (chunkOutcome.errorCode) {
    return {
      profileText: '',
      errorCode: chunkOutcome.errorCode,
    };
  }
  if (!chunkOutcome.note) {
    return {
      profileText: '',
      errorCode: SUPREME_CHUNK_ERROR_CODES.SUPREME_EMPTY_OUTPUT,
    };
  }
  return {
    profileText: chunkOutcome.note,
    errorCode: '',
  };
}
