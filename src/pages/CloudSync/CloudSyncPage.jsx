import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cloud, Database, ShieldCheck, Smartphone } from 'lucide-react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import useMobileLayout from '../../hooks/useMobileLayout';
import { CloudSyncWorkspace } from '../Settings/CloudSyncSection';
import '../Settings/Settings.css';
import './CloudSyncPage.css';

function CloudSyncDesktopHero({ scopedProjectId, onBack }) {
  return (
    <header className="cloud-sync-page__hero cloud-sync-page__hero--desktop">
      <div className="cloud-sync-page__hero-copy">
        <div className="cloud-sync-page__eyebrow">Sao lưu và đồng bộ dữ liệu sáng tác</div>
        <h1>Cloud Sync</h1>
        <p>
          Quản lý toàn bộ sao lưu project, chat và prompt trên một màn hình riêng. Logic local-first được giữ nguyên; cloud chỉ đóng vai trò lưu trữ, khôi phục và đồng bộ có kiểm soát.
        </p>
        <div className="cloud-sync-page__hero-actions">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <ArrowLeft size={14} /> {scopedProjectId ? 'Về cài đặt dự án' : 'Về cài đặt'}
          </button>
        </div>
      </div>

      <div className="cloud-sync-page__hero-grid">
        <article className="cloud-sync-page__hero-card">
          <Database size={18} />
          <strong>Project, chat, prompt</strong>
          <p>Mọi nhóm dữ liệu được gom vào một luồng sao lưu thống nhất thay vì nằm rải trong Settings.</p>
        </article>
        <article className="cloud-sync-page__hero-card">
          <ShieldCheck size={18} />
          <strong>Đồng bộ an toàn hơn</strong>
          <p>Xung đột dữ liệu, khôi phục ghi đè và snapshot cloud được xử lý ngay trong một không gian riêng.</p>
        </article>
        <article className="cloud-sync-page__hero-card">
          <Smartphone size={18} />
          <strong>Giao diện riêng cho mobile</strong>
          <p>Màn hình này được tối ưu riêng cho điện thoại để thao tác backup và khôi phục không bị rối.</p>
        </article>
      </div>
    </header>
  );
}

function CloudSyncMobileHero({ scopedProjectId, onBack }) {
  return (
    <header className="cloud-sync-page__hero cloud-sync-page__hero--mobile">
      {!scopedProjectId ? (
        <div className="cloud-sync-page__mobile-back">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            <ArrowLeft size={14} /> Quay lại
          </button>
        </div>
      ) : null}

      <div className="cloud-sync-page__mobile-card">
        <div className="cloud-sync-page__eyebrow">Cloud Sync</div>
        <h1>Sao lưu và khôi phục dữ liệu</h1>
        <p>
          Đăng nhập Google, quản lý snapshot và xử lý đồng bộ trên một màn hình riêng, gọn hơn cho điện thoại.
        </p>
      </div>
    </header>
  );
}

export default function CloudSyncPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const scopedProjectId = Number.isFinite(Number(projectId)) ? Number(projectId) : null;
  const isMobileLayout = useMobileLayout(900);

  if (!PRODUCT_SURFACE.enableCloudSync) {
    return null;
  }

  const handleBack = () => {
    if (scopedProjectId) {
      navigate(`/project/${scopedProjectId}/settings`);
      return;
    }

    navigate('/settings');
  };

  return (
    <div className={`cloud-sync-page ${isMobileLayout ? 'cloud-sync-page--mobile' : 'cloud-sync-page--desktop'}`}>
      {isMobileLayout ? (
        <CloudSyncMobileHero scopedProjectId={scopedProjectId} onBack={handleBack} />
      ) : (
        <CloudSyncDesktopHero scopedProjectId={scopedProjectId} onBack={handleBack} />
      )}

      <section className="cloud-sync-page__workspace-shell card animate-slide-up">
        <div className="cloud-sync-page__workspace-head">
          <div>
            <div className="cloud-sync-page__workspace-kicker">Bảng điều khiển</div>
            <h2>Quản lý Cloud Sync</h2>
          </div>
          <div className="cloud-sync-page__workspace-badge">
            <Cloud size={14} />
            <span>Supabase</span>
          </div>
        </div>

        <CloudSyncWorkspace standalone compact={isMobileLayout} />
      </section>
    </div>
  );
}
