import React from 'react';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';

export default function MobileProjectTopBar({
  pageTitle,
  title,
  titleIsAction = false,
  onBack,
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
      <button className="project-mobile-icon-btn" type="button" onClick={onBack} aria-label="Ve Dashboard">
        <ChevronLeft size={20} />
      </button>
      {titleIsAction ? (
        <button
          className="project-mobile-title project-mobile-title--button"
          type="button"
          onClick={onTitleClick}
          aria-label="Mo danh sach chuong"
        >
          {titleContent}
        </button>
      ) : (
        <div className="project-mobile-title" aria-label={pageTitle}>
          {titleContent}
        </div>
      )}
      <button className="project-mobile-icon-btn" type="button" onClick={onMore} aria-label="Mo menu khac">
        <MoreHorizontal size={20} />
      </button>
    </header>
  );
}
