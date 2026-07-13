import JSZip from 'jszip';
import db from '../db/database.js';
import {
  buildProjectSnapshot,
  importProjectSnapshot,
  stableStringify,
} from '../db/projectSnapshot.js';
import { sanitizeSnapshotHtml } from './htmlSanitizer.js';
import {
  decryptStoryBundle,
  encryptStoryBundle,
  isEncryptedStoryBundle,
  isStoryBundleCryptoAvailable,
} from './storyBundleCrypto.js';
import {
  STORY_BUNDLE_LIMITS,
  inspectZipCentralDirectory,
  makeStoryBundleError,
  parseBoundedJson,
  validateBundlePath,
  validateImageMagic,
} from './storyBundleSafety.js';
import { stageLabBundle } from './labBundle.js';
import { sha256HexBytes } from './storyBundleHash.js';

export const STORY_BUNDLE_MIME = 'application/vnd.storyforge.bundle';
export const STORY_BUNDLE_EXTENSION = '.storyforge';
export const STORY_BUNDLE_FORMAT_VERSION = 1;

const PROJECT_SECTION_KEYS = Object.freeze([
  'project', 'chapters', 'scenes', 'characters', 'characterStates', 'relationships',
  'locations', 'objects', 'plotThreads', 'threadBeats', 'timelineEvents', 'stylePacks',
  'voicePacks', 'revisions', 'qaReports', 'worldTerms', 'taboos', 'chapterMeta',
  'factions', 'macro_arcs', 'arcs', 'project_assets',
]);
const CANON_SECTION_KEYS = Object.freeze([
  'canonFacts', 'story_events', 'entity_state_current', 'plot_thread_state',
  'validator_reports', 'memory_evidence', 'chapter_revisions', 'chapter_commits',
  'chapter_snapshots', 'item_state_current', 'relationship_state_current',
  'canon_purge_archives', 'entity_resolution_candidates', 'canon_pack', '_warnings',
]);
const ANALYSIS_SECTION_KEYS = Object.freeze([
  'suggestions', 'entityTimeline', 'linked_events', 'project_analysis_snapshots',
]);

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    return sha256HexBytes(bytes);
  }
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function inputToBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input?.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer());
  throw makeStoryBundleError('STORY_BUNDLE_FILE_INVALID', 'Không đọc được file StoryForge.');
}

function pickSection(snapshot, keys) {
  return keys.reduce((section, key) => {
    if (key in snapshot) section[key] = clone(snapshot[key]);
    return section;
  }, {});
}

function dataUrlToBytes(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/iu);
  if (!match) return null;
  const binary = atob(match[2].replace(/\s+/gu, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1].toLowerCase(), bytes };
}

function bytesToDataUrl(bytes, mime) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function extensionForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'text/plain') return 'txt';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

function addBinaryAsset(files, path, parsed, warnings) {
  const limit = parsed.mime.startsWith('image/')
    ? STORY_BUNDLE_LIMITS.imageBytes
    : STORY_BUNDLE_LIMITS.assetBytes;
  if (parsed.bytes.length > limit) {
    throw makeStoryBundleError('STORY_BUNDLE_ASSET_TOO_LARGE', `Asset ${path} vượt giới hạn cho phép.`);
  }
  if (parsed.mime.startsWith('image/') && !validateImageMagic(parsed.bytes, parsed.mime)) {
    warnings.push({ code: 'ASSET_IMAGE_SIGNATURE_INVALID', path });
    return false;
  }
  files.set(path, { bytes: parsed.bytes, mime: parsed.mime });
  return true;
}

function extractProjectAssets(projectSection, files, warnings) {
  for (const asset of projectSection.project_assets || []) {
    for (const [field, suffix] of [['data_url', 'data'], ['thumbnail_data_url', 'thumbnail']]) {
      const value = String(asset[field] || '').trim();
      const parsed = dataUrlToBytes(value);
      if (parsed) {
        const path = `assets/project/${asset.id}-${suffix}.${extensionForMime(parsed.mime)}`;
        if (addBinaryAsset(files, path, parsed, warnings)) {
          asset[`_bundle_${field}_entry`] = path;
        }
        asset[field] = '';
        if (Number(projectSection.project?.cover_asset_id) === Number(asset.id) && !asset[`_bundle_${field}_entry`]) {
          projectSection.project.cover_asset_id = 0;
          projectSection.project.cover_thumbnail_data_url = '';
        }
      } else if (/^https?:\/\//iu.test(value)) {
        warnings.push({ code: 'REMOTE_PROJECT_ASSET_DISABLED', assetId: asset.id, field });
        asset[`_bundle_remote_${field}`] = value;
        asset[field] = '';
        if (Number(projectSection.project?.cover_asset_id) === Number(asset.id)) {
          projectSection.project.cover_asset_id = 0;
          projectSection.project.cover_thumbnail_data_url = '';
        }
      }
    }
  }
  if (projectSection.project) projectSection.project.cover_thumbnail_data_url = '';
}

function extractChatAssets(chats, files, warnings) {
  for (const attachment of chats.attachments || []) {
    const value = String(attachment.data_url || '').trim();
    const parsed = dataUrlToBytes(value);
    if (parsed) {
      const path = `assets/chat/${attachment.id}.${extensionForMime(parsed.mime)}`;
      if (addBinaryAsset(files, path, parsed, warnings)) {
        attachment._bundle_data_url_entry = path;
      }
      attachment.data_url = '';
    } else if (/^https?:\/\//iu.test(value)) {
      warnings.push({ code: 'REMOTE_CHAT_ASSET_DISABLED', attachmentId: attachment.id });
      attachment._bundle_remote_data_url = value;
      attachment.data_url = '';
    }
  }
}

function countRecords(section) {
  return Object.entries(section || {}).reduce((counts, [key, value]) => {
    if (Array.isArray(value)) counts[key] = value.length;
    else if (value && typeof value === 'object' && !key.startsWith('_')) counts[key] = 1;
    return counts;
  }, {});
}

async function collectProjectChats(projectId) {
  const threads = await db.ai_chat_threads.where('project_id').equals(projectId).sortBy('created_at');
  const threadIds = threads.map((thread) => thread.id);
  if (threadIds.length === 0) {
    return { threads: [], messages: [], attachments: [], attachment_chunks: [], message_attachments: [] };
  }
  const [messages, attachments] = await Promise.all([
    db.ai_chat_messages.where('thread_id').anyOf(threadIds).sortBy('created_at'),
    db.ai_chat_attachments.where('thread_id').anyOf(threadIds).toArray(),
  ]);
  const attachmentIds = attachments.map((attachment) => attachment.id);
  const messageIds = messages.map((message) => message.id);
  const [attachmentChunks, byAttachment, byMessage] = attachmentIds.length > 0
    ? await Promise.all([
      db.ai_chat_attachment_chunks.where('attachment_id').anyOf(attachmentIds).toArray(),
      db.ai_chat_message_attachments.where('attachment_id').anyOf(attachmentIds).toArray(),
      messageIds.length > 0
        ? db.ai_chat_message_attachments.where('message_id').anyOf(messageIds).toArray()
        : Promise.resolve([]),
    ])
    : [[], [], []];
  const links = new Map([...byAttachment, ...byMessage].map((row) => [row.id, row]));
  return {
    threads: clone(threads),
    messages: clone(messages),
    attachments: clone(attachments),
    attachment_chunks: clone(attachmentChunks),
    message_attachments: clone([...links.values()]),
  };
}

async function collectFullLab(projectId) {
  const { default: labLiteDb } = await import('../labLite/labLiteDb.js');
  const normalizedProjectId = String(projectId);
  const corpuses = (await labLiteDb.corpuses.toArray())
    .filter((corpus) => String(corpus.projectId || '') === normalizedProjectId);
  const corpusIds = corpuses.map((corpus) => corpus.id);
  if (corpusIds.length === 0) return null;
  const byCorpus = async (table) => labLiteDb[table].where('corpusId').anyOf(corpusIds).toArray();
  const [chapters, scoutResults, arcs, deepAnalysisRuns, deepAnalysisItems, canonPacks, ingestBatches, analysisCache, chapterCoverage] = await Promise.all([
    byCorpus('chapters'), byCorpus('scoutResults'), byCorpus('arcs'), byCorpus('deepAnalysisRuns'),
    byCorpus('deepAnalysisItems'), byCorpus('canonPacks'), byCorpus('ingestBatches'),
    byCorpus('analysisCache'), byCorpus('chapterCoverage'),
  ]);
  const completedRuns = deepAnalysisRuns.filter((row) => ['complete', 'completed'].includes(String(row.status || '').toLowerCase()));
  const completedRunIds = new Set(completedRuns.map((row) => row.id));
  const completedItems = deepAnalysisItems.filter((row) => completedRunIds.has(row.runId) && ['complete', 'completed'].includes(String(row.status || '').toLowerCase()));
  const packIds = canonPacks.map((row) => row.id);
  const batchIds = ingestBatches.map((row) => row.id);
  const [mergePlans, materializationPlans, canonReviewItems] = await Promise.all([
    labLiteDb.canonPackMergePlans.toArray(),
    labLiteDb.materializationPlans.toArray(),
    labLiteDb.canonReviewItems.toArray(),
  ]);
  return {
    corpuses: clone(corpuses),
    chapters: clone(chapters),
    scoutResults: clone(scoutResults),
    arcs: clone(arcs),
    deepAnalysisRuns: clone(completedRuns),
    deepAnalysisItems: clone(completedItems),
    canonPacks: clone(canonPacks),
    ingestBatches: clone(ingestBatches.filter((row) => !['pending', 'running', 'retry'].includes(String(row.status || '').toLowerCase()))),
    canonPackMergePlans: clone(mergePlans.filter((row) => packIds.includes(row.canonPackId) || batchIds.includes(row.ingestBatchId))),
    materializationPlans: clone(materializationPlans.filter((row) => packIds.includes(row.canonPackId))),
    canonReviewItems: clone(canonReviewItems.filter((row) => String(row.projectId || '') === normalizedProjectId || packIds.includes(row.canonPackId))),
    analysisCache: clone(analysisCache.filter((row) => ['complete', 'completed'].includes(String(row.status || '').toLowerCase()))),
    chapterCoverage: clone(chapterCoverage),
  };
}

function makeBundleId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `bundle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeFilePart(value) {
  return String(value || 'story')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .toLowerCase() || 'story';
}

function emitProgress(callback, phase, progress) {
  if (typeof callback === 'function') callback({ phase, progress });
}

async function buildZip(files, manifest, createdAt) {
  const zip = new JSZip();
  const date = new Date(createdAt);
  for (const [path, entry] of files) {
    zip.file(path, Array.from(entry.bytes), { binary: true, date, createFolders: false });
  }
  zip.file('manifest.json', stableStringify(manifest, 2), { date, createFolders: false });
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
}

export async function createStoryBundle(projectId, options = {}) {
  emitProgress(options.onProgress, 'collect', 0.05);
  const snapshot = await buildProjectSnapshot(projectId, { includeCanonPack: true });
  const includeChats = options.includeChats !== false;
  const [chats, lab] = await Promise.all([
    includeChats ? collectProjectChats(Number(projectId)) : Promise.resolve(null),
    options.includeFullLab === true ? collectFullLab(projectId) : Promise.resolve(null),
  ]);
  const project = pickSection(snapshot, PROJECT_SECTION_KEYS);
  const canon = pickSection(snapshot, CANON_SECTION_KEYS);
  const analysis = pickSection(snapshot, ANALYSIS_SECTION_KEYS);
  const files = new Map();
  const warnings = [...(snapshot._warnings || [])];
  extractProjectAssets(project, files, warnings);
  if (chats) extractChatAssets(chats, files, warnings);

  emitProgress(options.onProgress, 'package', 0.3);
  const jsonSections = new Map([
    ['data/project.json', project],
    ['data/canon.json', canon],
    ['data/analysis.json', analysis],
  ]);
  if (chats) jsonSections.set('data/chats.json', chats);
  if (lab) jsonSections.set('data/lab.json', lab);
  for (const [path, value] of jsonSections) {
    const bytes = textBytes(stableStringify(value));
    if (bytes.length > STORY_BUNDLE_LIMITS.jsonSectionBytes) {
      throw makeStoryBundleError('STORY_BUNDLE_SECTION_TOO_LARGE', `${path} vượt giới hạn 64 MiB.`);
    }
    files.set(path, { bytes, mime: 'application/json' });
  }

  const entryDescriptors = [];
  for (const [path, entry] of files) {
    entryDescriptors.push({
      path,
      mime: entry.mime,
      size: entry.bytes.length,
      sha256: await sha256Hex(entry.bytes),
    });
  }
  entryDescriptors.sort((left, right) => left.path.localeCompare(right.path));
  const createdAt = new Date().toISOString();
  const manifest = {
    format: 'storyforge-story-bundle',
    bundleFormatVersion: STORY_BUNDLE_FORMAT_VERSION,
    projectSchemaVersion: 8,
    bundleId: makeBundleId(),
    createdAt,
    appVersion: String(import.meta.env?.VITE_APP_VERSION || '0.1.0'),
    sections: {
      required: ['data/project.json', 'data/canon.json', 'data/analysis.json'],
      optional: [chats ? 'data/chats.json' : null, lab ? 'data/lab.json' : null].filter(Boolean),
    },
    counts: {
      project: countRecords(project),
      canon: countRecords(canon),
      analysis: countRecords(analysis),
      chats: chats ? countRecords(chats) : {},
      lab: lab ? countRecords(lab) : {},
    },
    flags: {
      chats: Boolean(chats),
      attachments: Boolean((chats?.attachments || []).length),
      canonPack: Boolean(canon.canon_pack),
      fullLab: Boolean(lab),
      encrypted: Boolean(options.password),
    },
    warnings,
    entries: entryDescriptors,
    uncompressedBytes: entryDescriptors.reduce((sum, entry) => sum + entry.size, 0),
    compressedBytes: 0,
  };

  emitProgress(options.onProgress, 'compress', 0.55);
  let zipBytes = await buildZip(files, manifest, createdAt);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (manifest.compressedBytes === zipBytes.length) break;
    manifest.compressedBytes = zipBytes.length;
    zipBytes = await buildZip(files, manifest, createdAt);
  }
  if (zipBytes.length > STORY_BUNDLE_LIMITS.fileBytes) {
    throw makeStoryBundleError('STORY_BUNDLE_FILE_TOO_LARGE', 'File StoryForge vượt giới hạn 256 MiB.');
  }

  let outputBytes = zipBytes;
  if (options.password) {
    emitProgress(options.onProgress, 'encrypt', 0.8);
    outputBytes = await encryptStoryBundle(zipBytes, options.password);
  }
  emitProgress(options.onProgress, 'blob', 0.95);
  const datePart = createdAt.slice(0, 10);
  const fileName = options.password
    ? `storyforge-backup-${datePart}${STORY_BUNDLE_EXTENSION}`
    : `${safeFilePart(snapshot.project.title)}-${datePart}${STORY_BUNDLE_EXTENSION}`;
  const blob = new Blob([outputBytes], { type: STORY_BUNDLE_MIME });
  emitProgress(options.onProgress, 'complete', 1);
  return { blob, fileName, manifest, warnings, encrypted: Boolean(options.password) };
}

function validateManifest(manifest) {
  if (
    manifest?.format !== 'storyforge-story-bundle'
    || Number(manifest?.bundleFormatVersion) !== STORY_BUNDLE_FORMAT_VERSION
    || !Array.isArray(manifest?.entries)
  ) {
    throw makeStoryBundleError('STORY_BUNDLE_MANIFEST_INVALID', 'Manifest Story Bundle không hợp lệ.');
  }
  if (Number(manifest.projectSchemaVersion) > 8) {
    throw makeStoryBundleError('PROJECT_SNAPSHOT_VERSION_UNSUPPORTED', 'File được tạo bởi phiên bản StoryForge mới hơn.');
  }
}

async function hydrateAssets(project, chats, zip, descriptors, warnings) {
  const descriptorMap = new Map(descriptors.map((entry) => [entry.path, entry]));
  for (const asset of project.project_assets || []) {
    for (const field of ['data_url', 'thumbnail_data_url']) {
      const path = asset[`_bundle_${field}_entry`];
      if (path) {
        const descriptor = descriptorMap.get(path);
        const bytes = await zip.file(path).async('uint8array');
        asset[field] = bytesToDataUrl(bytes, descriptor.mime);
      }
      delete asset[`_bundle_${field}_entry`];
    }
  }
  for (const attachment of chats?.attachments || []) {
    const path = attachment._bundle_data_url_entry;
    if (path) {
      const descriptor = descriptorMap.get(path);
      const bytes = await zip.file(path).async('uint8array');
      attachment.data_url = bytesToDataUrl(bytes, descriptor.mime);
    }
    delete attachment._bundle_data_url_entry;
  }
  if (warnings.some((warning) => warning.code === 'REMOTE_PROJECT_ASSET_DISABLED')) {
    project.project.cover_asset_id = 0;
    project.project.cover_thumbnail_data_url = '';
  }
}

export async function inspectStoryBundle(input, options = {}) {
  let bytes = await inputToBytes(input);
  if (bytes.length > STORY_BUNDLE_LIMITS.fileBytes) {
    throw makeStoryBundleError('STORY_BUNDLE_FILE_TOO_LARGE', 'File StoryForge vượt giới hạn 256 MiB.');
  }
  const encrypted = isEncryptedStoryBundle(bytes);
  if (encrypted) bytes = await decryptStoryBundle(bytes, options.password);
  const central = inspectZipCentralDirectory(bytes);
  const zip = await JSZip.loadAsync(bytes, { createFolders: false, checkCRC32: true });
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw makeStoryBundleError('STORY_BUNDLE_MANIFEST_MISSING', 'File thiếu manifest.json.');
  const manifestInfo = central.entries.find((entry) => entry.name === 'manifest.json');
  if (!manifestInfo || manifestInfo.uncompressedSize > STORY_BUNDLE_LIMITS.manifestBytes) {
    throw makeStoryBundleError('STORY_BUNDLE_MANIFEST_TOO_LARGE', 'Manifest vượt giới hạn 1 MiB.');
  }
  const manifest = parseBoundedJson(await manifestEntry.async('string'), { manifest: true });
  validateManifest(manifest);

  const actualFiles = new Set(central.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name));
  const declaredFiles = new Set(['manifest.json']);
  const sectionValues = new Map();
  for (const descriptor of manifest.entries) {
    const path = validateBundlePath(descriptor.path);
    if (declaredFiles.has(path)) {
      throw makeStoryBundleError('STORY_BUNDLE_DUPLICATE_ENTRY', 'Manifest khai báo entry trùng tên.');
    }
    declaredFiles.add(path);
    const entry = zip.file(path);
    if (!entry || !actualFiles.has(path)) {
      throw makeStoryBundleError('STORY_BUNDLE_ENTRY_MISSING', `File thiếu entry ${path}.`);
    }
    const centralEntry = central.entries.find((item) => item.name === path);
    if (Number(descriptor.size) !== centralEntry.uncompressedSize) {
      throw makeStoryBundleError('STORY_BUNDLE_SIZE_MISMATCH', `Kích thước entry ${path} không khớp manifest.`);
    }
    const entryBytes = await entry.async('uint8array');
    const checksum = await sha256Hex(entryBytes);
    if (checksum !== String(descriptor.sha256 || '').toLowerCase()) {
      throw makeStoryBundleError('STORY_BUNDLE_CHECKSUM_MISMATCH', `Checksum entry ${path} không hợp lệ.`);
    }
    if (String(descriptor.mime || '').startsWith('image/')) {
      if (entryBytes.length > STORY_BUNDLE_LIMITS.imageBytes || !validateImageMagic(entryBytes, descriptor.mime)) {
        throw makeStoryBundleError('STORY_BUNDLE_ASSET_INVALID', `Asset ảnh ${path} không hợp lệ.`);
      }
    }
    if (path.startsWith('data/')) {
      sectionValues.set(path, parseBoundedJson(new TextDecoder().decode(entryBytes)));
    }
  }
  if ([...actualFiles].some((path) => !declaredFiles.has(path))) {
    throw makeStoryBundleError('STORY_BUNDLE_ENTRY_NOT_DECLARED', 'ZIP chứa entry không được manifest khai báo.');
  }
  for (const requiredPath of manifest.sections?.required || []) {
    if (!sectionValues.has(requiredPath)) {
      throw makeStoryBundleError('STORY_BUNDLE_SECTION_MISSING', `File thiếu section ${requiredPath}.`);
    }
  }

  const project = sectionValues.get('data/project.json') || {};
  const canon = sectionValues.get('data/canon.json') || {};
  const analysis = sectionValues.get('data/analysis.json') || {};
  const chats = sectionValues.get('data/chats.json') || null;
  const lab = sectionValues.get('data/lab.json') || null;
  const warnings = [...(manifest.warnings || [])];
  await hydrateAssets(project, chats, zip, manifest.entries, warnings);
  const snapshot = sanitizeSnapshotHtml({
    _storyforge_version: manifest.projectSchemaVersion,
    _exported_at: manifest.createdAt,
    ...project,
    ...canon,
    ...analysis,
  });
  return {
    manifest,
    snapshot,
    chats,
    lab,
    warnings,
    encrypted,
    checksumsValid: true,
  };
}

export async function importStoryBundle(input, options = {}) {
  const inspected = await inspectStoryBundle(input, { password: options.password });
  const mode = options.mode === 'replace' ? 'replace' : 'duplicate';
  const stagedLab = inspected.lab
    ? await stageLabBundle(inspected.lab, {
      sourceCanonPackId: inspected.snapshot.project?.source_canon_pack_id,
      fallbackCanonPack: inspected.snapshot.canon_pack,
    })
    : null;
  let result;
  try {
    result = await importProjectSnapshot(inspected.snapshot, {
      replaceProjectId: mode === 'replace' ? options.targetProjectId : null,
      titleMode: mode === 'replace' ? 'original' : 'imported',
      source: 'file',
      chats: inspected.chats,
      preserveTargetChats: mode === 'replace' && !inspected.chats,
      includeCanonPack: !stagedLab,
      sourceCanonPackId: stagedLab?.canonPackId || '',
    });
  } catch (error) {
    await stagedLab?.cleanup();
    throw error;
  }
  if (stagedLab) {
    try {
      await stagedLab.finalize(result.projectId, result.idMaps);
    } catch {
      result.warnings.push({ code: 'LAB_FINALIZE_INCOMPLETE' });
    }
  }
  return {
    projectId: result.projectId,
    mode,
    warnings: [...inspected.warnings, ...result.warnings],
    manifest: inspected.manifest,
  };
}

export { isStoryBundleCryptoAvailable };

export default {
  createStoryBundle,
  inspectStoryBundle,
  importStoryBundle,
  isStoryBundleCryptoAvailable,
};
