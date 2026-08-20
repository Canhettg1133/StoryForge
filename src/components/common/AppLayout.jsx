import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import Sidebar from './Sidebar';
import JobNotificationToast from '../jobs/JobNotificationToast';
import JobQueuePanel from '../jobs/JobQueuePanel';
import StorageWarning from './StorageWarning';
import useMobileLayout from '../../hooks/useMobileLayout';
import CloudAuthRedirectHandler from '../cloud/CloudAuthRedirectHandler';
import PersistentTranslatorHost from '../translator/PersistentTranslatorHost';
import { ACCESS_FEATURES } from '../../services/access/accessControl.js';
import { useUserAccess } from '../../hooks/useUserAccess';
import AccessGate from '../access/AccessGate.jsx';
import { navigateBackOr } from '../../utils/navigation.js';
import CloudflarePreviewBanner from './CloudflarePreviewBanner.jsx';
import './AppLayout.css';

const CloudAutoSyncAgent = React.lazy(() => import('../cloud/CloudAutoSyncAgent'));

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobileLayout = useMobileLayout(900);
  const isProjectRoute = location.pathname.startsWith('/project/');
  const isTranslatorRoute = location.pathname === '/translator';
  const { access, hasFeature } = useUserAccess();
  const canUseTranslator = hasFeature(ACCESS_FEATURES.TRANSLATOR_ACCESS);
  const [hasMountedTranslator, setHasMountedTranslator] = useState(false);
  const [translatorStatus, setTranslatorStatus] = useState({
    state: 'not-loaded',
    completed: 0,
    total: 0,
    sessionId: '',
  });

  useEffect(() => {
    if (isTranslatorRoute && canUseTranslator) {
      setHasMountedTranslator(true);
      setTranslatorStatus((current) => (
        current.state === 'not-loaded'
          ? { ...current, state: 'loading' }
          : current
      ));
    }
  }, [canUseTranslator, isTranslatorRoute]);

  const handleTranslatorBack = () => {
    navigateBackOr(navigate, '/', { location });
  };

  return (
    <div className={`app-layout ${isMobileLayout ? 'app-layout--mobile' : ''} ${isProjectRoute ? 'app-layout--project-route' : ''}`}>
      {!isMobileLayout && <Sidebar />}
      <main className={`app-main ${location.pathname === '/translator' ? 'app-main--translator-active' : ''}`}>
        <CloudflarePreviewBanner />
        <Outlet />
        <div className={`translator-shell ${isTranslatorRoute ? 'is-active' : 'is-hidden'}`}>
          {isTranslatorRoute && isMobileLayout ? (
            <div className="translator-shell__mobile-back">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleTranslatorBack}
              >
                <ArrowLeft size={14} /> Quay lại
              </button>
            </div>
          ) : null}
          <div className="translator-shell__host">
            {hasMountedTranslator ? (
              <PersistentTranslatorHost
                active={isTranslatorRoute && canUseTranslator}
                access={access}
                onStatusChange={setTranslatorStatus}
              />
            ) : null}
            {isTranslatorRoute && !canUseTranslator ? (
              <div className="translator-access-gate">
                <AccessGate
                  feature={ACCESS_FEATURES.TRANSLATOR_ACCESS}
                  title="Dịch truyện đang bị khóa"
                  onOpenSettings={() => navigate('/settings')}
                />
              </div>
            ) : null}
          </div>
        </div>
      </main>
      {!isTranslatorRoute && ['running', 'paused', 'failed', 'completed'].includes(translatorStatus.state) ? (
        <button
          type="button"
          className={`translator-background-status is-${translatorStatus.state}`}
          onClick={() => navigate('/translator')}
          aria-live="polite"
        >
          <span className="translator-background-status__dot" aria-hidden="true" />
          <span>
            {translatorStatus.state === 'running' ? 'Đang dịch nền' : null}
            {translatorStatus.state === 'paused' ? 'Bản dịch đang tạm dừng' : null}
            {translatorStatus.state === 'failed' ? 'Bản dịch cần kiểm tra' : null}
            {translatorStatus.state === 'completed' ? 'Dịch truyện đã hoàn tất' : null}
          </span>
          {translatorStatus.total > 0 ? (
            <span className="translator-background-status__progress">
              {translatorStatus.completed}/{translatorStatus.total}
            </span>
          ) : null}
        </button>
      ) : null}
      <StorageWarning />
      <CloudAuthRedirectHandler />
      <React.Suspense fallback={null}>
        <CloudAutoSyncAgent />
      </React.Suspense>
      {PRODUCT_SURFACE.showJobUi ? <JobQueuePanel /> : null}
      {PRODUCT_SURFACE.showJobUi ? <JobNotificationToast /> : null}
    </div>
  );
}
