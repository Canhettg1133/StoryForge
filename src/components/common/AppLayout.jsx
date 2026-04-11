import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import JobNotificationToast from '../jobs/JobNotificationToast';
import JobQueuePanel from '../jobs/JobQueuePanel';
import StorageWarning from './StorageWarning';
import './AppLayout.css';

export default function AppLayout() {
  const location = useLocation();
  const isEditorRoute = location.pathname.includes('/editor');

  return (
    <div className={`app-layout ${isEditorRoute ? 'app-layout--editor-route' : ''}`}>
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
      <StorageWarning />
      <JobQueuePanel />
      <JobNotificationToast />
    </div>
  );
}
