import React from 'react';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';

export default function MobileProjectTopBar({
  pageTitle,
  title,
  titleIsAction = false,
  onBack,
  backLabel = 'V\u1ec1 Dashboard',
  onTitleClick,
  onMore,
}) {
  const titleContent = (
    <>
      <span className="project-mobile-title__kicker">{pageTitle}</span>
      <span className="project-mobile-title__main">{title}</span>
    </>
  );

  return (
    <header className="project-mobile-topbar">
      <button className="project-mobile-icon-btn" type="button" onClick={onBack} aria-label={backLabel}>
        <ChevronLeft size={20} />
      </button>
      {titleIsAction ? (
        <button
          className="project-mobile-title project-mobile-title--button"
          type="button"
          onClick={onTitleClick}
          aria-label="M\u1edf danh s\u00e1ch ch\u01b0\u01a1ng"
        >
          {titleContent}
        </button>
      ) : (
        <div className="project-mobile-title" aria-label={pageTitle}>
          {titleContent}
        </div>
      )}
      <button className="project-mobile-icon-btn" type="button" onClick={onMore} aria-label="M\u1edf menu \u0111i\u1ec1u h\u01b0\u1edbng">
        <MoreHorizontal size={20} />
      </button>
    </header>
  );
}
