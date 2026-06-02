import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  getProjectContentModeMeta,
  PROJECT_CONTENT_MODES,
  PROJECT_CONTENT_MODE_OPTIONS,
} from './projectContentMode';
import { useUserAccess } from '../../hooks/useUserAccess';
import { ACCESS_FEATURES } from '../../services/access/accessControl.js';
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

const ADULT_CONSENT_REASONS = new Set([
  'AGE_CONFIRMATION_REQUIRED',
  'ADULT_TERMS_REQUIRED',
  'ADULT_TERMS_VERSION_OUTDATED',
]);

export default function ProjectContentModeControl({
  surface = 'prompt',
  mode = 'safe',
  onChange,
  onOpenPrompts,
  disabled = false,
}) {
  const copy = SURFACE_COPY[surface] || SURFACE_COPY.prompt;
  const meta = getProjectContentModeMeta(mode);
  const { hasFeature, getDecision, getDeniedMessage, confirmAdultTerms } = useUserAccess();
  const [writerMenuOpen, setWriterMenuOpen] = useState(false);
  const [adultPrompt, setAdultPrompt] = useState(null);
  const writerMenuRef = useRef(null);
  const canUseAdultMode = hasFeature(ACCESS_FEATURES.ADULT_MODE);

  const isAdultOption = (value) =>
    value === PROJECT_CONTENT_MODES.NSFW || value === PROJECT_CONTENT_MODES.ENI;

  const handleSelectMode = async (value) => {
    if (isAdultOption(value) && !canUseAdultMode) {
      const decision = getDecision(ACCESS_FEATURES.ADULT_MODE);
      setAdultPrompt({
        requestedMode: value,
        message: getDeniedMessage(ACCESS_FEATURES.ADULT_MODE),
        canConfirm: ADULT_CONSENT_REASONS.has(decision?.reason || ''),
      });
      return;
    }

    onChange?.(value);
  };

  const handleConfirmAdultTerms = async () => {
    try {
      const requestedMode = adultPrompt?.requestedMode;
      await confirmAdultTerms();
      setAdultPrompt(null);
      if (requestedMode) {
        onChange?.(requestedMode);
      }
    } catch {
      // AccessContext records the error for the account-level banner.
    }
  };

  const adultAccessModal = adultPrompt ? (
    <div className="project-content-mode__modal-backdrop" role="presentation" onMouseDown={() => setAdultPrompt(null)}>
      <section
        className="project-content-mode__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-content-mode-adult-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 id="project-content-mode-adult-title">
          {adultPrompt.canConfirm ? 'Xác nhận 18+' : 'Yêu cầu VIP'}
        </h3>
        <p>{adultPrompt.message}</p>
        <div className="project-content-mode__modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setAdultPrompt(null)}>
            Đóng
          </button>
          {adultPrompt.canConfirm ? (
            <button type="button" className="btn btn-primary" onClick={handleConfirmAdultTerms}>
              Đồng ý và tiếp tục
            </button>
          ) : null}
        </div>
      </section>
    </div>
  ) : null;

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
      <>
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
                    handleSelectMode(option.value);
                    setWriterMenuOpen(false);
                  }}
                  disabled={disabled}
                  title={isAdultOption(option.value) && !canUseAdultMode ? getDeniedMessage(ACCESS_FEATURES.ADULT_MODE) : undefined}
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
        {adultAccessModal}
      </>
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
    <>
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
              onClick={() => handleSelectMode(option.value)}
              disabled={disabled}
              title={isAdultOption(option.value) && !canUseAdultMode ? getDeniedMessage(ACCESS_FEATURES.ADULT_MODE) : undefined}
              aria-pressed={mode === option.value}
            >
              <span className="project-content-mode__option-label">{option.label}</span>
              <span className="project-content-mode__option-copy">{option.description}</span>
            </button>
          ))}
        </div>
      </div>
      {adultAccessModal}
    </>
  );
}
