import React from 'react';
import { Outlet } from 'react-router-dom';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import Sidebar from './Sidebar';
import JobNotificationToast from '../jobs/JobNotificationToast';
import JobQueuePanel from '../jobs/JobQueuePanel';
import StorageWarning from './StorageWarning';
import useMobileLayout from '../../hooks/useMobileLayout';
import './AppLayout.css';

export default function AppLayout() {
  const isMobileLayout = useMobileLayout(900);

  return (
    <div className={`app-layout ${isMobileLayout ? 'app-layout--mobile' : ''}`}>
      {!isMobileLayout && <Sidebar />}
      <main className="app-main">
        <Outlet />
      </main>
      <StorageWarning />
      {PRODUCT_SURFACE.showJobUi ? <JobQueuePanel /> : null}
      {PRODUCT_SURFACE.showJobUi ? <JobNotificationToast /> : null}
    </div>
  );
}
