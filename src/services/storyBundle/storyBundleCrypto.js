const ENCRYPTED_MAGIC = new TextEncoder().encode('SFORGE1E');
const CRYPTO_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = 8 + 1 + 4 + SALT_BYTES + IV_BYTES + 4;

function makeError() {
  const error = new Error('Không thể mở file được bảo vệ. Mật khẩu không đúng hoặc file đã bị thay đổi.');
  error.code = 'STORY_BUNDLE_DECRYPT_FAILED';
  return error;
}

function getCrypto() {
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.subtle || typeof webCrypto.getRandomValues !== 'function') {
    const error = new Error('Trình duyệt này không hỗ trợ Web Crypto.');
    error.code = 'STORY_BUNDLE_CRYPTO_UNAVAILABLE';
    throw error;
  }
  return webCrypto;
}

function hasMagic(bytes) {
  return bytes.length >= ENCRYPTED_MAGIC.length
    && ENCRYPTED_MAGIC.every((value, index) => bytes[index] === value);
}

async function deriveKey(password, salt, usages) {
  const webCrypto = getCrypto();
  const material = await webCrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return webCrypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: PBKDF2_ITERATIONS,
  }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

function buildHeader(salt, iv, ciphertextLength) {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(ENCRYPTED_MAGIC, 0);
  const view = new DataView(header.buffer);
  view.setUint8(8, CRYPTO_VERSION);
  view.setUint32(9, PBKDF2_ITERATIONS, false);
  header.set(salt, 13);
  header.set(iv, 13 + SALT_BYTES);
  view.setUint32(13 + SALT_BYTES + IV_BYTES, ciphertextLength, false);
  return header;
}

export function isEncryptedStoryBundle(bytes) {
  return hasMagic(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0));
}

export function isStoryBundleCryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle && typeof globalThis.crypto?.getRandomValues === 'function');
}

export async function encryptStoryBundle(plainBytes, password) {
  const normalizedPassword = String(password || '');
  if (normalizedPassword.length < 12) {
    const error = new Error('Mật khẩu bảo vệ phải có ít nhất 12 ký tự.');
    error.code = 'STORY_BUNDLE_PASSWORD_TOO_SHORT';
    throw error;
  }
  const webCrypto = getCrypto();
  const salt = webCrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = webCrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const expectedCiphertextLength = plainBytes.byteLength + 16;
  const header = buildHeader(salt, iv, expectedCiphertextLength);
  const key = await deriveKey(normalizedPassword, salt, ['encrypt']);
  const encrypted = await webCrypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: header,
    tagLength: 128,
  }, key, plainBytes);
  const ciphertext = new Uint8Array(encrypted);
  const output = new Uint8Array(header.length + ciphertext.length);
  output.set(header, 0);
  output.set(ciphertext, header.length);
  return output;
}

export async function decryptStoryBundle(encryptedBytes, password) {
  try {
    const bytes = encryptedBytes instanceof Uint8Array ? encryptedBytes : new Uint8Array(encryptedBytes);
    if (!hasMagic(bytes) || bytes.length < HEADER_BYTES + 16) throw makeError();
    const header = bytes.slice(0, HEADER_BYTES);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const version = view.getUint8(8);
    const iterations = view.getUint32(9, false);
    const expectedLength = view.getUint32(13 + SALT_BYTES + IV_BYTES, false);
    if (version !== CRYPTO_VERSION || iterations !== PBKDF2_ITERATIONS) throw makeError();
    const ciphertext = bytes.slice(HEADER_BYTES);
    if (ciphertext.length !== expectedLength) throw makeError();
    const salt = header.slice(13, 13 + SALT_BYTES);
    const iv = header.slice(13 + SALT_BYTES, 13 + SALT_BYTES + IV_BYTES);
    const key = await deriveKey(String(password || ''), salt, ['decrypt']);
    const decrypted = await getCrypto().subtle.decrypt({
      name: 'AES-GCM',
      iv,
      additionalData: header,
      tagLength: 128,
    }, key, ciphertext);
    return new Uint8Array(decrypted);
  } catch (error) {
    if (error?.code === 'STORY_BUNDLE_CRYPTO_UNAVAILABLE') throw error;
    throw makeError();
  }
}

export const STORY_BUNDLE_CRYPTO = Object.freeze({
  magic: 'SFORGE1E',
  version: CRYPTO_VERSION,
  iterations: PBKDF2_ITERATIONS,
  saltBytes: SALT_BYTES,
  ivBytes: IV_BYTES,
  headerBytes: HEADER_BYTES,
});
