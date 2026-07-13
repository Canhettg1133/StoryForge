import db from './database.js';
import {
  getStoryCreationSettings,
  saveStoryCreationSettings,
} from '../ai/storyCreationSettings.js';
import {
  buildProjectSnapshot,
  importProjectSnapshot,
  stableStringify,
} from './projectSnapshot.js';
import { parseBoundedJson, STORY_BUNDLE_LIMITS } from '../storyBundle/storyBundleSafety.js';

function resolveImportedChatTitle(title, titleMode = 'imported') {
  const normalizedTitle = String(title || 'Cuộc trò chuyện mới').trim() || 'Cuộc trò chuyện mới';
  if (titleMode === 'original' || /\((Imported|Đã nhập)\)$/iu.test(normalizedTitle)) return normalizedTitle;
  return `${normalizedTitle} (Đã nhập)`;
}

function parseChatBackup(jsonString) {
  const data = parseBoundedJson(jsonString);
  if (!data?._storyforge_version || data?._cloud_scope !== 'chat' || !data?.thread || !Array.isArray(data?.messages)) {
    throw new Error('File không hợp lệ - không phải bản sao lưu chat StoryForge');
  }
  return data;
}

function parsePromptBundleBackup(jsonString) {
  const data = parseBoundedJson(jsonString);
  if (!data?._storyforge_version || data?._cloud_scope !== 'prompt_bundle' || !data?.story_creation_settings) {
    throw new Error('File không hợp lệ - không phải bản sao lưu prompt StoryForge');
  }
  return data;
}

export async function exportProject(projectId) {
  const snapshot = await buildProjectSnapshot(projectId, { includeCanonPack: true });
  return stableStringify(snapshot, 2);
}

export async function exportChatThread(threadId) {
  const normalizedThreadId = Number(threadId);
  if (!Number.isFinite(normalizedThreadId) || normalizedThreadId <= 0) {
    throw new Error('Không tìm thấy cuộc chat để sao lưu.');
  }

  const [thread, messages, attachments] = await Promise.all([
    db.ai_chat_threads.get(normalizedThreadId),
    db.ai_chat_messages.where('thread_id').equals(normalizedThreadId).sortBy('created_at'),
    db.ai_chat_attachments.where('thread_id').equals(normalizedThreadId).toArray(),
  ]);
  if (!thread) throw new Error('Không tìm thấy cuộc chat local.');

  let projectTitle = '';
  let projectCloudSlug = '';
  if (Number(thread.project_id) > 0) {
    const project = await db.projects.get(Number(thread.project_id));
    projectTitle = String(project?.title || '').trim();
    projectCloudSlug = String(project?.cloud_project_slug || '').trim();
  }

  const attachmentIds = attachments.map((attachment) => attachment.id);
  const [attachmentChunks, messageAttachments] = attachmentIds.length > 0
    ? await Promise.all([
      db.ai_chat_attachment_chunks.where('attachment_id').anyOf(attachmentIds).toArray(),
      db.ai_chat_message_attachments.where('attachment_id').anyOf(attachmentIds).toArray(),
    ])
    : [[], []];

  return stableStringify({
    _storyforge_version: 1,
    _cloud_scope: 'chat',
    _exported_at: new Date().toISOString(),
    thread,
    messages,
    attachments,
    attachment_chunks: attachmentChunks,
    message_attachments: messageAttachments,
    metadata: {
      project_title: projectTitle,
      project_cloud_slug: projectCloudSlug,
      message_count: messages.length,
      attachment_count: attachments.length,
    },
  }, 2);
}

export async function exportPromptBundle() {
  return stableStringify({
    _storyforge_version: 1,
    _cloud_scope: 'prompt_bundle',
    _exported_at: new Date().toISOString(),
    story_creation_settings: getStoryCreationSettings(),
  }, 2);
}

export async function downloadProjectJSON(projectId) {
  const json = await exportProject(projectId);
  const project = await db.projects.get(projectId);
  const filename = `${(project?.title || 'project').replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, '_')}_backup_${Date.now()}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importProject(jsonString, options = {}) {
  const result = await importProjectSnapshot(jsonString, options);
  return result.projectId;
}

export async function importProjectFromFile(file, options = {}) {
  if (Number(file?.size || 0) > STORY_BUNDLE_LIMITS.jsonSectionBytes) {
    throw new Error('Project backup JSON vượt giới hạn 64 MiB.');
  }
  const data = parseBoundedJson(await file.text());
  const result = await importProjectSnapshot(data, options);
  return result.projectId;
}

export async function importChatThread(jsonString, options = {}) {
  const data = parseChatBackup(jsonString);
  const titleMode = options.titleMode === 'original' ? 'original' : 'imported';
  const preserveCloudMetadata = options.preserveCloudMetadata !== false;
  const originalThread = data.thread || {};
  const originalMessages = Array.isArray(data.messages) ? data.messages : [];
  const originalAttachments = Array.isArray(data.attachments) ? data.attachments : [];
  const originalAttachmentChunks = Array.isArray(data.attachment_chunks) ? data.attachment_chunks : [];
  const originalMessageAttachments = Array.isArray(data.message_attachments) ? data.message_attachments : [];
  const requestedProjectCloudSlug = String(data?.metadata?.project_cloud_slug || '').trim();

  let targetProjectId = Number(options.targetProjectId || 0);
  let nextChatMode = targetProjectId > 0 ? (originalThread.chat_mode || 'story') : 'free';
  let nextSystemPrompt = targetProjectId > 0 ? String(originalThread.system_prompt || '').trim() : '';
  if (!(targetProjectId > 0) && requestedProjectCloudSlug) {
    const allProjects = await db.projects.toArray();
    const targetProject = allProjects.find(
      (project) => String(project?.cloud_project_slug || '').trim() === requestedProjectCloudSlug,
    ) || null;
    if (targetProject) {
      targetProjectId = Number(targetProject.id);
      nextChatMode = originalThread.chat_mode || 'story';
      nextSystemPrompt = String(originalThread.system_prompt || '').trim();
    }
  }

  let newThreadId = null;
  await db.transaction(
    'rw',
    db.ai_chat_threads,
    db.ai_chat_messages,
    db.ai_chat_attachments,
    db.ai_chat_attachment_chunks,
    db.ai_chat_message_attachments,
    async () => {
      const now = Date.now();
      const { id: _oldThreadId, project_id: _oldThreadProjectId, ...threadData } = originalThread;
      const normalizedThreadData = { ...threadData };
      if (!preserveCloudMetadata) {
        for (const key of Object.keys(normalizedThreadData)) {
          if (key.startsWith('cloud_')) delete normalizedThreadData[key];
        }
      }
      newThreadId = await db.ai_chat_threads.add({
        ...normalizedThreadData,
        project_id: targetProjectId,
        chat_mode: nextChatMode,
        system_prompt: nextSystemPrompt,
        title: resolveImportedChatTitle(normalizedThreadData.title, titleMode),
        created_at: now,
        updated_at: now,
      });

      const messageIdMap = new Map();
      for (let index = 0; index < originalMessages.length; index += 1) {
        const message = originalMessages[index];
        const { id: oldMessageId, thread_id: _oldMessageThreadId, project_id: _oldMessageProjectId, ...messageData } = message;
        const newMessageId = await db.ai_chat_messages.add({
          ...messageData,
          project_id: targetProjectId,
          thread_id: newThreadId,
          created_at: now + index,
        });
        if (oldMessageId != null) messageIdMap.set(String(oldMessageId), newMessageId);
      }

      const attachmentIdMap = new Map();
      for (const attachment of originalAttachments) {
        const { id: oldAttachmentId, thread_id: _oldAttachmentThreadId, project_id: _oldAttachmentProjectId, ...attachmentData } = attachment;
        const newAttachmentId = await db.ai_chat_attachments.add({
          ...attachmentData,
          project_id: targetProjectId,
          thread_id: newThreadId,
          created_at: now,
          updated_at: now,
        });
        if (oldAttachmentId != null) attachmentIdMap.set(String(oldAttachmentId), newAttachmentId);
      }

      for (const chunk of originalAttachmentChunks) {
        const { id: _oldChunkId, attachment_id: oldAttachmentId, ...chunkData } = chunk;
        const attachmentId = attachmentIdMap.get(String(oldAttachmentId));
        if (attachmentId) await db.ai_chat_attachment_chunks.add({ ...chunkData, attachment_id: attachmentId });
      }
      for (const link of originalMessageAttachments) {
        const { id: _oldLinkId, message_id: oldMessageId, attachment_id: oldAttachmentId, ...linkData } = link;
        const messageId = messageIdMap.get(String(oldMessageId));
        const attachmentId = attachmentIdMap.get(String(oldAttachmentId));
        if (messageId && attachmentId) {
          await db.ai_chat_message_attachments.add({ ...linkData, message_id: messageId, attachment_id: attachmentId });
        }
      }
    },
  );

  return {
    newThreadId,
    projectId: targetProjectId,
    messageCount: originalMessages.length,
    attachmentCount: originalAttachments.length,
  };
}

export function importPromptBundle(jsonString) {
  const data = parsePromptBundleBackup(jsonString);
  return saveStoryCreationSettings(data.story_creation_settings);
}
