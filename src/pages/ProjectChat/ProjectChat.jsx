import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Save,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import '../Settings/Settings.css';
import './ProjectChat.css';
import useProjectStore from '../../stores/projectStore';
import aiService from '../../services/ai/client';
import modelRouter, {
  DIRECT_MODELS,
  PROXY_MODELS,
  PROVIDERS,
  QUALITY_MODES,
  TASK_TYPES,
} from '../../services/ai/router';
import db from '../../services/db/database';

const GLOBAL_CHAT_PROJECT_ID = 0;
const CHAT_THREAD_TITLE_FALLBACK = 'Cuộc trò chuyện mới';
const CHAT_MODES = {
  STORY: 'story',
  FREE: 'free',
};

const sortThreadsDesc = (threads) =>
  [...threads].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));

function trimThreadTitle(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return CHAT_THREAD_TITLE_FALLBACK;
  return normalized.length > 48 ? `${normalized.slice(0, 48).trim()}...` : normalized;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Vừa xong';
  const diff = Date.now() - Number(timestamp);
  if (diff < 60000) return 'Vừa xong';
  if (diff < 3600000) return `${Math.round(diff / 60000)} phút trước`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} giờ trước`;
  return `${Math.round(diff / 86400000)} ngày trước`;
}

function getProviderLabel(provider) {
  if (provider === PROVIDERS.GEMINI_DIRECT) return 'Gemini Direct';
  if (provider === PROVIDERS.OLLAMA) return 'Ollama';
  return 'Gemini Proxy';
}

function getQualityLabel(quality) {
  if (quality === QUALITY_MODES.FAST) return 'Nhanh';
  if (quality === QUALITY_MODES.BEST) return 'Tốt nhất';
  return 'Cân bằng';
}

function getChatModeLabel(mode) {
  return mode === CHAT_MODES.STORY ? 'AI của truyện' : 'Tự do hỏi đáp';
}

function buildFreeSystemPrompt() {
  return [
    'Bạn là trợ lý AI đa năng của StoryForge.',
    'Trả lời trực tiếp, rõ ràng, hữu ích và bằng tiếng Việt trừ khi người dùng yêu cầu ngôn ngữ khác.',
    'Ở chế độ này, bạn không cần bám theo canon hay dữ liệu của bất kỳ truyện nào nếu người dùng không yêu cầu.',
  ].join('\n\n');
}


function buildStorySystemPrompt(project) {
  const lines = [
    `Bạn là trợ lý AI cho dự án truyện "${project?.title || 'Chưa đặt tên'}".`,
    'Trả lời bằng tiếng Việt trừ khi người dùng yêu cầu ngôn ngữ khác.',
    'Nếu người dùng hỏi về truyện, hãy ưu tiên tối đa sự nhất quán với thế giới truyện, nhân vật, định hướng cốt truyện và các chỉ dẫn hiện có của dự án.',
    'Khi dữ liệu chưa đủ, hãy nói rõ giả định ngắn gọn thay vì bịa thêm canon mới.',
  ];

  if (project?.genre_primary) lines.push(`Thể loại chính: ${project.genre_primary}.`);
  if (project?.synopsis) lines.push(`[Tóm tắt dự án]\n${project.synopsis}`);
  if (project?.ultimate_goal) lines.push(`[Đích đến dài hạn]\n${project.ultimate_goal}`);
  if (project?.ai_guidelines) lines.push(`[Chỉ dẫn AI của dự án]\n${project.ai_guidelines}`);

  return lines.join('\n\n');
}

function buildDefaultSystemPrompt(mode, project) {
  return mode === CHAT_MODES.STORY ? buildStorySystemPrompt(project) : buildFreeSystemPrompt();
}

function getRoutePreview(provider, selectedModel) {
  return modelRouter.route(
    TASK_TYPES.FREE_PROMPT,
    selectedModel
      ? { providerOverride: provider, modelOverride: selectedModel }
      : { providerOverride: provider },
  );
}

function getAvailableModelOptions(provider) {
  if (provider === PROVIDERS.GEMINI_DIRECT) {
    const activeIds = new Set(modelRouter.getActiveDirectModels().map((item) => item.id));
    return DIRECT_MODELS
      .filter((model) => activeIds.size === 0 || activeIds.has(model.id))
      .map((model) => ({
        id: model.id,
        label: model.label,
        meta: `${model.rpm} RPM · ${model.rpd} RPD`,
      }));
  }

  if (provider === PROVIDERS.OLLAMA) {
    const currentModel = localStorage.getItem('sf-ollama-model') || 'llama3';
    return [{ id: currentModel, label: currentModel, meta: 'Model local hiện tại' }];
  }

  return PROXY_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    meta: model.tier === 'pro' ? 'Proxy · Pro' : 'Proxy · Flash',
  }));
}

function normalizeThread(thread, projectScopeEnabled, project) {
  const chatMode = thread?.chat_mode || (projectScopeEnabled ? CHAT_MODES.STORY : CHAT_MODES.FREE);
  return {
    ...thread,
    chat_mode: chatMode,
    system_prompt:
      String(thread?.system_prompt || '').trim() || buildDefaultSystemPrompt(chatMode, project),
    model_override: thread?.model_override || '',
  };
}

function MessageBubble({ message, onCopy, onEdit, onContinue }) {
  const roleClass =
    message.role === 'user'
      ? 'is-user'
      : message.role === 'assistant'
        ? 'is-assistant'
        : 'is-system';

  return (
    <article
      className={[
        'project-chat-message',
        roleClass,
        message.is_partial ? 'is-partial' : '',
        message.is_streaming ? 'is-streaming' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="project-chat-message__meta">
        <div className="project-chat-message__author">
          {message.role === 'user' ? 'Bạn' : message.role === 'assistant' ? 'AI' : 'Hệ thống'}
        </div>
        <div className="project-chat-message__tools">
          {message.model ? (
            <span className="project-chat-message__chip">
              {message.provider === PROVIDERS.OLLAMA ? 'Local' : 'Cloud'} · {message.model}
            </span>
          ) : null}
          {message.is_streaming ? (
            <span className="project-chat-message__chip project-chat-message__chip--live">
              <Zap size={12} />
              Đang trả lời
            </span>
          ) : null}
          {message.elapsed_ms ? (
            <span className="project-chat-message__chip">
              {(message.elapsed_ms / 1000).toFixed(1)}s
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => onCopy(message.content)}
            title="Sao chép nội dung"
          >
            <Copy size={14} />
          </button>
          {message.role === 'user' ? (
            <button
              type="button"
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => onEdit?.(message)}
              title="Sửa và chat lại"
            >
              <Pencil size={14} />
            </button>
          ) : null}
          {message.role === 'assistant' && message.is_partial ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onContinue?.(message)}
              title="Viết tiếp"
            >
              <Sparkles size={14} />
              Viết tiếp
            </button>
          ) : null}
        </div>
      </div>
      <div className="project-chat-message__content">
        {message.content || (message.is_streaming ? '...' : '')}
      </div>
    </article>
  );
}

export default function ProjectChat() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { currentProject, loadProject } = useProjectStore();
  const projectScopeEnabled = Boolean(projectId);
  const scopedProjectId = projectScopeEnabled ? Number(projectId) : GLOBAL_CHAT_PROJECT_ID;

  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [showSystemPromptDrawer, setShowSystemPromptDrawer] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showTopbarControls, setShowTopbarControls] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [providerSnapshot, setProviderSnapshot] = useState(modelRouter.getPreferredProvider());
  const [qualitySnapshot, setQualitySnapshot] = useState(modelRouter.getQualityMode());
  const [liveRouteInfo, setLiveRouteInfo] = useState(null);

  const inputRef = useRef(null);
  const composerTextareaRef = useRef(null);
  const threadEndRef = useRef(null);
  const isHydratingThreadRef = useRef(false);
  const activeRunRef = useRef(null);

  const activeThread = useMemo(
    () => threads.find((thread) => String(thread.id) === String(activeThreadId)) || null,
    [threads, activeThreadId],
  );

  const activeThreadMode =
    activeThread?.chat_mode || (projectScopeEnabled ? CHAT_MODES.STORY : CHAT_MODES.FREE);

  function resetComposerHeight(minHeight = 58) {
    if (!composerTextareaRef.current) return;
    composerTextareaRef.current.style.height = `${minHeight}px`;
  }

  const routePreview = useMemo(
    () => getRoutePreview(providerSnapshot, activeThread?.model_override || ''),
    [providerSnapshot, activeThread?.model_override],
  );

  const providerOptions = useMemo(
    () => getAvailableModelOptions(providerSnapshot),
    [providerSnapshot],
  );

  const defaultSystemPrompt = buildDefaultSystemPrompt(
    activeThreadMode,
    projectScopeEnabled ? currentProject : null,
  );
  const effectiveSystemPrompt = activeThread?.system_prompt || defaultSystemPrompt;
  const hasThreadPromptOverride =
    !!String(activeThread?.system_prompt || '').trim() &&
    String(activeThread?.system_prompt || '').trim() !== defaultSystemPrompt.trim();
  const alternateChatMode =
    activeThreadMode === CHAT_MODES.STORY ? CHAT_MODES.FREE : CHAT_MODES.STORY;

  useEffect(() => {
    if (!projectScopeEnabled) return;
    if (!currentProject || String(currentProject.id) !== String(projectId)) {
      loadProject(Number(projectId)).catch(() => navigate('/'));
    }
  }, [currentProject, loadProject, navigate, projectId, projectScopeEnabled]);

  useEffect(() => {
    const sync = () => {
      setProviderSnapshot(modelRouter.getPreferredProvider());
      setQualitySnapshot(modelRouter.getQualityMode());
    };

    sync();
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!composerTextareaRef.current) return;
    const textarea = composerTextareaRef.current;
    textarea.style.height = '0px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 58), 220);
    textarea.style.height = `${nextHeight}px`;
  }, [draft, editingMessageId]);

  useEffect(() => {
    if (projectScopeEnabled && (!currentProject || currentProject.id !== scopedProjectId)) return;
    let cancelled = false;

    async function loadThreadsForScope() {
      setIsLoadingThreads(true);
      const rawThreads = await db.ai_chat_threads.where('project_id').equals(scopedProjectId).toArray();
      if (cancelled) return;

      const normalizedThreads = rawThreads.map((thread) =>
        normalizeThread(thread, projectScopeEnabled, currentProject),
      );

      if (normalizedThreads.length === 0) {
        const created = await createThread({
          activate: true,
          initialMode: projectScopeEnabled ? CHAT_MODES.STORY : CHAT_MODES.FREE,
        });
        if (cancelled) return;
        setThreads([created]);
        setActiveThreadId(created.id);
      } else {
        const sorted = sortThreadsDesc(normalizedThreads);
        setThreads(sorted);
        setActiveThreadId((current) =>
          current && sorted.some((thread) => String(thread.id) === String(current))
            ? current
            : sorted[0]?.id || null,
        );
      }

      setIsLoadingThreads(false);
    }

    loadThreadsForScope().catch((error) => {
      console.error('Failed to load AI chat threads:', error);
      setErrorMessage('Không thể tải danh sách cuộc trò chuyện.');
      setIsLoadingThreads(false);
    });

    return () => {
      cancelled = true;
    };
  }, [scopedProjectId, currentProject, projectScopeEnabled]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function loadThreadMessages() {
      setIsLoadingMessages(true);
      const threadMessages = await db.ai_chat_messages
        .where('thread_id')
        .equals(Number(activeThreadId))
        .sortBy('created_at');

      if (cancelled) return;
      setMessages(threadMessages);
      setIsLoadingMessages(false);
    }

    loadThreadMessages().catch((error) => {
      console.error('Failed to load AI chat messages:', error);
      setErrorMessage('Không thể tải nội dung cuộc trò chuyện.');
      setIsLoadingMessages(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThread || isHydratingThreadRef.current) return undefined;

    const timeout = window.setTimeout(async () => {
      try {
        await db.ai_chat_threads.update(activeThread.id, {
          chat_mode: activeThread.chat_mode || activeThreadMode,
          system_prompt:
            activeThread.system_prompt ||
            buildDefaultSystemPrompt(activeThreadMode, projectScopeEnabled ? currentProject : null),
          model_override: activeThread.model_override || '',
        });
        setSaveStatus('Đã lưu cấu hình chat');
      } catch (error) {
        console.error('Failed to save chat thread config:', error);
        setErrorMessage('Không thể lưu cấu hình chat.');
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [
    activeThread?.id,
    activeThread?.chat_mode,
    activeThread?.system_prompt,
    activeThread?.model_override,
    activeThreadMode,
    currentProject,
    projectScopeEnabled,
  ]);

  useEffect(() => {
    if (!saveStatus) return undefined;
    const timeout = window.setTimeout(() => setSaveStatus(''), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  async function createThread({ activate = true, initialMode } = {}) {
    const mode = initialMode || (projectScopeEnabled ? CHAT_MODES.STORY : CHAT_MODES.FREE);
    const now = Date.now();
    const payload = {
      project_id: scopedProjectId,
      title: CHAT_THREAD_TITLE_FALLBACK,
      chat_mode: mode,
      system_prompt: buildDefaultSystemPrompt(mode, projectScopeEnabled ? currentProject : null),
      model_override: '',
      last_provider: '',
      last_model: '',
      created_at: now,
      updated_at: now,
    };

    const id = await db.ai_chat_threads.add(payload);
    const created = { ...payload, id };
    setThreads((prev) => sortThreadsDesc([created, ...prev]));

    if (activate) {
      setActiveThreadId(id);
      setMessages([]);
      setDraft('');
      resetComposerHeight();
      setShowSystemPromptDrawer(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }

    return created;
  }

  function updateThreadLocally(threadId, patch) {
    setThreads((prev) =>
      sortThreadsDesc(
        prev.map((thread) =>
          String(thread.id) === String(threadId) ? { ...thread, ...patch } : thread,
        ),
      ),
    );
  }

  async function persistThreadUpdate(threadId, patch) {
    updateThreadLocally(threadId, patch);
    await db.ai_chat_threads.update(Number(threadId), patch);
  }

  async function appendMessage(threadId, message) {
    const payload = {
      project_id: scopedProjectId,
      thread_id: Number(threadId),
      created_at: Date.now(),
      ...message,
    };
    const id = await db.ai_chat_messages.add(payload);
    return { ...payload, id };
  }

  function replaceTempMessage(tempId, nextMessage) {
    setMessages((prev) =>
      prev.map((message) => (String(message.id) === String(tempId) ? nextMessage : message)),
    );
  }

  function removeTempMessage(tempId) {
    setMessages((prev) => prev.filter((message) => String(message.id) !== String(tempId)));
  }

  async function handleDeleteThread(threadId) {
    if (isStreaming) return;
    const target = threads.find((thread) => String(thread.id) === String(threadId));
    if (!target) return;

    const confirmed = window.confirm(`Xóa cuộc trò chuyện "${target.title}"?`);
    if (!confirmed) return;

    await db.ai_chat_messages.where('thread_id').equals(Number(threadId)).delete();
    await db.ai_chat_threads.delete(Number(threadId));

    const remaining = threads.filter((thread) => String(thread.id) !== String(threadId));
    if (remaining.length === 0) {
      const created = await createThread({
        activate: true,
        initialMode: projectScopeEnabled ? activeThreadMode : CHAT_MODES.FREE,
      });
      setThreads([created]);
      setActiveThreadId(created.id);
      return;
    }

    const sorted = sortThreadsDesc(remaining);
    setThreads(sorted);
    if (String(activeThreadId) === String(threadId)) {
      setActiveThreadId(sorted[0]?.id || null);
    }
  }

  async function handleRenameThread(threadId) {
    if (isStreaming) return;
    const target = threads.find((thread) => String(thread.id) === String(threadId));
    if (!target) return;

    const nextTitle = window.prompt('Đổi tên cuộc trò chuyện', target.title || CHAT_THREAD_TITLE_FALLBACK);
    if (nextTitle == null) return;
    await persistThreadUpdate(threadId, { title: trimThreadTitle(nextTitle) });
  }

  async function handleClearMessages() {
    if (!activeThread || isStreaming) return;

    const confirmed = window.confirm('Xóa toàn bộ tin nhắn trong cuộc trò chuyện hiện tại?');
    if (!confirmed) return;

    await db.ai_chat_messages.where('thread_id').equals(Number(activeThread.id)).delete();
    setMessages([]);
    await persistThreadUpdate(activeThread.id, {
      updated_at: Date.now(),
      last_provider: '',
      last_model: '',
    });
  }

  function buildConversationMessages(nextUserMessage, thread, sourceMessages = messages) {
    const systemPrompt =
      String(thread.system_prompt || '').trim() ||
      buildDefaultSystemPrompt(thread.chat_mode || activeThreadMode, projectScopeEnabled ? currentProject : null);

    const apiMessages = [{ role: 'system', content: systemPrompt }];
    sourceMessages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .forEach((item) => apiMessages.push({ role: item.role, content: item.content }));
    apiMessages.push({ role: 'user', content: nextUserMessage });
    return apiMessages;
  }

  async function sendChatTurn({
    userContent,
    thread = activeThread,
    historyMessages = messages,
    existingUserMessage = null,
  }) {
    if (!thread || !String(userContent || '').trim() || isStreaming) return;
    if ((thread.chat_mode || activeThreadMode) === CHAT_MODES.STORY && !projectScopeEnabled) return;

    const normalizedUserContent = String(userContent || '').trim();
    const routeOptions = thread.model_override
      ? { providerOverride: providerSnapshot, modelOverride: thread.model_override }
      : { providerOverride: providerSnapshot };
    const currentRoute = getRoutePreview(providerSnapshot, thread.model_override || '');
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const provisionalTitle =
      !thread.title || thread.title === CHAT_THREAD_TITLE_FALLBACK
        ? trimThreadTitle(normalizedUserContent)
        : thread.title;
    const userMessage =
      existingUserMessage ||
      (await appendMessage(thread.id, {
        role: 'user',
        content: normalizedUserContent,
      }));

    setMessages((prev) => {
      const baseWithoutTemp = prev.filter(
        (message) =>
          !String(message.id).startsWith('temp-assistant-') &&
          !String(message.id).startsWith('temp-continuation-'),
      );
      const base = existingUserMessage
        ? baseWithoutTemp.map((message) =>
          String(message.id) === String(existingUserMessage.id) ? userMessage : message,
        )
        : [...baseWithoutTemp, userMessage];
      return [
        ...base,
        {
          id: tempAssistantId,
          project_id: scopedProjectId,
          thread_id: thread.id,
          role: 'assistant',
          content: '',
          provider: currentRoute.provider,
          model: currentRoute.model,
          is_streaming: true,
          created_at: Date.now(),
        },
      ];
    });

    setDraft('');
    resetComposerHeight();
    setEditingMessageId(null);
    setErrorMessage('');
    setIsStreaming(true);
    setLiveRouteInfo(currentRoute);
    activeRunRef.current = { threadId: thread.id, tempAssistantId, route: currentRoute };

    await db.ai_chat_threads.update(thread.id, {
      title: provisionalTitle,
      updated_at: Date.now(),
    });
    updateThreadLocally(thread.id, {
      title: provisionalTitle,
      updated_at: Date.now(),
    });

    void aiService
      .send({
        taskType: TASK_TYPES.FREE_PROMPT,
        messages: buildConversationMessages(normalizedUserContent, thread, historyMessages),
        stream: true,
        routeOptions,
        onToken: (_chunk, full) => {
          replaceTempMessage(tempAssistantId, {
            id: tempAssistantId,
            project_id: scopedProjectId,
            thread_id: thread.id,
            role: 'assistant',
            content: full,
            provider: currentRoute.provider,
            model: currentRoute.model,
            is_streaming: true,
            created_at: Date.now(),
          });
        },
        onComplete: async (text, meta) => {
          const assistantMessage = await appendMessage(thread.id, {
            role: 'assistant',
            content: text,
            provider: meta?.provider || currentRoute.provider,
            model: meta?.model || currentRoute.model,
            elapsed_ms: meta?.elapsed || null,
            is_partial: false,
          });

          replaceTempMessage(tempAssistantId, assistantMessage);
          setIsStreaming(false);
          setLiveRouteInfo(null);
          activeRunRef.current = null;

          await persistThreadUpdate(thread.id, {
            title: provisionalTitle,
            updated_at: Date.now(),
            last_provider: meta?.provider || currentRoute.provider,
            last_model: meta?.model || currentRoute.model,
          });
        },
        onError: async (error) => {
          const systemMessage = await appendMessage(thread.id, {
            role: 'system',
            content:
              error?.userMessage ||
              error?.message ||
              'AI không trả lời được cho yêu cầu này.',
          });

          replaceTempMessage(tempAssistantId, systemMessage);
          setErrorMessage(
            error?.userMessage || error?.message || 'AI không trả lời được cho yêu cầu này.',
          );
          setIsStreaming(false);
          setLiveRouteInfo(null);
          activeRunRef.current = null;
        },
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.error('AI chat send failed:', error);
        }
      });
  }

  async function handleSendMessage() {
    if (!activeThread || !draft.trim() || isStreaming) return;
    if (activeThreadMode === CHAT_MODES.STORY && !projectScopeEnabled) return;

    const userContent = draft.trim();
    const currentThread = activeThread;
    const routeOptions = currentThread.model_override
      ? { providerOverride: providerSnapshot, modelOverride: currentThread.model_override }
      : { providerOverride: providerSnapshot };
    const currentRoute = getRoutePreview(providerSnapshot, currentThread.model_override || '');
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const provisionalTitle =
      !currentThread.title || currentThread.title === CHAT_THREAD_TITLE_FALLBACK
        ? trimThreadTitle(userContent)
        : currentThread.title;

    const userMessage = await appendMessage(currentThread.id, {
      role: 'user',
      content: userContent,
    });

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: tempAssistantId,
        project_id: scopedProjectId,
        thread_id: currentThread.id,
        role: 'assistant',
        content: '',
        provider: currentRoute.provider,
        model: currentRoute.model,
        is_streaming: true,
        created_at: Date.now(),
      },
    ]);

    setDraft('');
    resetComposerHeight();
    setErrorMessage('');
    setIsStreaming(true);
    setLiveRouteInfo(currentRoute);
    activeRunRef.current = { threadId: currentThread.id, tempAssistantId, route: currentRoute };

    await db.ai_chat_threads.update(currentThread.id, {
      title: provisionalTitle,
      updated_at: Date.now(),
    });
    updateThreadLocally(currentThread.id, {
      title: provisionalTitle,
      updated_at: Date.now(),
    });

    void aiService
      .send({
        taskType: TASK_TYPES.FREE_PROMPT,
        messages: buildConversationMessages(userContent, currentThread),
        stream: true,
        routeOptions,
        onToken: (_chunk, full) => {
          replaceTempMessage(tempAssistantId, {
            id: tempAssistantId,
            project_id: scopedProjectId,
            thread_id: currentThread.id,
            role: 'assistant',
            content: full,
            provider: currentRoute.provider,
            model: currentRoute.model,
            is_streaming: true,
            created_at: Date.now(),
          });
        },
        onComplete: async (text, meta) => {
          const assistantMessage = await appendMessage(currentThread.id, {
            role: 'assistant',
            content: text,
            provider: meta?.provider || currentRoute.provider,
            model: meta?.model || currentRoute.model,
            elapsed_ms: meta?.elapsed || null,
            is_partial: false,
          });

          replaceTempMessage(tempAssistantId, assistantMessage);
          setIsStreaming(false);
          setLiveRouteInfo(null);
          activeRunRef.current = null;

          await persistThreadUpdate(currentThread.id, {
            title: provisionalTitle,
            updated_at: Date.now(),
            last_provider: meta?.provider || currentRoute.provider,
            last_model: meta?.model || currentRoute.model,
          });
        },
        onError: async (error) => {
          const systemMessage = await appendMessage(currentThread.id, {
            role: 'system',
            content:
              error?.userMessage ||
              error?.message ||
              'AI không trả lời được cho yêu cầu này.',
          });

          replaceTempMessage(tempAssistantId, systemMessage);
          setErrorMessage(
            error?.userMessage || error?.message || 'AI không trả lời được cho yêu cầu này.',
          );
          setIsStreaming(false);
          setLiveRouteInfo(null);
          activeRunRef.current = null;
        },
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.error('AI chat send failed:', error);
        }
      });
  }

  async function handleComposerSubmit() {
    if (!activeThread || !draft.trim() || isStreaming) return;
    if (activeThreadMode === CHAT_MODES.STORY && !projectScopeEnabled) return;

    if (editingMessageId) {
      const targetIndex = messages.findIndex(
        (message) => String(message.id) === String(editingMessageId),
      );
      if (targetIndex === -1) {
        setEditingMessageId(null);
        await sendChatTurn({ userContent: draft.trim() });
        return;
      }

      const targetMessage = messages[targetIndex];
      const trimmedDraft = draft.trim();
      const staleMessages = messages.slice(targetIndex + 1);

      if (staleMessages.length > 0) {
        await db.ai_chat_messages.bulkDelete(staleMessages.map((message) => message.id));
      }
      await db.ai_chat_messages.update(targetMessage.id, { content: trimmedDraft });

      const updatedUserMessage = { ...targetMessage, content: trimmedDraft };
      const historyMessages = messages.slice(0, targetIndex);
      setMessages([...historyMessages, updatedUserMessage]);

      await sendChatTurn({
        userContent: trimmedDraft,
        historyMessages,
        existingUserMessage: updatedUserMessage,
      });
      return;
    }

    await sendChatTurn({ userContent: draft.trim() });
  }

  async function handleStopStreaming() {
    if (!isStreaming || !activeRunRef.current) return;

    aiService.abort();
    const { tempAssistantId, threadId, route } = activeRunRef.current;
    const tempMessage = messages.find((message) => String(message.id) === String(tempAssistantId));

    if (tempMessage?.content?.trim()) {
      const partialMessage = await appendMessage(threadId, {
        role: 'assistant',
        content: tempMessage.content.trim(),
        provider: route.provider,
        model: route.model,
        is_partial: true,
      });
      replaceTempMessage(tempAssistantId, partialMessage);
      await persistThreadUpdate(threadId, {
        updated_at: Date.now(),
        last_provider: route.provider,
        last_model: route.model,
      });
    } else {
      removeTempMessage(tempAssistantId);
      const stopMessage = await appendMessage(threadId, {
        role: 'system',
        content: 'Đã dừng phản hồi của AI.',
      });
      setMessages((prev) => [...prev, stopMessage]);
    }

    activeRunRef.current = null;
    setIsStreaming(false);
    setLiveRouteInfo(null);
    setErrorMessage('');
  }

  function handleCopy(text) {
    navigator.clipboard
      .writeText(text || '')
      .then(() => setSaveStatus('Đã sao chép nội dung'))
      .catch(() => setErrorMessage('Không thể sao chép vào clipboard.'));
  }

  function handleEditMessage(message) {
    if (isStreaming || message.role !== 'user') return;
    setEditingMessageId(message.id);
    setDraft(message.content || '');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleContinueFromMessage(message) {
    if (!activeThread || isStreaming || message.role !== 'assistant') return;
    const targetIndex = messages.findIndex((item) => String(item.id) === String(message.id));
    if (targetIndex === -1) return;

    await sendChatTurn({
      userContent: 'Viết tiếp câu trả lời trước từ đúng đoạn đang dở, không lặp lại phần đã viết.',
      historyMessages: messages.slice(0, targetIndex + 1),
    });
  }

  function handleCancelEditing() {
    setEditingMessageId(null);
    setDraft('');
    resetComposerHeight();
  }

  async function handleChangeMode(mode, options = {}) {
    if (!activeThread || isStreaming) return;
    if (mode === CHAT_MODES.STORY && !projectScopeEnabled) return;
    if (mode === activeThreadMode && !options.preserveHistory) return;

    if (!options.preserveHistory) {
      const nextThread = await createThread({ activate: true, initialMode: mode });
      if (activeThread.model_override) {
        await persistThreadUpdate(nextThread.id, {
          model_override: activeThread.model_override,
          updated_at: Date.now(),
        });
      }
      setSaveStatus('Đã mở một cuộc trò chuyện mới ở chế độ vừa chọn');
      return;
    }

    const currentDefaultPrompt = buildDefaultSystemPrompt(
      activeThreadMode,
      projectScopeEnabled ? currentProject : null,
    );
    const nextDefaultPrompt = buildDefaultSystemPrompt(
      mode,
      projectScopeEnabled ? currentProject : null,
    );
    const shouldSwitchPrompt =
      !String(activeThread.system_prompt || '').trim() ||
      String(activeThread.system_prompt || '').trim() === currentDefaultPrompt.trim();

    await persistThreadUpdate(activeThread.id, {
      chat_mode: mode,
      system_prompt: shouldSwitchPrompt ? nextDefaultPrompt : activeThread.system_prompt,
      updated_at: Date.now(),
    });
  }

  function handleThreadSelect(threadId) {
    if (isStreaming) return;
    isHydratingThreadRef.current = true;
    setActiveThreadId(threadId);
    setEditingMessageId(null);
    setDraft('');
    resetComposerHeight();
    window.setTimeout(() => {
      isHydratingThreadRef.current = false;
    }, 0);
  }

  const pageTitle = projectScopeEnabled ? currentProject?.title || 'Chat AI' : 'Chat tự do';
  const pageKicker = projectScopeEnabled ? 'Dự án hiện tại' : 'Không gắn với truyện';

  if (projectScopeEnabled && !currentProject) {
    return (
      <div className="project-chat-empty card">
        <h2>Đang tải dự án</h2>
        <p>Chờ một chút để mở chế độ AI của truyện.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`project-chat-page ${sidebarCollapsed ? 'has-collapsed-sidebar' : ''}`}>
        <aside className={`project-chat-sidebar card ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
          <div className="project-chat-sidebar__header">
            <div>
              <div className="project-chat-sidebar__kicker">{pageKicker}</div>
              <h1>{pageTitle}</h1>
            </div>
            <div className="project-chat-sidebar__header-actions">
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setSidebarCollapsed((value) => !value)}
                title={sidebarCollapsed ? 'Mở danh sách chat' : 'Thu gọn danh sách chat'}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-icon"
                onClick={() =>
                  createThread({
                    activate: true,
                    initialMode: projectScopeEnabled ? activeThreadMode : CHAT_MODES.FREE,
                  })
                }
                title="Tạo cuộc trò chuyện mới"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {!sidebarCollapsed ? (
            <div className="project-chat-sidebar__hint">
              {projectScopeEnabled
                ? 'Chat này dùng chung model và API key của dự án. Bạn có thể chuyển giữa AI của truyện và chế độ hỏi đáp tự do ngay trong từng cuộc trò chuyện.'
                : 'Chat tự do dùng đúng model và API key mà hệ thống hiện đang dùng. Không bám theo truyện nào cả.'}
            </div>
          ) : null}

          <div className="project-chat-thread-list">
            {isLoadingThreads ? (
              <div className="project-chat-thread-list__empty">Đang tải cuộc trò chuyện...</div>
            ) : threads.length === 0 ? (
              <div className="project-chat-thread-list__empty">Chưa có cuộc trò chuyện nào.</div>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={`project-chat-thread ${String(thread.id) === String(activeThreadId) ? 'is-active' : ''}`}
                  onClick={() => handleThreadSelect(thread.id)}
                >
                  <div className="project-chat-thread__main">
                    <div className="project-chat-thread__title">{thread.title}</div>
                    <div className="project-chat-thread__meta">
                      <span>{getChatModeLabel(thread.chat_mode)}</span>
                      <span>{formatRelativeTime(thread.updated_at)}</span>
                    </div>
                  </div>
                  <div className="project-chat-thread__actions">
                    <span className="project-chat-thread__icon">
                      {thread.chat_mode === CHAT_MODES.STORY ? (
                        <Sparkles size={14} />
                      ) : (
                        <MessageSquare size={14} />
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRenameThread(thread.id);
                      }}
                      title="Đổi tên"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteThread(thread.id);
                      }}
                      title="Xóa cuộc trò chuyện"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="project-chat-main card">
          <div className="project-chat-topbar">
            <div className="project-chat-topbar__compact">
              <div className="project-chat-topbar__meta">
              <div className="project-chat-topbar__kicker">
                {projectScopeEnabled ? 'Không gian chat của truyện' : 'Không gian chat toàn cục'}
              </div>
              </div>
              <div className="project-chat-topbar__header-actions">
                <button
                  type="button"
                  className={`btn btn-secondary project-chat-settings-toggle ${showSystemPromptDrawer ? 'is-open' : ''}`}
                  onClick={() => setShowSystemPromptDrawer((prev) => !prev)}
                >
                  <Settings2 size={16} />
                  System prompt
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowTopbarControls((prev) => !prev)}
                >
                  {showTopbarControls ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {showTopbarControls ? 'Thu gọn' : 'Mở tùy chọn'}
                </button>
              </div>
            </div>

            <div className={`project-chat-topbar__controls ${showTopbarControls ? 'is-open' : ''}`}>
              <div className="project-chat-topbar__control project-chat-topbar__control--mode">
                <span className="project-chat-topbar__label">Chế độ chat</span>
                <div className="project-chat-mode-switch">
                  {projectScopeEnabled ? (
                    <>
                      <button
                        type="button"
                        className={`project-chat-mode-switch__item ${activeThreadMode === CHAT_MODES.STORY ? 'is-active' : ''}`}
                        onClick={() => handleChangeMode(CHAT_MODES.STORY)}
                      >
                        AI của truyện
                      </button>
                      <button
                        type="button"
                        className={`project-chat-mode-switch__item ${activeThreadMode === CHAT_MODES.FREE ? 'is-active' : ''}`}
                        onClick={() => handleChangeMode(CHAT_MODES.FREE)}
                      >
                        Tự do hỏi đáp
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="project-chat-mode-switch__item is-active"
                      disabled
                    >
                      Tự do hỏi đáp
                    </button>
                  )}
                </div>
                {projectScopeEnabled ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm project-chat-topbar__carry-button"
                    onClick={() => handleChangeMode(alternateChatMode, { preserveHistory: true })}
                    disabled={isStreaming}
                  >
                    Giữ lịch sử rồi chuyển sang {getChatModeLabel(alternateChatMode)}
                  </button>
                ) : null}
              </div>

              <div className="project-chat-topbar__control">
                <span className="project-chat-topbar__label">Kênh AI đang dùng</span>
                <div className="project-chat-topbar__value">
                  {getProviderLabel(providerSnapshot)} · {getQualityLabel(qualitySnapshot)}
                </div>
              </div>

              <div className="project-chat-topbar__control project-chat-topbar__control--wide">
                <label className="project-chat-topbar__label" htmlFor="chat-model-select">
                  Model cho cuộc trò chuyện này
                </label>
                <select
                  id="chat-model-select"
                  className="select"
                  value={activeThread?.model_override || ''}
                  onChange={(event) =>
                    persistThreadUpdate(activeThread.id, {
                      model_override: event.target.value,
                      updated_at: Date.now(),
                    })
                  }
                  disabled={!activeThread || isStreaming}
                >
                  <option value="">Theo mặc định hệ thống</option>
                  {providerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} · {option.meta}
                    </option>
                  ))}
                </select>
              </div>

            </div>
          </div>

          <div className="project-chat-statusbar">
            <div className="project-chat-statusbar__item">
              <Bot size={14} />
              Chế độ: {getChatModeLabel(activeThreadMode)}
            </div>
            <div className="project-chat-statusbar__item">
              <Sparkles size={14} />
              Model hiệu lực: {routePreview.model}
            </div>
            <div className="project-chat-statusbar__item">
              <MessageSquare size={14} />
              API key và provider dùng chung với phần AI của dự án
            </div>
            {liveRouteInfo ? (
              <div className="project-chat-statusbar__item project-chat-statusbar__item--live">
                <Zap size={14} />
                AI đang chạy: {getProviderLabel(liveRouteInfo.provider)} · {liveRouteInfo.model}
              </div>
            ) : null}
            {saveStatus ? (
              <div className="project-chat-statusbar__item project-chat-statusbar__item--success">
                <Save size={14} />
                {saveStatus}
              </div>
            ) : null}
          </div>

          {errorMessage ? <div className="project-chat-error">{errorMessage}</div> : null}

          <div className="project-chat-messages">
            {isLoadingMessages ? (
              <div className="project-chat-messages__empty">Đang tải tin nhắn...</div>
            ) : messages.length === 0 ? (
              <div className="project-chat-messages__empty">
                <Bot size={28} />
                <h3>Cuộc trò chuyện đang trống</h3>
                <p>
                  {activeThreadMode === CHAT_MODES.STORY
                    ? 'Đặt câu hỏi về truyện, nhân vật, outline, canon hoặc nhờ AI cùng phát triển dự án.'
                    : 'Dùng như một khung chat tự do. Nó vẫn dùng đúng model và API key của hệ thống.'}
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onCopy={handleCopy}
                  onEdit={handleEditMessage}
                  onContinue={handleContinueFromMessage}
                />
              ))
            )}
            <div ref={threadEndRef} />
          </div>

          <div className="project-chat-composer">
            {editingMessageId ? (
              <div className="project-chat-composer__actions">
                <div className="project-chat-composer__edit-state">
                  Đang sửa một tin nhắn cũ. Gửi lại sẽ xóa các phản hồi phía sau và chat lại từ điểm đó.
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleCancelEditing}>
                    Hủy sửa
                  </button>
                </div>
              </div>
            ) : null}

            <div className="project-chat-composer__input">
              <textarea
                ref={(node) => {
                  inputRef.current = node;
                  composerTextareaRef.current = node;
                }}
                className="textarea"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  activeThreadMode === CHAT_MODES.STORY
                    ? 'Hỏi về truyện, canon, outline, cảnh đang viết hoặc nhờ AI xử lý vấn đề của dự án...'
                    : 'Hỏi gì cũng được ở chế độ tự do hỏi đáp...'
                }
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    handleComposerSubmit();
                  }
                }}
              />

              <div className="project-chat-composer__submit">
                {isStreaming ? (
                  <button
                    type="button"
                    className="project-chat-composer__submit-button project-chat-composer__submit-button--stop"
                    onClick={handleStopStreaming}
                    title="Dừng"
                  >
                    <Square size={18} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="project-chat-composer__submit-button"
                    onClick={handleComposerSubmit}
                    disabled={!draft.trim()}
                    title="Gửi"
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {showSystemPromptDrawer && activeThread ? (
        <>
          <button
            type="button"
            className="project-chat-drawer-backdrop"
            onClick={() => setShowSystemPromptDrawer(false)}
            aria-label="Đóng system prompt"
          />
          <aside className="project-chat-drawer">
            <div className="project-chat-drawer__header">
              <div>
                <div className="project-chat-drawer__kicker">System prompt của cuộc trò chuyện</div>
                <h3>{getChatModeLabel(activeThreadMode)}</h3>
                <p>
                  Nội dung này áp dụng riêng cho cuộc trò chuyện hiện tại. Bạn có thể đóng panel
                  lại bất cứ lúc nào mà không chiếm diện tích trang chat.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowSystemPromptDrawer(false)}
                title="Đóng panel"
              >
                <X size={18} />
              </button>
            </div>

            <div className="project-chat-drawer__actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  persistThreadUpdate(activeThread.id, {
                    system_prompt: buildDefaultSystemPrompt(
                      activeThreadMode,
                      projectScopeEnabled ? currentProject : null,
                    ),
                    updated_at: Date.now(),
                  })
                }
                disabled={isStreaming}
              >
                <CheckCircle2 size={16} />
                Nạp prompt gốc mới nhất
              </button>
            </div>

            <details className="project-chat-drawer__source">
              <summary>Prompt gốc hiện tại</summary>
              <p>
                Đây là prompt gốc lấy trực tiếp từ code hiện tại. Nếu thread này đang dùng prompt cũ
                hoặc prompt riêng, bấm "Nạp prompt gốc mới nhất" để áp dụng lại.
              </p>
              {hasThreadPromptOverride ? (
                <div className="project-chat-drawer__override-note">
                  Cuộc trò chuyện này đang dùng prompt riêng, nên nội dung đang chạy có thể khác với
                  prompt gốc.
                </div>
              ) : null}
              <textarea
                className="textarea project-chat-drawer__source-textarea"
                value={defaultSystemPrompt}
                readOnly
              />
            </details>

            <textarea
              className="textarea project-chat-drawer__textarea"
              value={effectiveSystemPrompt}
              onChange={(event) =>
                persistThreadUpdate(activeThread.id, {
                  system_prompt: event.target.value,
                  updated_at: Date.now(),
                })
              }
              disabled={isStreaming}
            />
          </aside>
        </>
      ) : null}
    </>
  );
}
