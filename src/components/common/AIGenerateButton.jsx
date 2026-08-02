/**
 * StoryForge - AI Generate Button (Reusable)
 *
 * A floating "Tạo bằng AI" button with:
 * - Prompt input popup
 * - AI request
 * - Preview -> Approve/Edit flow
 *
 * Props:
 *   entityType: 'character' | 'location' | 'object' | 'term'
 *   projectContext: { projectTitle, genre }
 *   canonRoleLocks?: [{ characterId, characterName, specificRole, locked }]
 *   onApprove: (data) => void
 *   buttonLabel?: string
 */

import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Loader2, Check, RotateCcw } from 'lucide-react';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { toVietnameseErrorMessage } from '../../utils/errorMessages';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import './AIGenerateButton.css';

const ENTITY_PROMPTS = {
  character: {
    placeholder: 'Ví dụ: Nữ sát thủ lạnh lùng, 20 tuổi; hoặc tiền bối ngoại hình đôi mươi...',
  },
  location: {
    placeholder: 'Ví dụ: Tòa thành cổ trên đỉnh núi, bao quanh bởi sương mù...',
  },
  object: {
    placeholder: 'Ví dụ: Thanh kiếm cổ phát sáng trong bóng tối, có ý chí riêng...',
  },
  term: {
    placeholder: 'Ví dụ: Năng lượng phép thuật, hệ thống cấp bậc tu luyện...',
  },
};

const ENTITY_LABELS = {
  character: 'nhân vật',
  location: 'địa điểm',
  object: 'vật phẩm',
  term: 'thuật ngữ',
};

export default function AIGenerateButton({
  entityType,
  projectContext = {},
  canonRoleLocks = [],
  onApprove,
  buttonLabel,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const popupId = useId();
  const headingId = `${popupId}-heading`;

  const config = ENTITY_PROMPTS[entityType] || ENTITY_PROMPTS.character;
  const label = ENTITY_LABELS[entityType] || 'mục';
  const resolvedCanonRoleLocks = Array.isArray(canonRoleLocks)
    ? canonRoleLocks
    : (Array.isArray(projectContext?.canonRoleLocks) ? projectContext.canonRoleLocks : []);

  const resolvePromptTemplates = () => {
    if (!projectContext?.promptTemplates) return {};
    if (typeof projectContext.promptTemplates === 'string') {
      try { return JSON.parse(projectContext.promptTemplates); } catch { return {}; }
    }
    return typeof projectContext.promptTemplates === 'object' ? projectContext.promptTemplates : {};
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const popup = popupRef.current;

    const handler = (e) => {
      if (popupRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    const preventScrollChain = (e) => {
      const preview = e.target instanceof Element
        ? e.target.closest('.ai-gen-preview')
        : null;

      if (!preview) {
        e.preventDefault();
        return;
      }

      if (e.type !== 'wheel') return;
      const canScrollUp = preview.scrollTop > 0;
      const canScrollDown = preview.scrollTop + preview.clientHeight < preview.scrollHeight;
      if ((e.deltaY < 0 && !canScrollUp) || (e.deltaY > 0 && !canScrollDown)) {
        e.preventDefault();
      }
    };

    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKeyDown);
    popup?.addEventListener('wheel', preventScrollChain, { passive: false });
    popup?.addEventListener('touchmove', preventScrollChain, { passive: false });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKeyDown);
      popup?.removeEventListener('wheel', preventScrollChain);
      popup?.removeEventListener('touchmove', preventScrollChain);
    };
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);
    setResult(null);

    const messages = buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
      projectTitle: projectContext.projectTitle || '',
      genre: projectContext.genre || '',
      promptTemplates: resolvePromptTemplates(),
      userPrompt: prompt,
      entityType,
      batchCount: 1,
      canonRoleLocks: resolvedCanonRoleLocks,
      entityContextText: projectContext.description || projectContext.worldName || '',
    });

    aiService.send({
      taskType: TASK_TYPES.AI_GENERATE_ENTITY,
      messages,
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          const parsedValue = parseAIJsonValue(text);
          const nextResult = Array.isArray(parsedValue)
            ? (parsedValue.length === 1 && isPlainObject(parsedValue[0]) ? parsedValue[0] : null)
            : (isPlainObject(parsedValue) ? parsedValue : null);

          if (!nextResult) {
            setError('AI trả về sai định dạng cho một mục đơn. Thử lại?');
            return;
          }

          setResult(nextResult);
        } catch (e) {
          console.error('[AIGenerate] Parse error:', e, '\nRaw text:', text);
          setError('Không parse được kết quả. Thử lại?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(toVietnameseErrorMessage(err, 'Lỗi kết nối AI'));
      },
    });
  };

  const handleApprove = () => {
    if (result && onApprove) {
      onApprove(result);
    }

    setIsOpen(false);
    setResult(null);
    setPrompt('');
  };

  const handleRetry = () => {
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    setResult(null);
    setPrompt('');
    setError(null);
    setIsGenerating(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="ai-gen-wrapper">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-accent btn-sm ai-gen-trigger"
        onClick={() => setIsOpen((current) => !current)}
        title={`Tạo ${label} bằng AI`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popupId : undefined}
      >
        <Sparkles size={14} />
        {buttonLabel || `AI tạo ${label}`}
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="ai-gen-popup"
          id={popupId}
          ref={popupRef}
          role="dialog"
          aria-labelledby={headingId}
        >
          <div className="ai-gen-popup-header">
            <h4 id={headingId}><Sparkles size={14} /> Tạo {label} bằng AI</h4>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={handleClose} aria-label="Đóng">
              <X size={16} />
            </button>
          </div>

          {!result && !error && (
            <div className="ai-gen-popup-body">
              <textarea
                className="ai-gen-input"
                placeholder={config.placeholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                disabled={isGenerating}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm ai-gen-submit"
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
              >
                {isGenerating ? (
                  <><Loader2 size={14} className="spin" /> Đang tạo...</>
                ) : (
                  <><Sparkles size={14} /> Tạo</>
                )}
              </button>
            </div>
          )}

          {error && (
            <div className="ai-gen-popup-body">
              <div className="ai-gen-error">{error}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleRetry}>
                <RotateCcw size={14} /> Thử lại
              </button>
            </div>
          )}

          {result && (
            <div className="ai-gen-popup-body">
              <div className="ai-gen-preview">
                {Object.entries(result).map(([key, value]) => (
                  <div key={key} className="ai-gen-preview-field">
                    <span className="ai-gen-preview-label">{key}</span>
                    <span className="ai-gen-preview-value">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="ai-gen-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleRetry}>
                  <RotateCcw size={14} /> Tạo lại
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleApprove}>
                  <Check size={14} /> Dùng kết quả
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
