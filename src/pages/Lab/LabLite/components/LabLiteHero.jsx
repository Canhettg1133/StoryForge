import React from 'react';
import { FileText } from 'lucide-react';
import { formatNumber } from '../labLiteUiHelpers.js';

export default function LabLiteHero({ currentCorpus, chapters, scoutPlan }) {
  return (
    <header className="lab-lite-hero">
      <div>
        <h2>Lab Lite</h2>
        <p>Nạp liệu trực tiếp trên trình duyệt, AI quét chương và lập bản đồ arc. AI chỉ gợi ý phát hiện lệch canon, không đảm bảo tuyệt đối.</p>
      </div>
      <div className="lab-lite-hero-stats">
        <span><FileText size={14} /> {formatNumber(currentCorpus?.chapterCount || chapters.length)} chương</span>
        <span>{scoutPlan.strategy.label}</span>
        <span>{formatNumber(scoutPlan.estimatedRequests)} request quét</span>
        <span>{formatNumber(currentCorpus?.totalWords || 0)} từ</span>
        <span>{formatNumber(currentCorpus?.totalEstimatedTokens || 0)} token</span>
      </div>
    </header>
  );
}
