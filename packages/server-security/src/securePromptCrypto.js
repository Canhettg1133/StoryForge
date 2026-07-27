const KEY_BYTES = 32;
const IV_BYTES = 12;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  let binary;
  try {
    binary = atob(String(value || '').trim());
  } catch {
    throw new Error('SUPREME_PROMPT_KEY_INVALID');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toKeyBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return base64ToBytes(value);
}

function buildAdditionalData({ promptKey, versionId, keyVersion }) {
  return new TextEncoder().encode(JSON.stringify({
    promptKey: String(promptKey || ''),
    versionId: String(versionId || ''),
    keyVersion: Number(keyVersion || 0),
  }));
}

async function importAesKey(key, usages) {
  const bytes = toKeyBytes(key);
  if (bytes.byteLength !== KEY_BYTES) throw new Error('SUPREME_PROMPT_KEY_INVALID');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usages);
}

export function parseSecurePromptKey(value) {
  const bytes = toKeyBytes(value);
  if (bytes.byteLength !== KEY_BYTES) throw new Error('SUPREME_PROMPT_KEY_INVALID');
  return bytes;
}

export async function encryptSecurePrompt({
  plaintext,
  key,
  promptKey,
  versionId,
  keyVersion,
}) {
  const content = String(plaintext ?? '');
  if (!content || content.length > 60000) throw new Error('SUPREME_PROMPT_CONTENT_INVALID');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await importAesKey(key, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: buildAdditionalData({ promptKey, versionId, keyVersion }),
    tagLength: 128,
  }, cryptoKey, new TextEncoder().encode(content));
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptSecurePrompt({
  ciphertext,
  iv,
  key,
  promptKey,
  versionId,
  keyVersion,
}) {
  const ivBytes = base64ToBytes(iv);
  if (ivBytes.byteLength !== IV_BYTES) throw new Error('SUPREME_PROMPT_IV_INVALID');
  const ciphertextBytes = base64ToBytes(ciphertext);
  const cryptoKey = await importAesKey(key, ['decrypt']);
  try {
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: buildAdditionalData({ promptKey, versionId, keyVersion }),
      tagLength: 128,
    }, cryptoKey, ciphertextBytes);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('SUPREME_PROMPT_DECRYPT_FAILED');
  }
}

export function getSecurePromptKey(env = {}, keyVersion) {
  const version = Number(keyVersion || env.SUPREME_PROMPT_ACTIVE_KEY_VERSION || 0);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('SUPREME_PROMPT_KEY_VERSION_INVALID');
  }
  return {
    key: parseSecurePromptKey(env[`SUPREME_PROMPT_ENCRYPTION_KEY_V${version}`]),
    keyVersion: version,
  };
}
