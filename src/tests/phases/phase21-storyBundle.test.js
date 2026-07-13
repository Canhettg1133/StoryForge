import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import db from '../../services/db/database.js';
import { labLiteDb } from '../../services/labLite/labLiteDb.js';
import {
  STORY_BUNDLE_MIME,
  createStoryBundle,
  importStoryBundle,
  inspectStoryBundle,
} from '../../services/storyBundle/storyBundle.js';
import { sha256HexBytes } from '../../services/storyBundle/storyBundleHash.js';

async function resetDatabases() {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
  if (labLiteDb.isOpen()) labLiteDb.close();
  await labLiteDb.delete();
  await labLiteDb.open();
}

async function seedStory() {
  const projectId = await db.projects.add({
    title: 'Offline backup',
    genre_primary: 'fantasy',
    status: 'draft',
    created_at: 1,
    updated_at: 1,
  });
  const chapterId = await db.chapters.add({ project_id: projectId, title: 'Chapter', order_index: 1 });
  await db.scenes.add({
    project_id: projectId,
    chapter_id: chapterId,
    title: 'Scene',
    order_index: 1,
    content: '<p>Safe <strong>story</strong></p><script>steal()</script><img src=x onerror=steal()>',
  });
  const coverId = await db.project_assets.add({
    project_id: projectId,
    role: 'cover',
    source: 'upload',
    mime_type: 'image/png',
    data_url: 'data:image/png;base64,iVBORw0KGgo=',
    thumbnail_data_url: 'data:image/png;base64,iVBORw0KGgo=',
    created_at: 1,
    updated_at: 1,
  });
  await db.projects.update(projectId, {
    cover_asset_id: coverId,
    cover_thumbnail_data_url: 'data:image/png;base64,iVBORw0KGgo=',
  });
  const threadId = await db.ai_chat_threads.add({
    project_id: projectId,
    title: 'Project chat',
    created_at: 1,
    updated_at: 1,
  });
  const messageId = await db.ai_chat_messages.add({
    project_id: projectId,
    thread_id: threadId,
    role: 'user',
    content: 'Remember this',
    created_at: 1,
  });
  const attachmentId = await db.ai_chat_attachments.add({
    project_id: projectId,
    thread_id: threadId,
    file_name: 'note.png',
    file_type: 'image',
    mime_type: 'image/png',
    data_url: 'data:image/png;base64,iVBORw0KGgo=',
    size_bytes: 8,
    created_at: 1,
    updated_at: 1,
  });
  await db.ai_chat_attachment_chunks.add({ attachment_id: attachmentId, chunk_index: 0, text: 'chunk' });
  await db.ai_chat_message_attachments.add({ message_id: messageId, attachment_id: attachmentId, order_index: 0 });
  return projectId;
}

describe('phase21 Story Bundle', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.unstubAllGlobals();
    await resetDatabases();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (db.isOpen()) db.close();
    await db.delete();
    if (labLiteDb.isOpen()) labLiteDb.close();
    await labLiteDb.delete();
  });

  it('round-trips project, cover, chat and attachments locally without leaking credentials', async () => {
    const projectId = await seedStory();
    localStorage.setItem('sf-provider-api-key', 'sk-never-export-this-secret');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const created = await createStoryBundle(projectId, { includeChats: true });
    expect(created.blob.type).toBe(STORY_BUNDLE_MIME);
    expect(created.fileName).toMatch(/\.storyforge$/u);
    expect(new TextDecoder().decode(await created.blob.arrayBuffer())).not.toContain('sk-never-export-this-secret');

    const inspected = await inspectStoryBundle(created.blob);
    expect(inspected.manifest).toMatchObject({
      format: 'storyforge-story-bundle',
      bundleFormatVersion: 1,
      projectSchemaVersion: 8,
      flags: expect.objectContaining({ chats: true, attachments: true }),
    });
    expect(inspected.checksumsValid).toBe(true);

    const imported = await importStoryBundle(created.blob, { mode: 'duplicate' });
    const importedScene = await db.scenes.where('project_id').equals(imported.projectId).first();
    const importedProject = await db.projects.get(imported.projectId);
    const importedThreads = await db.ai_chat_threads.where('project_id').equals(imported.projectId).toArray();
    const importedAttachments = await db.ai_chat_attachments.where('project_id').equals(imported.projectId).toArray();

    expect(imported.projectId).not.toBe(projectId);
    expect(importedScene.content).toBe('<p>Safe <strong>story</strong></p>');
    expect(importedProject.cover_thumbnail_data_url).toMatch(/^data:image\/png;base64,/u);
    expect(importedThreads).toHaveLength(1);
    expect(importedAttachments[0].data_url).toMatch(/^data:image\/png;base64,/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps manifest byte sizes exact for Vietnamese JSON sections', async () => {
    const projectId = await seedStory();
    await db.suggestions.add({
      project_id: projectId,
      type: 'analysis_note',
      title: 'Gợi ý diễn biến',
      content: 'Nhân vật cần đối mặt với lựa chọn khó khăn.',
      created_at: 1,
      updated_at: 1,
    });

    const created = await createStoryBundle(projectId, { includeChats: false });

    await expect(inspectStoryBundle(created.blob))
      .resolves.toMatchObject({ checksumsValid: true });
  });

  it('exports and verifies an unencrypted bundle when Web Crypto is unavailable', async () => {
    const projectId = await seedStory();
    vi.stubGlobal('crypto', undefined);

    await expect(sha256HexBytes(new TextEncoder().encode('abc')))
      .resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await expect(sha256HexBytes(new TextEncoder().encode(
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    ))).resolves.toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');

    const created = await createStoryBundle(projectId, { includeChats: false });

    await expect(inspectStoryBundle(created.blob))
      .resolves.toMatchObject({ encrypted: false, checksumsValid: true });
  });

  it('encrypts the whole ZIP and returns the same public error for wrong passwords or tampering', async () => {
    const projectId = await seedStory();
    const created = await createStoryBundle(projectId, {
      includeChats: false,
      password: 'correct horse battery staple',
    });
    const encryptedBytes = new Uint8Array(await created.blob.arrayBuffer());
    expect(new TextDecoder().decode(encryptedBytes.slice(0, 8))).toBe('SFORGE1E');
    expect(new TextDecoder().decode(encryptedBytes)).not.toContain('Offline backup');

    await expect(inspectStoryBundle(created.blob, { password: 'wrong password value' }))
      .rejects.toMatchObject({ code: 'STORY_BUNDLE_DECRYPT_FAILED' });

    encryptedBytes[encryptedBytes.length - 1] ^= 0xff;
    await expect(inspectStoryBundle(new Blob([encryptedBytes]), { password: 'correct horse battery staple' }))
      .rejects.toMatchObject({ code: 'STORY_BUNDLE_DECRYPT_FAILED' });

    await expect(inspectStoryBundle(created.blob, { password: 'correct horse battery staple' }))
      .resolves.toMatchObject({ encrypted: true, checksumsValid: true });
  });

  it('rejects traversal entries before extracting the ZIP', async () => {
    const zip = new JSZip();
    zip.file('../outside.txt', 'not allowed');
    zip.file('manifest.json', JSON.stringify({ format: 'storyforge-story-bundle' }));
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    await expect(inspectStoryBundle(new Blob([bytes])))
      .rejects.toMatchObject({ code: 'STORY_BUNDLE_UNSAFE_PATH' });
  });

  it('rejects a modified section when its manifest checksum no longer matches', async () => {
    const projectId = await seedStory();
    const created = await createStoryBundle(projectId, { includeChats: false });
    const zip = await JSZip.loadAsync(await created.blob.arrayBuffer());
    const originalProject = await zip.file('data/project.json').async('string');
    zip.file('data/project.json', originalProject.replace('Offline backup', 'Tampered story'));
    const tampered = await zip.generateAsync({ type: 'uint8array' });

    await expect(inspectStoryBundle(new Blob([tampered])))
      .rejects.toMatchObject({ code: 'STORY_BUNDLE_CHECKSUM_MISMATCH' });
  });

  it('restores the referenced Canon Pack and optional completed Lab workspace with remapped IDs', async () => {
    const projectId = await seedStory();
    await labLiteDb.corpuses.put({ id: 'corpus-source', projectId: String(projectId), title: 'Source corpus' });
    await labLiteDb.chapters.put({ id: 'lab-chapter-source', corpusId: 'corpus-source', index: 1, content: 'Full source chapter' });
    await labLiteDb.scoutResults.put({ id: 'scout-source', corpusId: 'corpus-source', chapterIndex: 1, status: 'complete' });
    await labLiteDb.deepAnalysisRuns.put({ id: 'run-complete', corpusId: 'corpus-source', status: 'complete' });
    await labLiteDb.deepAnalysisRuns.put({ id: 'run-running', corpusId: 'corpus-source', status: 'running' });
    await labLiteDb.deepAnalysisItems.put({ id: 'item-complete', corpusId: 'corpus-source', runId: 'run-complete', status: 'complete' });
    await labLiteDb.canonPacks.put({
      id: 'pack-source',
      corpusId: 'corpus-source',
      projectId: String(projectId),
      linkedProjectId: String(projectId),
      title: 'Canon source',
      status: 'complete',
    });
    await labLiteDb.analysisJobs.put({ id: 'job-running', corpusId: 'corpus-source', status: 'running' });
    await db.projects.update(projectId, {
      source_canon_pack_id: 'pack-source',
      project_mode: 'fanfic',
      fanfic_setup: JSON.stringify({ canonPackId: 'pack-source', adherence: 'strict' }),
    });

    const created = await createStoryBundle(projectId, { includeChats: false, includeFullLab: true });
    const imported = await importStoryBundle(created.blob, { mode: 'duplicate' });
    const importedProject = await db.projects.get(imported.projectId);
    const importedPack = await labLiteDb.canonPacks.get(importedProject.source_canon_pack_id);
    const importedCorpuses = (await labLiteDb.corpuses.toArray())
      .filter((corpus) => String(corpus.projectId) === String(imported.projectId));

    expect(importedProject.source_canon_pack_id).not.toBe('pack-source');
    expect(JSON.parse(importedProject.fanfic_setup).canonPackId).toBe(importedProject.source_canon_pack_id);
    expect(importedPack).toMatchObject({ title: 'Canon source', projectId: String(imported.projectId) });
    expect(importedCorpuses).toHaveLength(1);
    await expect(labLiteDb.chapters.where('corpusId').equals(importedCorpuses[0].id).count()).resolves.toBe(1);
    await expect(labLiteDb.deepAnalysisRuns.where('corpusId').equals(importedCorpuses[0].id).count()).resolves.toBe(1);
    await expect(labLiteDb.analysisJobs.where('corpusId').equals(importedCorpuses[0].id).count()).resolves.toBe(0);
  });

  it('preserves target chats when replacing from a bundle that intentionally excludes chats', async () => {
    const sourceProjectId = await seedStory();
    const created = await createStoryBundle(sourceProjectId, { includeChats: false });
    const targetProjectId = await db.projects.add({ title: 'Replace target', updated_at: 1 });
    const targetThreadId = await db.ai_chat_threads.add({
      project_id: targetProjectId,
      title: 'Keep target chat',
      created_at: 1,
      updated_at: 1,
    });

    const imported = await importStoryBundle(created.blob, {
      mode: 'replace',
      targetProjectId,
    });

    expect(await db.projects.get(targetProjectId)).toBeUndefined();
    expect(await db.ai_chat_threads.get(targetThreadId)).toMatchObject({
      project_id: imported.projectId,
      title: 'Keep target chat',
    });
  });
});
