import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import Sidebar from './Sidebar';
import JobNotificationToast from '../jobs/JobNotificationToast';
import JobQueuePanel from '../jobs/JobQueuePanel';
import StorageWarning from './StorageWarning';
import useMobileLayout from '../../hooks/useMobileLayout';
import './AppLayout.css';

export default function AppLayout() {
  const location = useLocation();
  const isMobileLayout = useMobileLayout(900);
  const isProjectRoute = location.pathname.startsWith('/project/');

  return (
    <div className={`app-layout ${isMobileLayout ? 'app-layout--mobile' : ''} ${isProjectRoute ? 'app-layout--project-route' : ''}`}>
      {!isMobileLayout && <Sidebar />}
      <main className={`app-main ${location.pathname === '/translator' ? 'app-main--translator-active' : ''}`}>
        <Outlet />
      </main>
      <StorageWarning />
      {PRODUCT_SURFACE.showJobUi ? <JobQueuePanel /> : null}
      {PRODUCT_SURFACE.showJobUi ? <JobNotificationToast /> : null}
    </div>
  );
}
