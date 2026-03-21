import React, { useState, useRef, useEffect } from 'react';
import useAIStore from '../../stores/aiStore';
import useProjectStore from '../../stores/projectStore';
import CodexPanel from '../editor/CodexPanel';
import {
  PenTool, RefreshCw, Maximize2, Lightbulb, Map, Sparkles,
  Send, Square, Copy, Check, ChevronDown, Zap, Gauge, Crown,
  Trash2, ArrowDownToLine, X,
} from 'lucide-react';
import './AISidebar.css';

const QUICK_ACTIONS = [
  { id: 'continue', icon: PenTool, label: 'Viết tiếp', taskFn: 'continueWriting', needsText: true },
  { id: 'rewrite', icon: RefreshCw, label: 'Viết lại', taskFn: 'rewriteText', needsSelection: true },
  { id: 'expand', icon: Maximize2, label: 'Mở rộng', taskFn: 'expandText', needsSelection: true },
  { id: 'plot', icon: Lightbulb, label: 'Gợi ý plot', taskFn: 'suggestPlot', needsText: true },
  { id: 'outline', icon: Map, label: 'Outline', taskFn: 'outlineChapter', needsText: false },
  { id: 'extract', icon: Sparkles, label: 'Trích xuất', taskFn: 'extractTerms', needsText: true },
];

const QUALITY_OPTIONS = [
  { value: 'fast', icon: Zap, label: 'Nhanh', desc: 'Flash models' },
  { value: 'balanced', icon: Gauge, label: 'Cân bằng', desc: 'Mặc định' },
  { value: 'best', icon: Crown, label: 'Tốt nhất', desc: 'Pro models' },
];

export default function AISidebar({ editor }) {
  const {
    isStreaming, streamingText, completedText, error,
    lastRouteInfo, lastElapsed, qualityMode,
    abort, clearOutput, setQualityMode,
    continueWriting, rewriteText, expandText,
    suggestPlot, outlineChapter, extractTerms, freePrompt,
  } = useAIStore();

  const { currentProject, scenes, activeSceneId, chapters, activeChapterId } = useProjectStore();

  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const outputRef = useRef(null);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingText, completedText]);

  const getContext = () => {
    const scene = scenes.find(s => s.id === activeSceneId);
    const chapter = chapters.find(c => c.id === activeChapterId);
    const selectedText = editor?.state?.selection?.empty
      ? ''
      : editor?.state?.doc?.textBetween(
          editor.state.selection.from,
          editor.state.selection.to,
          ' '
        ) || '';

    return {
      selectedText,
      sceneText: scene?.draft_text?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim() || '',
      sceneTitle: scene?.title || '',
      chapterTitle: chapter?.title || '',
      projectTitle: currentProject?.title || '',
      genre: currentProject?.genre_primary || '',
      // Phase 3: Context Engine needs these
      projectId: currentProject?.id || null,
      chapterId: activeChapterId || null,
      chapterIndex: chapter ? chapters.indexOf(chapter) : 0,
    };
  };

  const handleQuickAction = (action) => {
    const ctx = getContext();

    // Validate
    if (action.needsSelection && !ctx.selectedText) {
      // Fallback to full scene text
      ctx.selectedText = ctx.sceneText;
    }
    if (action.needsText && !ctx.sceneText && !ctx.selectedText) {
      return; // Nothing to work with
    }

    const taskFns = { continueWriting, rewriteText, expandText, suggestPlot, outlineChapter, extractTerms };
    const fn = taskFns[action.taskFn];
    if (fn) fn(ctx);
  };

  const handleFreePrompt = (e) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    const ctx = getContext();
    ctx.userPrompt = customPrompt.trim();
    freePrompt(ctx);
    setCustomPrompt('');
  };

  const handleCopy = () => {
    const text = completedText || streamingText;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleApplyToEditor = () => {
    const text = completedText || streamingText;
    if (text && editor) {
      editor.chain().focus().insertContent(text).run();
      clearOutput();
    }
  };

  const displayText = streamingText || completedText;
  const hasOutput = !!displayText || !!error;

  // Get current scene text for Codex Panel
  const currentSceneText = (() => {
    const scene = scenes.find(s => s.id === activeSceneId);
    return scene?.draft_text || '';
  })();

  return (
    <div className="ai-sidebar">
      {/* Codex Panel — real-time entity detection */}
      <CodexPanel sceneText={currentSceneText} />

      {/* Header */}
      <div className="ai-sidebar-header">
        <span className="ai-sidebar-title">🤖 AI Assistant</span>
        <div className="ai-sidebar-quality" onClick={() => setShowQuality(!showQuality)}>
          {React.createElement(QUALITY_OPTIONS.find(q => q.value === qualityMode)?.icon || Gauge, { size: 14 })}
          <span>{QUALITY_OPTIONS.find(q => q.value === qualityMode)?.label}</span>
          <ChevronDown size={12} />

          {showQuality && (
            <div className="quality-dropdown">
              {QUALITY_OPTIONS.map(q => (
                <button
                  key={q.value}
                  className={`quality-option ${qualityMode === q.value ? 'quality-option--active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setQualityMode(q.value);
                    setShowQuality(false);
                  }}
                >
                  <q.icon size={14} />
                  <div>
                    <div className="quality-option-label">{q.label}</div>
                    <div className="quality-option-desc">{q.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="ai-quick-actions">
        {QUICK_ACTIONS.map(action => (
          <button
            key={action.id}
            className="ai-action-btn"
            onClick={() => handleQuickAction(action)}
            disabled={isStreaming}
            title={action.label}
          >
            <action.icon size={15} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Output */}
      {hasOutput && (
        <div className="ai-output-area">
          <div className="ai-output-header">
            <span className="ai-output-label">
              {isStreaming ? (
                <><span className="ai-streaming-dot" /> Đang viết...</>
              ) : error ? (
                'Lỗi'
              ) : (
                'Kết quả'
              )}
            </span>
            <div className="ai-output-actions">
              {!isStreaming && displayText && (
                <>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCopy} title="Copy">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={handleApplyToEditor} title="Chèn vào editor">
                    <ArrowDownToLine size={14} />
                  </button>
                </>
              )}
              {isStreaming ? (
                <button className="btn btn-danger btn-sm" onClick={abort}>
                  <Square size={12} /> Dừng
                </button>
              ) : (
                <button className="btn btn-ghost btn-icon btn-sm" onClick={clearOutput} title="Xoá">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="ai-output-content" ref={outputRef}>
            {error ? (
              <div className="ai-output-error">{error}</div>
            ) : (
              <div className="ai-output-text">{displayText}
                {isStreaming && <span className="ai-cursor">|</span>}
              </div>
            )}
          </div>

          {/* Meta info */}
          {lastRouteInfo && !isStreaming && !error && (
            <div className="ai-output-meta">
              <span>{lastRouteInfo.provider === 'ollama' ? '🏠' : '☁️'} {lastRouteInfo.model}</span>
              {lastElapsed && <span>· {(lastElapsed / 1000).toFixed(1)}s</span>}
            </div>
          )}
        </div>
      )}

      {/* Free Prompt */}
      <form className="ai-free-prompt" onSubmit={handleFreePrompt}>
        <textarea
          className="ai-prompt-input"
          placeholder="Nhập yêu cầu tự do..."
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleFreePrompt(e);
            }
          }}
          rows={2}
          disabled={isStreaming}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm ai-send-btn"
          disabled={isStreaming || !customPrompt.trim()}
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
