const PROTECTED_THREAD_FIELDS = new Set([
  'canary',
  'ciphertext',
  'iv',
  'promptRevision',
  'prompt_revision',
  'systemPrompt',
  'system_prompt',
  'system_prompt_customized',
  'encryptionMetadata',
  'encryption_metadata',
  'encryptionKeyVersion',
  'encryption_key_version',
]);

function removeProtectedFields(value) {
  if (Array.isArray(value)) return value.map(removeProtectedFields);
  if (!value || typeof value !== 'object') return value;

  return Object.entries(value).reduce((result, [key, item]) => {
    if (!PROTECTED_THREAD_FIELDS.has(key)) {
      result[key] = removeProtectedFields(item);
    }
    return result;
  }, {});
}

export function normalizeSupremeThreadForPersistence(thread = {}) {
  if (thread?.chat_mode !== 'supreme') return { ...thread };
  return {
    ...removeProtectedFields(thread),
    chat_mode: 'supreme',
    system_prompt: '',
    system_prompt_customized: false,
  };
}

export function sanitizeSupremeThreadExport(thread = {}) {
  return normalizeSupremeThreadForPersistence(thread);
}
