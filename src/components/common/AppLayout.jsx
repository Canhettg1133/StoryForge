import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
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
  const isMobileLayout = useMobileLayout(900);
  const isProjectRoute = location.pathname.startsWith('/project/');
  const isTranslatorRoute = location.pathname === '/translator';
  const [translatorMounted, setTranslatorMounted] = useState(isTranslatorRoute);

  useEffect(() => {
    if (isTranslatorRoute) {
      setTranslatorMounted(true);
    }
  }, [isTranslatorRoute]);

  return (
    <div className={`app-layout ${isMobileLayout ? 'app-layout--mobile' : ''} ${isProjectRoute ? 'app-layout--project-route' : ''}`}>
      {!isMobileLayout && <Sidebar />}
      <main className={`app-main ${isTranslatorRoute ? 'app-main--translator-active' : ''}`}>
        {translatorMounted ? <PersistentTranslatorHost active={isTranslatorRoute} /> : null}
        <Outlet />
      </main>
      <StorageWarning />
      {PRODUCT_SURFACE.showJobUi ? <JobQueuePanel /> : null}
      {PRODUCT_SURFACE.showJobUi ? <JobNotificationToast /> : null}
    </div>
  );
}
