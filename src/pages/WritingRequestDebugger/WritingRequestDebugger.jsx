import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clipboard,
  Eye,
  FileJson,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import '../Settings/Settings.css';
import './WritingRequestDebugger.css';
import useProjectStore from '../../stores/projectStore';
import aiService from '../../services/ai/client';
import modelRouter from '../../services/ai/router';
import {
  buildWritingDebugPayload,
  getWritingDebugTaskConfig,
  WRITING_DEBUG_TASKS,
} from '../../services/ai/writingRequestDebugger';
import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';
import AutoResizeTextarea from '../../components/common/AutoResizeTextarea.jsx';

const VIEW_TABS = [
  { id: 'system', label: 'System prompt' },
  { id: 'user', label: 'User prompt' },
  { id: 'messages', label: 'Messages JSON' },
  { id: 'context', label: 'Context' },
  { id: 'response', label: 'AI trả về' },
];

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0));
}

function summarizeRoute(route) {
  if (!route) return 'Chưa gửi';
  return `${route.provider || 'provider'} · ${route.model || 'model'}`;
}

function previewText(value, limit = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Trống';
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
}

function DebugStat({ label, value }) {
  return (
    <div className="writing-debug-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PromptViewer({ activeTab, payload, responseText }) {
  if (!payload) {
    return (
      <div className="writing-debug-empty">
        <Eye size={18} />
        <p>Bấm “Dựng prompt” để xem request mà luồng viết sẽ gửi.</p>
      </div>
    );
  }

  if (activeTab === 'system') return <pre>{payload.systemPrompt}</pre>;
  if (activeTab === 'user') return <pre>{payload.userContent}</pre>;
  if (activeTab === 'messages') return <pre>{JSON.stringify(payload.messages, null, 2)}</pre>;
  if (activeTab === 'context') return <pre>{JSON.stringify(payload.enrichedContext, null, 2)}</pre>;
  return <pre>{responseText || 'Chưa có phản hồi AI.'}</pre>;
}

export default function WritingRequestDebugger() {
  const {
    currentProject,
    chapters,
    scenes,
    activeChapterId,
    activeSceneId,
  } = useProjectStore();
  const abortRef = useRef(null);

  const [taskId, setTaskId] = useState('free_prompt');
  const [chapterId, setChapterId] = useState(() => activeChapterId || '');
  const [sceneId, setSceneId] = useState(() => activeSceneId || '');
  const [userPrompt, setUserPrompt] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [payload, setPayload] = useState(null);
  const [activeTab, setActiveTab] = useState('system');
  const [responseText, setResponseText] = useState('');
  const [debugError, setDebugError] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(null);
  const [copiedTab, setCopiedTab] = useState('');

  const effectiveChapterId = chapterId || activeChapterId || chapters[0]?.id || '';
  const availableScenes = useMemo(() => (
    scenes
      .filter((scene) => String(scene.chapter_id) === String(effectiveChapterId))
      .slice()
      .sort((left, right) => Number(left.order_index || 0) - Number(right.order_index || 0))
  ), [scenes, effectiveChapterId]);
  const sceneIdInChapter = availableScenes.some((scene) => String(scene.id) === String(sceneId));
  const activeSceneInChapter = availableScenes.some((scene) => String(scene.id) === String(activeSceneId));
  const effectiveSceneId = sceneIdInChapter
    ? sceneId
    : activeSceneInChapter
      ? activeSceneId
      : availableScenes[0]?.id || '';
  const taskConfig = getWritingDebugTaskConfig(taskId);
  const selectedScene = useMemo(
    () => scenes.find((scene) => String(scene.id) === String(effectiveSceneId)) || null,
    [scenes, effectiveSceneId],
  );
  const scenePlainPreview = useMemo(
    () => previewText((selectedScene?.draft_text || selectedScene?.final_text || '').replace(/<[^>]*>/g, ' '), 260),
    [selectedScene],
  );

  const buildPayload = async () => {
    if (!currentProject || isBuilding) return null;
    setIsBuilding(true);
    setDebugError('');
    try {
      const nextPayload = await buildWritingDebugPayload({
        taskId,
        project: currentProject,
        chapters,
        scenes,
        chapterId: effectiveChapterId,
        sceneId: effectiveSceneId,
        selectedText,
        userPrompt,
      });
      setPayload(nextPayload);
      return nextPayload;
    } catch (error) {
      setDebugError(toVietnameseErrorMessage(error, 'Không dựng được prompt debug.'));
      return null;
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSend = async () => {
    if (isSending) return;
    const nextPayload = await buildPayload();
    if (!nextPayload) return;
    if (nextPayload.blockingIssues?.length > 0) {
      setDebugError(nextPayload.blockingIssues.map((issue) => issue.message).join(' '));
      setActiveTab('context');
      return;
    }

    setResponseText('');
    setDebugError('');
    setElapsedMs(null);
    setIsSending(true);
    setActiveTab('response');
    aiService.setRouter(modelRouter);

    const { abort, routeInfo: initialRoute } = aiService.send({
      taskType: nextPayload.taskType,
      messages: nextPayload.messages,
      stream: true,
      allowConcurrent: true,
      nsfwMode: !!nextPayload.enrichedContext.nsfwMode,
      superNsfwMode: !!nextPayload.enrichedContext.superNsfwMode,
      onRouteChange: (nextRoute) => setRouteInfo(nextRoute),
      onToken: (_chunk, fullText) => setResponseText(fullText || ''),
      onComplete: (text, meta) => {
        setResponseText(text || '');
        setRouteInfo(meta || initialRoute);
        setElapsedMs(meta?.elapsed || null);
        setIsSending(false);
        abortRef.current = null;
      },
      onError: (error) => {
        setDebugError(toVietnameseErrorMessage(error?.userMessage || error, 'AI không trả lời được request debug.'));
        setIsSending(false);
        abortRef.current = null;
      },
    });

    abortRef.current = abort;
    setRouteInfo(initialRoute);
  };

  const handleAbort = () => {
    abortRef.current?.();
    abortRef.current = null;
    setIsSending(false);
  };

  const handleCopyActiveTab = async () => {
    const source = activeTab === 'system'
      ? payload?.systemPrompt
      : activeTab === 'user'
        ? payload?.userContent
        : activeTab === 'messages'
          ? JSON.stringify(payload?.messages || [], null, 2)
          : activeTab === 'context'
            ? JSON.stringify(payload?.enrichedContext || {}, null, 2)
            : responseText;
    if (!source) return;
    await navigator.clipboard.writeText(source);
    setCopiedTab(activeTab);
    window.setTimeout(() => setCopiedTab(''), 1200);
  };

  if (!currentProject) {
    return (
      <div className="settings-page writing-debug-page">
        <div className="writing-debug-empty card">
          <AlertCircle size={18} />
          <p>Hãy mở một truyện trước khi test prompt viết.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page writing-debug-page">
      <header className="settings-header animate-fade-in writing-debug-header">
        <div>
          <h1 className="settings-title">Test luồng viết</h1>
          <p className="settings-subtitle">
            Dựng và gửi request giống luồng viết trong editor để xem system prompt, user prompt, messages JSON, context và phản hồi AI.
          </p>
        </div>
        <div className="writing-debug-header__actions">
          <button type="button" className="btn btn-secondary" onClick={buildPayload} disabled={isBuilding || isSending}>
            {isBuilding ? <Loader2 size={14} className="animate-spin" /> : <FileJson size={14} />}
            Dựng prompt
          </button>
          {isSending ? (
            <button type="button" className="btn btn-ghost" onClick={handleAbort}>
              <Square size={14} /> Dừng
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleSend} disabled={isBuilding}>
              <Play size={14} /> Gửi AI
            </button>
          )}
        </div>
      </header>

      <section className="settings-section card animate-slide-up writing-debug-controls">
        <div className="settings-section-header">
          <Bot size={20} />
          <div>
            <h2>Input test</h2>
            <p>Chọn đúng task, chương, cảnh và nhập yêu cầu giống lúc dùng panel viết truyện.</p>
          </div>
        </div>

        <div className="writing-debug-control-grid">
          <label>
            <span>Loại yêu cầu</span>
            <select className="select" value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              {WRITING_DEBUG_TASKS.map((task) => (
                <option key={task.id} value={task.id}>{task.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Chương</span>
            <select className="select" value={String(effectiveChapterId)} onChange={(event) => {
              setChapterId(event.target.value);
              const firstScene = scenes.find((scene) => String(scene.chapter_id) === String(event.target.value));
              setSceneId(firstScene?.id || '');
            }}>
              {chapters.map((chapter, index) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title || `Chương ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Cảnh</span>
            <select className="select" value={String(effectiveSceneId)} onChange={(event) => setSceneId(event.target.value)}>
              {availableScenes.map((scene, index) => (
                <option key={scene.id} value={scene.id}>
                  {scene.title || `Cảnh ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="writing-debug-task-note">
          <strong>{taskConfig.label}</strong>
          <p>{taskConfig.description}</p>
        </div>

        <label className="writing-debug-field">
          <span>Yêu cầu / chỉ dẫn thêm</span>
          <AutoResizeTextarea
            className="textarea writing-debug-prompt-textarea"
            rows={5}
            value={userPrompt}
            onChange={(event) => setUserPrompt(event.target.value)}
            placeholder="Ví dụ: viết chương này theo dàn ý sau, thêm nội tâm, giữ nhịp nhanh, không đổi POV..."
          />
        </label>

        <label className="writing-debug-field">
          <span>Đoạn chọn thủ công cho Viết lại / Mở rộng</span>
          <AutoResizeTextarea
            className="textarea writing-debug-prompt-textarea"
            rows={5}
            value={selectedText}
            onChange={(event) => setSelectedText(event.target.value)}
            placeholder="Nếu để trống, Viết lại/Mở rộng sẽ dùng toàn bộ nội dung cảnh giống fallback của panel viết."
          />
        </label>

        <div className="writing-debug-scene-preview">
          <span>Nội dung cảnh đang dùng</span>
          <p>{scenePlainPreview}</p>
        </div>
      </section>

      <section className="settings-section card animate-slide-up writing-debug-summary">
        <DebugStat label="Route AI" value={summarizeRoute(routeInfo)} />
        <DebugStat label="System prompt" value={`${formatNumber(payload?.summary?.systemChars || 0)} ký tự`} />
        <DebugStat label="User prompt" value={`${formatNumber(payload?.summary?.userChars || 0)} ký tự`} />
        <DebugStat label="Cảnh hiện tại" value={`${formatNumber(payload?.summary?.currentSceneChars || 0)} ký tự`} />
        <DebugStat
          label="Bộ nhớ chương cũ"
          value={`${formatNumber(payload?.summary?.recentChapterCount || 0)} chương · ${formatNumber(payload?.summary?.recentChapterProseChars || 0)} ký tự nguyên văn`}
        />
        <DebugStat label="Chế độ memory" value={payload?.summary?.retrievalMode || 'Chưa dựng'} />
        <DebugStat label="Messages" value={formatNumber(payload?.summary?.messageCount || 0)} />
        <DebugStat label="Runtime block" value={payload?.summary?.hasProjectStyleRuntime ? 'Có' : 'Không'} />
        <DebugStat label="Thời gian" value={elapsedMs ? `${(elapsedMs / 1000).toFixed(1)}s` : 'Chưa có'} />
      </section>

      {(debugError || payload?.warnings?.length > 0) && (
        <section className="writing-debug-alerts">
          {debugError && (
            <div className="writing-debug-alert is-error">
              <AlertCircle size={15} />
              {debugError}
            </div>
          )}
          {payload?.warnings?.map((warning) => (
            <div key={warning} className="writing-debug-alert is-warning">
              <AlertCircle size={15} />
              {warning}
            </div>
          ))}
        </section>
      )}

      <section className="settings-section card animate-slide-up writing-debug-viewer">
        <div className="writing-debug-viewer__header">
          <div className="writing-debug-tabs">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`writing-debug-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopyActiveTab} disabled={!payload && activeTab !== 'response'}>
            {copiedTab === activeTab ? <CheckCircle2 size={14} /> : <Clipboard size={14} />}
            {copiedTab === activeTab ? 'Đã chép' : 'Sao chép tab'}
          </button>
        </div>
        <div className="writing-debug-pre">
          <PromptViewer activeTab={activeTab} payload={payload} responseText={responseText} />
        </div>
      </section>
    </div>
  );
}
