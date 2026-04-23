import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  getProjectContentModeMeta,
  PROJECT_CONTENT_MODE_OPTIONS,
} from './projectContentMode';
import './ProjectContentModeControl.css';

const SURFACE_COPY = {
  prompt: {
    title: 'Chế độ nội dung',
    description: 'Đây là nơi chính thức để chỉnh mode nội dung cho cả truyện. Mọi bề mặt khác chỉ đọc theo hoặc đổi nhanh cùng source of truth này.',
  },
  writer: {
    title: 'Chế độ nội dung',
    description: 'Đổi nhanh ngay trong trang viết. Mode mới sẽ áp dụng cho các lượt gọi AI tiếp theo của project này.',
  },
  wizard: {
    title: 'Chế độ nội dung',
    description: 'Dùng ngay khi tạo truyện để project mới có mode mặc định đúng từ đầu.',
  },
  'story-bible': {
    title: 'Trạng thái hiện tại',
    description: 'Sổ tay truyện chỉ hiển thị trạng thái và dẫn sang Prompt truyện, không còn là nơi chỉnh chính.',
  },
};

export default function ProjectContentModeControl({
  surface = 'prompt',
  mode = 'safe',
  onChange,
  onOpenPrompts,
  disabled = false,
}) {
  const copy = SURFACE_COPY[surface] || SURFACE_COPY.prompt;
  const meta = getProjectContentModeMeta(mode);
  const [writerMenuOpen, setWriterMenuOpen] = useState(false);
  const writerMenuRef = useRef(null);

  useEffect(() => {
    if (surface !== 'writer' || !writerMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!writerMenuRef.current?.contains(event.target)) {
        setWriterMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setWriterMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [surface, writerMenuOpen]);

  if (surface === 'writer') {
    return (
      <div
        ref={writerMenuRef}
        className="project-content-mode project-content-mode--writer project-content-mode--writer-inline"
      >
        <button
          type="button"
          className={`ai-action-btn project-content-mode__writer-button ${writerMenuOpen ? 'project-content-mode__writer-button--open' : ''}`}
          onClick={() => setWriterMenuOpen((current) => !current)}
          disabled={disabled}
          aria-expanded={writerMenuOpen}
          aria-haspopup="menu"
          title={`Chế độ nội dung: ${meta.label}`}
        >
          <SlidersHorizontal size={15} />
          <span className="project-content-mode__writer-button-label">Chế độ</span>
          <span className="project-content-mode__writer-button-value">
            {meta.label}
            <ChevronDown size={13} className={`project-content-mode__writer-chevron ${writerMenuOpen ? 'is-open' : ''}`} />
          </span>
        </button>

        {writerMenuOpen && (
          <div className="project-content-mode__writer-popover" role="menu" aria-label="Chế độ nội dung">
            <div className="project-content-mode__writer-popover-header">
              <div className="project-content-mode__writer-popover-title">Chế độ nội dung</div>
              <div className="project-content-mode__writer-popover-copy">
                Áp dụng cho các lượt gọi AI tiếp theo trong truyện này.
              </div>
            </div>
            {PROJECT_CONTENT_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`project-content-mode__writer-item ${mode === option.value ? 'is-active' : ''}`}
                onClick={() => {
                  onChange?.(option.value);
                  setWriterMenuOpen(false);
                }}
                disabled={disabled}
                role="menuitemradio"
                aria-checked={mode === option.value}
              >
                <span className="project-content-mode__writer-item-topline">
                  <span className="project-content-mode__writer-item-label">{option.label}</span>
                  {mode === option.value && <Check size={14} className="project-content-mode__writer-item-check" />}
                </span>
                <span className="project-content-mode__writer-item-copy">{option.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (surface === 'story-bible') {
    return (
      <div className={`project-content-mode project-content-mode--${surface}`}>
        <div className="project-content-mode__header">
          <div>
            <h3 className="project-content-mode__title">{copy.title}</h3>
            <p className="project-content-mode__description">{copy.description}</p>
          </div>
          <span className="project-content-mode__status">
            <span className="project-content-mode__status-dot" aria-hidden="true" />
            {meta.label}
          </span>
        </div>

        <div className="project-content-mode__shortcut">
          <p className="project-content-mode__shortcut-copy">
            Prompt truyện là nơi chỉnh chính thức cho mode này.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenPrompts}
          >
            <Sparkles size={14} /> Mở Prompt truyện
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`project-content-mode project-content-mode--${surface}`}>
      <div className="project-content-mode__header">
        <div>
          <h3 className="project-content-mode__title">{copy.title}</h3>
          <p className="project-content-mode__description">{copy.description}</p>
        </div>
      </div>

      <div className="project-content-mode__options" role="group" aria-label="Chế độ nội dung">
        {PROJECT_CONTENT_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`project-content-mode__option ${mode === option.value ? 'is-active' : ''}`}
            onClick={() => onChange?.(option.value)}
            disabled={disabled}
            aria-pressed={mode === option.value}
          >
            <span className="project-content-mode__option-label">{option.label}</span>
            <span className="project-content-mode__option-copy">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
