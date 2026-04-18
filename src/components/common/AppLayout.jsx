import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import Sidebar from './Sidebar';
import JobNotificationToast from '../jobs/JobNotificationToast';
import JobQueuePanel from '../jobs/JobQueuePanel';
import StorageWarning from './StorageWarning';
import useMobileLayout from '../../hooks/useMobileLayout';
import PersistentTranslatorHost from '../translator/PersistentTranslatorHost';
import './AppLayout.css';

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobileLayout = useMobileLayout(900);
  const isProjectRoute = location.pathname.startsWith('/project/');
  const isTranslatorRoute = location.pathname === '/translator';

  const handleTranslatorBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <div className={`app-layout ${isMobileLayout ? 'app-layout--mobile' : ''} ${isProjectRoute ? 'app-layout--project-route' : ''}`}>
      {!isMobileLayout && <Sidebar />}
      <main className={`app-main ${location.pathname === '/translator' ? 'app-main--translator-active' : ''}`}>
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
            <PersistentTranslatorHost active={isTranslatorRoute} />
          </div>
        </div>
      </main>
      <StorageWarning />
      {PRODUCT_SURFACE.showJobUi ? <JobQueuePanel /> : null}
      {PRODUCT_SURFACE.showJobUi ? <JobNotificationToast /> : null}
    </div>
  );
}
