/**
 * StoryForge — AI Generate Button (Reusable)
 * 
 * A floating "✨ Tạo bằng AI" button with:
 * - Prompt input popup
 * - AI streaming call
 * - Preview → Approve/Edit flow
 * 
 * Props:
 *   entityType: 'character' | 'location' | 'object' | 'term'
 *   projectContext: { projectTitle, genre }
 *   onApprove: (data) => void — called with parsed entity data
 *   buttonLabel?: string
 */

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Loader2, Check, RotateCcw } from 'lucide-react';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import modelRouter from '../../services/ai/router';
import keyManager from '../../services/ai/keyManager';
import './AIGenerateButton.css';

const ENTITY_PROMPTS = {
  character: {
    placeholder: 'Ví dụ: Nữ sát thủ lạnh lùng, 20 tuổi, có bí mật đen tối...',
    systemPrompt: (genre) => `Bạn là trợ lý tạo nhân vật cho truyện thể loại ${genre || 'fantasy'}.
Dựa trên mô tả của tác giả, tạo 1 nhân vật chi tiết.
Trả về CHÍNH XÁC JSON (không thêm gì khác):
{
  "name": "Tên nhân vật",
  "role": "protagonist|antagonist|supporting|mentor|minor",
  "appearance": "Mô tả ngoại hình 2-3 câu",
  "personality": "Mô tả tính cách 2-3 câu",
  "goals": "Mục tiêu chính",
  "secrets": "Bí mật (nếu có)",
  "notes": "Ghi chú thêm"
}`,
  },
  location: {
    placeholder: 'Ví dụ: Tòa thành cổ trên đỉnh núi, bao quanh bởi sương mù...',
    systemPrompt: (genre) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.
Dựa trên mô tả, tạo 1 địa điểm chi tiết.
Trả về CHÍNH XÁC JSON:
{
  "name": "Tên địa điểm",
  "description": "Mô tả tổng quan 2-3 câu",
  "details": "Chi tiết bổ sung: kiến trúc, đặc điểm nổi bật, bí mật..."
}`,
  },
  object: {
    placeholder: 'Ví dụ: Thanh kiếm cổ phát sáng trong bóng tối, có ý chí riêng...',
    systemPrompt: (genre) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.
Dựa trên mô tả, tạo 1 vật phẩm chi tiết.
Trả về CHÍNH XÁC JSON:
{
  "name": "Tên vật phẩm",
  "description": "Mô tả ngoại hình và lịch sử 2-3 câu",
  "properties": "Thuộc tính đặc biệt, công dụng, hạn chế..."
}`,
  },
  term: {
    placeholder: 'Ví dụ: Năng lượng phép thuật, hệ thống cấp bậc tu luyện...',
    systemPrompt: (genre) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.
Dựa trên mô tả, tạo 1 thuật ngữ/khái niệm chi tiết.
Trả về CHÍNH XÁC JSON:
{
  "name": "Tên thuật ngữ",
  "definition": "Định nghĩa chi tiết 3-5 câu",
  "category": "magic|organization|race|technology|other"
}`,
  },
};

// Labels
const ENTITY_LABELS = {
  character: 'nhân vật',
  location: 'địa điểm',
  object: 'vật phẩm',
  term: 'thuật ngữ',
};

export default function AIGenerateButton({ entityType, projectContext = {}, onApprove, buttonLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const popupRef = useRef(null);

  const config = ENTITY_PROMPTS[entityType] || ENTITY_PROMPTS.character;
  const label = ENTITY_LABELS[entityType] || 'mục';

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    setResult(null);

    const messages = [
      { role: 'system', content: config.systemPrompt(projectContext.genre) },
      { role: 'user', content: `Truyện: ${projectContext.projectTitle || 'Chưa đặt tên'}\n\nYêu cầu: ${prompt}` },
    ];

    aiService.send({
      taskType: TASK_TYPES.AI_GENERATE_ENTITY,
      messages,
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          // Clean up AI response: remove markdown code blocks, trim
          let cleaned = text
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .trim();

          // Extract JSON by finding balanced braces
          const startIdx = cleaned.indexOf('{');
          if (startIdx === -1) {
            setError('AI không trả về JSON. Thử lại?');
            return;
          }

          let depth = 0;
          let endIdx = -1;
          for (let i = startIdx; i < cleaned.length; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') {
              depth--;
              if (depth === 0) { endIdx = i; break; }
            }
          }

          if (endIdx === -1) {
            setError('JSON không đầy đủ. Thử lại?');
            return;
          }

          const jsonStr = cleaned.substring(startIdx, endIdx + 1);
          const parsed = JSON.parse(jsonStr);
          setResult(parsed);
        } catch (e) {
          console.error('[AIGenerate] Parse error:', e, '\nRaw text:', text);
          setError('Không parse được kết quả. Thử lại?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(err.message || 'Lỗi kết nối AI');
      },
    });
  };

  const handleApprove = () => {
    if (result && onApprove) {
      onApprove(result);
    }
    // Reset
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
  };

  return (
    <div className="ai-gen-wrapper">
      <button
        className="btn btn-accent btn-sm ai-gen-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`Tạo ${label} bằng AI`}
      >
        <Sparkles size={14} />
        {buttonLabel || `AI tạo ${label}`}
      </button>

      {isOpen && (
        <div className="ai-gen-popup" ref={popupRef}>
          <div className="ai-gen-popup-header">
            <h4><Sparkles size={14} /> Tạo {label} bằng AI</h4>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleClose}>
              <X size={16} />
            </button>
          </div>

          {/* Input phase */}
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

          {/* Error */}
          {error && (
            <div className="ai-gen-popup-body">
              <div className="ai-gen-error">{error}</div>
              <button className="btn btn-ghost btn-sm" onClick={handleRetry}>
                <RotateCcw size={14} /> Thử lại
              </button>
            </div>
          )}

          {/* Preview result */}
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
                <button className="btn btn-ghost btn-sm" onClick={handleRetry}>
                  <RotateCcw size={14} /> Tạo lại
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleApprove}>
                  <Check size={14} /> Dùng kết quả
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
