import React from 'react';
import { AlertTriangle } from 'lucide-react';
import './CloudflarePreviewBanner.css';

export default function CloudflarePreviewBanner() {
  if (import.meta.env.VITE_DEPLOYMENT_MODE !== 'preview') return null;

  return (
    <aside className="cloudflare-preview-banner" role="status" aria-live="polite">
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>Cloudflare Preview chỉ đọc</strong>
        <span>API key và dữ liệu local thuộc riêng URL preview. Cloud Sync và Story Mirror đang tạm khóa.</span>
      </div>
    </aside>
  );
}
