/**
 * StoryForge — Batch AI Generation (Phase 3 Enhancement)
 * 
 * Context-aware batch entity generation.
 * AI reads existing outline + characters + world profile to generate
 * entities that FIT the story, not random ones.
 * 
 * Props:
 *   entityType: 'character' | 'location' | 'object' | 'term'
 *   projectContext: { projectTitle, genre, description }
 *   existingEntities: { characters, locations, objects, terms, chapters }
 *   onBatchCreated: (items[]) => void
 */

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Loader2, Check, RotateCcw, Trash2, Plus } from 'lucide-react';
import aiService from '../../services/ai/client';
import { TASK_TYPES } from '../../services/ai/router';
import { buildPrompt } from '../../services/ai/promptBuilder';
import { parseAIJsonValue, isPlainObject } from '../../utils/aiJson';
import './BatchGenerate.css';

const ENTITY_CONFIG = {
  character: {
    label: 'nhân vật',
    plural: 'nhân vật',
    defaultCount: 3,
    maxCount: 8,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng nhân vật cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện và nhân vật đã có, TẠO THÊM nhân vật mới PHÙ HỢP với mạch truyện.
Mỗi nhân vật phải có LÝ DO TỒN TẠI trong cốt truyện (không tạo random).

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","role":"protagonist|antagonist|supporting|mentor|minor","appearance":"2-3 câu","personality":"2-3 câu","goals":"mục tiêu","notes":"vai trò trong cốt truyện"}] }`,
  },
  location: {
    label: 'địa điểm',
    plural: 'địa điểm',
    defaultCount: 3,
    maxCount: 8,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện và thế giới đã có, TẠO THÊM địa điểm mới PHÙ HỢP với mạch truyện.
Mỗi địa điểm phải ĐÃ ĐƯỢC ĐỀ CẬP trong outline hoặc SẼ CẦN cho cốt truyện.

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","description":"mô tả 2-3 câu","details":"chi tiết kiến trúc, đặc điểm 2-3 câu"}] }`,
  },
  object: {
    label: 'vật phẩm',
    plural: 'vật phẩm',
    defaultCount: 3,
    maxCount: 6,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện, TẠO vật phẩm quan trọng cho câu chuyện.
Mỗi vật phẩm phải CÓ VAI TRÒ trong cốt truyện (chìa khóa giải quyết xung đột, nguồn sức mạnh, v.v.)

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","description":"mô tả 2-3 câu","properties":"thuộc tính, công dụng, hạn chế","owner":"tên nhân vật sở hữu (nếu có)"}] }`,
  },
  term: {
    label: 'thuật ngữ',
    plural: 'thuật ngữ',
    defaultCount: 4,
    maxCount: 10,
    prompt: (genre, ctx) => `Bạn là trợ lý xây dựng thế giới cho truyện thể loại ${genre || 'fantasy'}.

Thông tin truyện hiện tại:
${ctx}

Dựa trên cốt truyện và thế giới đã có, TẠO THÊM thuật ngữ/khái niệm PHÙ HỢP.
Mỗi thuật ngữ phải GIẢI THÍCH một khía cạnh của thế giới truyện.

Trả về CHÍNH XÁC JSON:
{ "items": [{"name":"...","definition":"định nghĩa 3-5 câu","category":"magic|organization|race|technology|concept|culture|other"}] }`,
  },
};

export default function BatchGenerate({
  entityType = 'character',
  projectContext = {},
  existingEntities = {},
  onBatchCreated,
  onClose,
}) {
  const [count, setCount] = useState(ENTITY_CONFIG[entityType]?.defaultCount || 3);
  const [customHint, setCustomHint] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [error, setError] = useState(null);

  const config = ENTITY_CONFIG[entityType];

  const resolvePromptTemplates = () => {
    if (!projectContext?.promptTemplates) return {};
    if (typeof projectContext.promptTemplates === 'string') {
      try { return JSON.parse(projectContext.promptTemplates); } catch { return {}; }
    }
    return typeof projectContext.promptTemplates === 'object' ? projectContext.promptTemplates : {};
  };

  // Build context string from existing story data
  const buildContext = () => {
    const parts = [];
    
    if (projectContext.projectTitle) {
      parts.push(`Tên truyện: ${projectContext.projectTitle}`);
    }
    if (projectContext.description) {
      parts.push(`Premise: ${projectContext.description}`);
    }

    // Existing characters
    if (existingEntities.characters?.length > 0) {
      const charList = existingEntities.characters
        .map(c => `- ${c.name} (${c.role})${c.goals ? ': ' + c.goals.substring(0, 50) : ''}`)
        .join('\n');
      parts.push(`Nhân vật đã có:\n${charList}`);
    }

    // Existing locations
    if (existingEntities.locations?.length > 0) {
      const locList = existingEntities.locations.map(l => `- ${l.name}`).join('\n');
      parts.push(`Địa điểm đã có:\n${locList}`);
    }

    // Existing terms
    if (existingEntities.terms?.length > 0) {
      const termList = existingEntities.terms.map(t => `- ${t.name}`).join('\n');
      parts.push(`Thuật ngữ đã có:\n${termList}`);
    }

    // Chapter outlines
    if (existingEntities.chapters?.length > 0) {
      const chapList = existingEntities.chapters
        .map((ch, i) => `${i + 1}. ${ch.title}`)
        .join('\n');
      parts.push(`Outline chương:\n${chapList}`);
    }

    // World profile
    if (projectContext.worldName) {
      parts.push(`Thế giới: ${projectContext.worldName}${projectContext.worldType ? ` (${projectContext.worldType})` : ''}`);
    }

    return parts.join('\n\n');
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setResults([]);
    setExcluded(new Set());

    const contextStr = buildContext();
    const characterSchemaHint = entityType === 'character'
      ? '\n\nBat buoc voi moi nhan vat: co truong "personality_tags" (chuoi tag ngan, phan tach bang dau phay) va truong "flaws" (diem yeu/khuyet diem ro rang). Khong tao nhan vat hoan hao.'
      : '';
    const systemPrompt = config.prompt(projectContext.genre, contextStr) + characterSchemaHint;
    const userHint = customHint.trim() 
      ? `\n\nYêu cầu bổ sung: ${customHint}\n\nTạo chính xác ${count} ${config.plural}.`
      : `\n\nTạo chính xác ${count} ${config.plural} phù hợp với cốt truyện trên.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Truyện: ${projectContext.projectTitle || 'Chưa đặt tên'}\nThể loại: ${projectContext.genre || 'fantasy'}${userHint}` },
    ];

    aiService.send({
      taskType: TASK_TYPES.AI_GENERATE_ENTITY,
      messages: buildPrompt(TASK_TYPES.AI_GENERATE_ENTITY, {
        projectTitle: projectContext.projectTitle || '',
        genre: projectContext.genre || '',
        promptTemplates: resolvePromptTemplates(),
        userPrompt: customHint.trim()
          ? `${customHint}\n\nTao chinh xac ${count} ${config.plural}.`
          : `Tao chinh xac ${count} ${config.plural} phu hop voi cot truyen tren.`,
        entityType,
        batchCount: count,
        entityContextText: contextStr,
      }),
      stream: false,
      onComplete: (text) => {
        setIsGenerating(false);
        try {
          const parsed = parseAIJsonValue(text);
          const items = Array.isArray(parsed)
            ? parsed
            : isPlainObject(parsed)
              ? parsed.items || parsed.characters || parsed.locations || parsed.terms || parsed.objects || []
              : [];
          setResults(Array.isArray(items) ? items : []);
        } catch (e) {
          console.error('[BatchGenerate] Parse error:', e, '\nRaw:', text);
          setError('Không parse được. Thử lại?');
        }
      },
      onError: (err) => {
        setIsGenerating(false);
        setError(err.message || 'Lỗi AI');
      },
    });
  };

  const toggleExclude = (idx) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleApprove = () => {
    const approved = results.filter((_, i) => !excluded.has(i));
    if (onBatchCreated) onBatchCreated(approved);
  };

  return (
    <div className="batch-gen">
      {/* Header */}
      <div className="batch-gen-header">
        <h4><Sparkles size={16} /> Tạo hàng loạt {config.plural}</h4>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Step 1: Config */}
      {results.length === 0 && !isGenerating && (
        <div className="batch-gen-config">
          <div className="batch-gen-row">
            <label>Số lượng:</label>
            <div className="batch-gen-count">
              <button className="btn btn-ghost btn-sm" onClick={() => setCount(Math.max(1, count - 1))}>−</button>
              <span className="batch-gen-count-value">{count}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setCount(Math.min(config.maxCount, count + 1))}>+</button>
            </div>
          </div>

          <div className="batch-gen-row">
            <label>Yêu cầu bổ sung (tùy chọn):</label>
            <textarea
              className="batch-gen-hint"
              placeholder={entityType === 'character' 
                ? 'Ví dụ: Tạo các thành viên của phe phản diện, có quan hệ quyền lực nội bộ...'
                : entityType === 'location'
                ? 'Ví dụ: Tạo các địa điểm cho arc chiến trường, từ biên cương đến kinh đô...'
                : entityType === 'term'
                ? 'Ví dụ: Tạo hệ thống cấp bậc tu luyện cho thế giới này...'
                : 'Ví dụ: Tạo vũ khí cho các nhân vật chính...'}
              value={customHint}
              onChange={e => setCustomHint(e.target.value)}
              rows={2}
            />
          </div>

          {/* Context preview */}
          <div className="batch-gen-context-preview">
            <span className="batch-gen-context-label">AI sẽ dựa trên:</span>
            <div className="batch-gen-context-tags">
              {existingEntities.chapters?.length > 0 && <span className="batch-tag">📋 {existingEntities.chapters.length} chương</span>}
              {existingEntities.characters?.length > 0 && <span className="batch-tag">👤 {existingEntities.characters.length} nhân vật</span>}
              {existingEntities.locations?.length > 0 && <span className="batch-tag">📍 {existingEntities.locations.length} địa điểm</span>}
              {existingEntities.terms?.length > 0 && <span className="batch-tag">📖 {existingEntities.terms.length} thuật ngữ</span>}
              {projectContext.worldName && <span className="batch-tag">🌍 {projectContext.worldName}</span>}
            </div>
          </div>

          {error && <div className="batch-gen-error">{error}</div>}

          <button className="btn btn-primary" onClick={handleGenerate} disabled={isGenerating}>
            <Sparkles size={15} /> Tạo {count} {config.plural}
          </button>
        </div>
      )}

      {/* Loading */}
      {isGenerating && (
        <div className="batch-gen-loading">
          <Loader2 size={32} className="spin" />
          <p>AI đang tạo {count} {config.plural} phù hợp cốt truyện...</p>
        </div>
      )}

      {/* Step 2: Review */}
      {results.length > 0 && (
        <div className="batch-gen-results">
          <p className="batch-gen-results-info">
            AI tạo {results.length} {config.plural} — bỏ tick để loại
          </p>

          <div className="batch-gen-items">
            {results.map((item, i) => (
              <div
                key={i}
                className={`batch-gen-item ${excluded.has(i) ? 'batch-gen-item--excluded' : ''}`}
                onClick={() => toggleExclude(i)}
              >
                <div className="batch-gen-item-header">
                  <span className="batch-gen-item-check">
                    {excluded.has(i) ? '☐' : '☑'}
                  </span>
                  <strong>{item.name}</strong>
                  {item.role && <span className="badge badge-sm">{item.role}</span>}
                  {item.category && <span className="badge badge-sm">{item.category}</span>}
                </div>
                <div className="batch-gen-item-body">
                  {item.personality && <p>{item.personality}</p>}
                  {item.personality_tags && <p><b>Tags:</b> {item.personality_tags}</p>}
                  {item.flaws && <p><b>Flaws:</b> {item.flaws}</p>}
                  {item.description && <p>{item.description}</p>}
                  {item.definition && <p>{item.definition}</p>}
                  {item.goals && <p><b>Mục tiêu:</b> {item.goals}</p>}
                  {item.notes && <p className="batch-gen-item-notes">{item.notes}</p>}
                  {item.details && <p className="batch-gen-item-notes">{item.details}</p>}
                  {item.properties && <p className="batch-gen-item-notes"><b>Thuộc tính:</b> {item.properties}</p>}
                  {item.owner && <p className="batch-gen-item-notes"><b>Chủ:</b> {item.owner}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="batch-gen-actions">
            <button className="btn btn-ghost" onClick={() => { setResults([]); setError(null); }}>
              <RotateCcw size={14} /> Tạo lại
            </button>
            <button
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={results.length === excluded.size}
            >
              <Check size={14} /> Thêm {results.length - excluded.size} {config.plural}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
