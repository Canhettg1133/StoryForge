import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import JobNotificationToast from '../jobs/JobNotificationToast';
import JobQueuePanel from '../jobs/JobQueuePanel';
import StorageWarning from './StorageWarning';
import './AppLayout.css';

export default function AppLayout() {
  return (
    <div className="app-layout">
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
