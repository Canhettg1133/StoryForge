import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Send,
  Settings2,
  Square,
  Trash2,
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

const CHAT_THREAD_TITLE_FALLBACK = 'Cuộc trò chuyện mới';

function sortThreadsDesc(threads) {
  return [...threads].sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Vừa xong';
  const diff = Date.now() - Number(timestamp);
  if (diff < 60_000) return 'Vừa xong';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} giờ trước`;
  return `${Math.round(diff / 86_400_000)} ngày trước`;
}

function trimThreadTitle(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return CHAT_THREAD_TITLE_FALLBACK;
  return normalized.length > 48 ? `${normalized.slice(0, 48).trim()}...` : normalized;
}

function buildDefaultSystemPrompt(project) {
  const lines = [
    `Bạn là trợ lý AI cho dự án truyện "${project?.title || 'Chưa đặt tên'}".`,
    'Trả lời bằng tiếng Việt trừ khi người dùng yêu cầu ngôn ngữ khác.',
    'Nếu người dùng đang hỏi về truyện, hãy ưu tiên nhất quán với bối cảnh, nhân vật và định hướng hiện có của dự án.',
  ];

  if (project?.genre_primary) {
    lines.push(`Thể loại chính của dự án: ${project.genre_primary}.`);
  }

  if (project?.synopsis) {
    lines.push(`[Tóm tắt dự án]\n${project.synopsis}`);
  }

  if (project?.ultimate_goal) {
    lines.push(`[Đích đến dài hạn]\n${project.ultimate_goal}`);
  }

  if (project?.ai_guidelines) {
    lines.push(`[Chỉ dẫn AI của dự án]\n${project.ai_guidelines}`);
  }

  return lines.join('\n\n');
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

function getRoutePreview(provider, selectedModel) {
  return modelRouter.route(
    TASK_TYPES.FREE_PROMPT,
    selectedModel
      ? { providerOverride: provider, modelOverride: selectedModel }
      : { providerOverride: provider },
  );
}

function MessageBubble({ message, onCopy }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <article className={`project-chat-message ${isUser ? 'is-user' : ''} ${isAssistant ? 'is-assistant' : ''} ${message.is_partial ? 'is-partial' : ''}`}>
      <div className="project-chat-message__meta">
        <div className="project-chat-message__author">
          {isUser ? 'Bạn' : isAssistant ? 'AI' : 'Hệ thống'}
        </div>
        <div className="project-chat-message__tools">
          {message.model && (
            <span className="project-chat-message__chip">
              {message.provider === PROVIDERS.OLLAMA ? 'Local' : 'Cloud'} · {message.model}
            </span>
          )}
          {message.elapsed_ms ? (
            <span className="project-chat-message__chip">{(message.elapsed_ms / 1000).toFixed(1)}s</span>
          ) : null}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onCopy(message.content)} title="Sao chép nội dung">
            <Copy size={14} />
          </button>
        </div>
      </div>

      <div className="project-chat-message__content">
        {message.content}
      </div>
    </article>
  );
}

export default function ProjectChat() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { currentProject, loadProject } = useProjectStore();

  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [providerSnapshot, setProviderSnapshot] = useState(modelRouter.getPreferredProvider());
  const [qualitySnapshot, setQualitySnapshot] = useState(modelRouter.getQualityMode());

  const isHydratingThreadRef = useRef(false);
  const threadEndRef = useRef(null);
  const inputRef = useRef(null);
  const activeThread = useMemo(
    () => threads.find((thread) => String(thread.id) === String(activeThreadId)) || null,
    [threads, activeThreadId],
  );

  const routePreview = useMemo(
    () => getRoutePreview(providerSnapshot, activeThread?.model_override || ''),
    [activeThread?.model_override, providerSnapshot, qualitySnapshot],
  );
  const providerOptions = useMemo(
    () => getAvailableModelOptions(providerSnapshot),
    [providerSnapshot],
  );

  useEffect(() => {
    if (!projectId) return;
    if (!currentProject || String(currentProject.id) !== String(projectId)) {
      loadProject(Number(projectId)).catch(() => navigate('/'));
    }
  }, [currentProject, loadProject, navigate, projectId]);

  useEffect(() => {
    const syncRouterState = () => {
      setProviderSnapshot(modelRouter.getPreferredProvider());
      setQualitySnapshot(modelRouter.getQualityMode());
    };

    syncRouterState();
    window.addEventListener('focus', syncRouterState);
    return () => window.removeEventListener('focus', syncRouterState);
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    if (!currentProject?.id) return;

    let cancelled = false;

    async function loadThreads() {
      setIsLoadingThreads(true);
      const projectThreads = await db.ai_chat_threads.where('project_id').equals(currentProject.id).toArray();
      if (cancelled) return;

      if (projectThreads.length === 0) {
        const created = await createThread({ activate: true, project: currentProject });
        if (cancelled) return;
        setThreads([created]);
        setActiveThreadId(created.id);
      } else {
        const sorted = sortThreadsDesc(projectThreads);
        setThreads(sorted);
        setActiveThreadId((current) => {
          if (current && sorted.some((thread) => String(thread.id) === String(current))) {
            return current;
          }
          return sorted[0]?.id || null;
        });
      }

      setIsLoadingThreads(false);
    }

    loadThreads().catch((error) => {
      console.error('Failed to load AI chat threads:', error);
      setIsLoadingThreads(false);
      setErrorMessage('Không thể tải danh sách cuộc trò chuyện.');
    });

    return () => {
      cancelled = true;
    };
  }, [currentProject]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function loadThreadMessages() {
      setIsLoadingMessages(true);
      const threadMessages = await db.ai_chat_messages.where('thread_id').equals(Number(activeThreadId)).sortBy('created_at');
      if (cancelled) return;
      setMessages(threadMessages);
      setIsLoadingMessages(false);
    }

    loadThreadMessages().catch((error) => {
      console.error('Failed to load AI chat messages:', error);
      setIsLoadingMessages(false);
      setErrorMessage('Không thể tải nội dung cuộc trò chuyện.');
    });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThread) return undefined;
    if (isHydratingThreadRef.current) return undefined;

    const timeout = window.setTimeout(async () => {
      try {
        await db.ai_chat_threads.update(activeThread.id, {
          system_prompt: activeThread.system_prompt || '',
          model_override: activeThread.model_override || '',
        });
        setSaveStatus('Đã lưu cấu hình chat');
      } catch (error) {
        console.error('Failed to save AI chat thread config:', error);
        setErrorMessage('Không thể lưu cấu hình chat.');
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [activeThread?.id, activeThread?.system_prompt, activeThread?.model_override]);

  useEffect(() => {
    if (!saveStatus) return undefined;
    const timeout = window.setTimeout(() => setSaveStatus(''), 2000);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  async function createThread({ activate = true, project = currentProject } = {}) {
    const now = Date.now();
    const thread = {
      project_id: project.id,
      title: CHAT_THREAD_TITLE_FALLBACK,
      system_prompt: buildDefaultSystemPrompt(project),
      model_override: '',
      last_provider: '',
      last_model: '',
      created_at: now,
      updated_at: now,
    };
    const id = await db.ai_chat_threads.add(thread);
    const created = { ...thread, id };

    setThreads((prev) => sortThreadsDesc([created, ...prev]));
    if (activate) {
      setActiveThreadId(id);
      setMessages([]);
      setDraft('');
      setShowSystemPrompt(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
    return created;
  }

  function updateThreadLocally(threadId, patch) {
    setThreads((prev) => sortThreadsDesc(prev.map((thread) => (
      String(thread.id) === String(threadId)
        ? { ...thread, ...patch }
        : thread
    ))));
  }

  async function persistThreadUpdate(threadId, patch) {
    updateThreadLocally(threadId, patch);
    await db.ai_chat_threads.update(Number(threadId), patch);
  }

  async function handleDeleteThread(threadId) {
    const target = threads.find((thread) => String(thread.id) === String(threadId));
    if (!target) return;

    const confirmed = window.confirm(`Xóa cuộc trò chuyện "${target.title}"?`);
    if (!confirmed) return;

    await db.ai_chat_messages.where('thread_id').equals(Number(threadId)).delete();
    await db.ai_chat_threads.delete(Number(threadId));

    const remaining = threads.filter((thread) => String(thread.id) !== String(threadId));
    if (remaining.length === 0 && currentProject) {
      const created = await createThread({ activate: true, project: currentProject });
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
    const target = threads.find((thread) => String(thread.id) === String(threadId));
    if (!target) return;

    const nextTitle = window.prompt('Đổi tên cuộc trò chuyện', target.title || CHAT_THREAD_TITLE_FALLBACK);
    if (nextTitle == null) return;

    const normalized = trimThreadTitle(nextTitle);
    await persistThreadUpdate(threadId, { title: normalized });
  }

  async function handleClearMessages() {
    if (!activeThread) return;
    const confirmed = window.confirm('Xóa toàn bộ tin nhắn trong cuộc trò chuyện hiện tại?');
    if (!confirmed) return;

    await db.ai_chat_messages.where('thread_id').equals(Number(activeThread.id)).delete();
    setMessages([]);
    await persistThreadUpdate(activeThread.id, {
      title: activeThread.title || CHAT_THREAD_TITLE_FALLBACK,
      updated_at: Date.now(),
      last_model: '',
      last_provider: '',
    });
  }

  function buildConversationMessages(nextUserMessage) {
    const apiMessages = [];
    const systemPrompt = String(activeThread?.system_prompt || '').trim();
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }

    messages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .forEach((item) => {
        apiMessages.push({
          role: item.role,
          content: item.content,
        });
      });

    apiMessages.push({ role: 'user', content: nextUserMessage });
    return apiMessages;
  }

  async function appendMessage(threadId, message) {
    const payload = {
      project_id: currentProject.id,
      thread_id: Number(threadId),
      created_at: Date.now(),
      ...message,
    };
    const id = await db.ai_chat_messages.add(payload);
    return { ...payload, id };
  }

  async function sendMessage() {
    if (!activeThread || !currentProject || !draft.trim() || isStreaming) return;

    const userContent = draft.trim();
    const userMessage = await appendMessage(activeThread.id, {
      role: 'user',
      content: userContent,
    });

    setMessages((prev) => [...prev, userMessage]);
    setDraft('');
    setErrorMessage('');
    setIsStreaming(true);
    setStreamingText('');

    const shouldRename = !activeThread.title || activeThread.title === CHAT_THREAD_TITLE_FALLBACK;
    const provisionalTitle = shouldRename ? trimThreadTitle(userContent) : activeThread.title;
    const provisionalTimestamp = Date.now();

    updateThreadLocally(activeThread.id, {
      title: provisionalTitle,
      updated_at: provisionalTimestamp,
    });
    await db.ai_chat_threads.update(activeThread.id, {
      title: provisionalTitle,
      updated_at: provisionalTimestamp,
    });

    const routeOptions = activeThread.model_override
      ? { providerOverride: providerSnapshot, modelOverride: activeThread.model_override }
      : { providerOverride: providerSnapshot };

    aiService.send({
      taskType: TASK_TYPES.FREE_PROMPT,
      messages: buildConversationMessages(userContent),
      stream: true,
      routeOptions,
      onToken: (_chunk, full) => {
        setStreamingText(full);
      },
      onComplete: async (text, meta) => {
        const assistantMessage = await appendMessage(activeThread.id, {
          role: 'assistant',
          content: text,
          provider: meta?.provider || '',
          model: meta?.model || '',
          elapsed_ms: meta?.elapsed || null,
          is_partial: false,
        });

        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingText('');
        setIsStreaming(false);

        await persistThreadUpdate(activeThread.id, {
          title: provisionalTitle,
          updated_at: Date.now(),
          last_provider: meta?.provider || '',
          last_model: meta?.model || '',
        });
      },
      onError: (error) => {
        setIsStreaming(false);
        setStreamingText('');
        setErrorMessage(error?.userMessage || error?.message || 'AI không trả lời được cho yêu cầu này.');
      },
    });
  }

  async function handleStopStreaming() {
    aiService.abort();
    if (!isStreaming) return;

    let partialMessage = null;
    if (activeThread && streamingText.trim()) {
      partialMessage = await appendMessage(activeThread.id, {
        role: 'assistant',
        content: streamingText.trim(),
        provider: routePreview.provider,
        model: routePreview.model,
        elapsed_ms: null,
        is_partial: true,
      });
      setMessages((prev) => [...prev, partialMessage]);
      await persistThreadUpdate(activeThread.id, {
        updated_at: Date.now(),
        last_provider: routePreview.provider,
        last_model: routePreview.model,
      });
    }

    setIsStreaming(false);
    setStreamingText('');
    if (!partialMessage) {
      setErrorMessage('Đã dừng sinh nội dung.');
    }
  }

  function handleCopy(text) {
    navigator.clipboard.writeText(text || '').then(() => {
      setSaveStatus('Đã sao chép nội dung');
    }).catch(() => {
      setErrorMessage('Không thể sao chép vào clipboard.');
    });
  }

  if (!currentProject) {
    return (
      <div className="project-chat-empty card">
        <h2>Chưa có dự án</h2>
        <p>Quay lại Dashboard để chọn dự án trước khi mở Chat AI.</p>
      </div>
    );
  }

  return (
    <div className="project-chat-page">
      <aside className="project-chat-sidebar card">
        <div className="project-chat-sidebar__header">
          <div>
            <div className="project-chat-sidebar__kicker">Chat AI</div>
            <h1>Trò chuyện với AI</h1>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => createThread({ activate: true })}>
            <Plus size={14} /> Cuộc trò chuyện mới
          </button>
        </div>

        <div className="project-chat-sidebar__hint">
          Dùng chung provider, API key và routing model với toàn bộ dự án. Bạn chỉ đang chọn model cụ thể cho từng cuộc trò chuyện.
        </div>

        <div className="project-chat-thread-list">
          {isLoadingThreads ? (
            <div className="project-chat-thread-list__empty">Đang tải cuộc trò chuyện...</div>
          ) : threads.map((thread) => {
            const isActive = String(thread.id) === String(activeThreadId);
            return (
              <article
                key={thread.id}
                className={`project-chat-thread ${isActive ? 'is-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  isHydratingThreadRef.current = true;
                  setActiveThreadId(thread.id);
                  window.setTimeout(() => {
                    isHydratingThreadRef.current = false;
                  }, 0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    isHydratingThreadRef.current = true;
                    setActiveThreadId(thread.id);
                    window.setTimeout(() => {
                      isHydratingThreadRef.current = false;
                    }, 0);
                  }
                }}
              >
                <div className="project-chat-thread__main">
                  <div className="project-chat-thread__title">{thread.title || CHAT_THREAD_TITLE_FALLBACK}</div>
                  <div className="project-chat-thread__meta">
                    <span>{formatRelativeTime(thread.updated_at)}</span>
                    {thread.last_model ? <span>{thread.last_model}</span> : null}
                  </div>
                </div>
                <div className="project-chat-thread__actions">
                  <span className="project-chat-thread__icon"><MessageSquare size={14} /></span>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={(event) => { event.stopPropagation(); handleRenameThread(thread.id); }} title="Đổi tên">
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={(event) => { event.stopPropagation(); handleDeleteThread(thread.id); }} title="Xóa">
                    <Trash2 size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </aside>

      <section className="project-chat-main card">
        <header className="project-chat-topbar">
          <div>
            <div className="project-chat-topbar__kicker">Dự án hiện tại</div>
            <h2>{currentProject.title}</h2>
          </div>

          <div className="project-chat-topbar__controls">
            <div className="project-chat-topbar__control">
              <span className="project-chat-topbar__label">Provider</span>
              <div className="project-chat-topbar__value">{getProviderLabel(routePreview.provider)}</div>
            </div>

            <div className="project-chat-topbar__control">
              <span className="project-chat-topbar__label">Chất lượng</span>
              <div className="project-chat-topbar__value">{getQualityLabel(qualitySnapshot)}</div>
            </div>

            <label className="project-chat-topbar__control project-chat-topbar__control--wide">
              <span className="project-chat-topbar__label">Model cho chat này</span>
              {routePreview.provider === PROVIDERS.OLLAMA ? (
                <input
                  className="input"
                  value={activeThread?.model_override || ''}
                  onChange={(event) => updateThreadLocally(activeThread.id, { model_override: event.target.value })}
                  placeholder={routePreview.model || 'Nhập model Ollama'}
                  disabled={!activeThread}
                />
              ) : (
                <select
                  className="select"
                  value={activeThread?.model_override || ''}
                  onChange={(event) => updateThreadLocally(activeThread.id, { model_override: event.target.value })}
                  disabled={!activeThread}
                >
                  <option value="">Theo mặc định của app · {routePreview.model}</option>
                  {providerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} · {option.meta}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <button
              type="button"
              className={`btn btn-ghost btn-sm project-chat-settings-toggle ${showSystemPrompt ? 'is-open' : ''}`}
              onClick={() => setShowSystemPrompt((value) => !value)}
            >
              <Settings2 size={14} />
              System Prompt
              <ChevronDown size={14} />
            </button>
          </div>
        </header>

        {showSystemPrompt && activeThread && (
          <section className="project-chat-system-prompt">
            <div className="project-chat-system-prompt__header">
              <div>
                <h3>System Prompt của cuộc trò chuyện</h3>
                <p>
                  Prompt này được gửi ở vai trò <code>system</code> cho toàn bộ thread hiện tại. Thay đổi ở đây chỉ áp dụng cho cuộc trò chuyện đang mở.
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateThreadLocally(activeThread.id, { system_prompt: buildDefaultSystemPrompt(currentProject) })}>
                <Save size={14} /> Khôi phục mặc định
              </button>
            </div>
            <textarea
              className="textarea project-chat-system-prompt__textarea"
              rows={8}
              value={activeThread.system_prompt || ''}
              onChange={(event) => updateThreadLocally(activeThread.id, { system_prompt: event.target.value })}
              placeholder="Nhập system prompt riêng cho cuộc trò chuyện này..."
            />
          </section>
        )}

        <div className="project-chat-statusbar">
          <div className="project-chat-statusbar__item">
            <strong>Model hiệu lực:</strong> {routePreview.model}
          </div>
          <div className="project-chat-statusbar__item">
            <strong>Khóa/API:</strong> Dùng chung cấu hình hiện tại của app
          </div>
          {saveStatus ? (
            <div className="project-chat-statusbar__item project-chat-statusbar__item--success">
              <CheckCircle2 size={14} /> {saveStatus}
            </div>
          ) : null}
        </div>

        <div className="project-chat-messages">
          {(isLoadingMessages || isLoadingThreads) ? (
            <div className="project-chat-messages__empty">Đang tải nội dung cuộc trò chuyện...</div>
          ) : messages.length === 0 ? (
            <div className="project-chat-messages__empty">
              <Bot size={28} />
              <h3>Bắt đầu một cuộc trò chuyện mới</h3>
              <p>Trang này dùng đúng provider và API key mà dự án đang dùng. Bạn có thể chọn model riêng cho thread và chỉnh system prompt ngay phía trên.</p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} onCopy={handleCopy} />
            ))
          )}

          {isStreaming && (
            <article className="project-chat-message is-assistant is-streaming">
              <div className="project-chat-message__meta">
                <div className="project-chat-message__author">AI đang trả lời</div>
                <div className="project-chat-message__tools">
                  <span className="project-chat-message__chip">{routePreview.model}</span>
                </div>
              </div>
              <div className="project-chat-message__content">{streamingText || '...'}</div>
            </article>
          )}

          <div ref={threadEndRef} />
        </div>

        {errorMessage ? (
          <div className="project-chat-error">
            {errorMessage}
          </div>
        ) : null}

        <footer className="project-chat-composer">
          <div className="project-chat-composer__actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleClearMessages} disabled={!activeThread || messages.length === 0 || isStreaming}>
              <Trash2 size={14} /> Xóa hội thoại hiện tại
            </button>
          </div>

          <div className="project-chat-composer__input">
            <textarea
              ref={inputRef}
              className="textarea"
              rows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Nhập tin nhắn cho AI. Enter để gửi, Shift+Enter để xuống dòng."
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />

            <div className="project-chat-composer__submit">
              {isStreaming ? (
                <button type="button" className="btn btn-secondary" onClick={handleStopStreaming}>
                  <Square size={14} /> Dừng
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={sendMessage} disabled={!draft.trim() || !activeThread}>
                  <Send size={14} /> Gửi
                </button>
              )}
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
