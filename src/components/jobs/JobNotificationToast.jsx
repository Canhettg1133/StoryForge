import React from 'react';
import { useJobStore } from '../../stores/jobStore';
import './JobNotificationToast.css';

export default function JobNotificationToast() {
  const notifications = useJobStore((state) => state.notifications);
  const dismissNotification = useJobStore((state) => state.dismissNotification);

  React.useEffect(() => {
    const timers = notifications.map((notification) =>
      setTimeout(() => {
        dismissNotification(notification.id);
      }, 6000),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [notifications, dismissNotification]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="job-toast-stack">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`job-toast job-toast--${notification.status}`}
        >
          <div className="job-toast__content">
            <strong>{notification.title}</strong>
            <p>{notification.message}</p>
          </div>
          <button
            type="button"
            className="job-toast__dismiss"
            onClick={() => dismissNotification(notification.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

