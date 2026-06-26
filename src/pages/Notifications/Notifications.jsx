import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, ExternalLink } from 'lucide-react';
import { DEFAULT_SITE_ANNOUNCEMENT } from '../../config/siteAnnouncement.js';
import { fetchSiteAnnouncement } from '../../services/siteAnnouncement/siteAnnouncementClient.js';
import { navigateBackOr } from '../../utils/navigation.js';
import './Notifications.css';

export default function Notifications() {
  const location = useLocation();
  const navigate = useNavigate();
  const [announcement, setAnnouncement] = useState(DEFAULT_SITE_ANNOUNCEMENT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchSiteAnnouncement()
      .then(({ announcement: nextAnnouncement }) => {
        if (mounted) setAnnouncement(nextAnnouncement);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="notifications-page">
      <section className="notifications-page__shell" aria-label="Thông báo hệ thống">
        <button
          type="button"
          className="btn btn-secondary btn-sm notifications-page__back"
          onClick={() => navigateBackOr(navigate, '/', { location })}
        >
          <ArrowLeft size={14} />
          Quay về
        </button>
        <header className="notifications-page__header">
          <span className="notifications-page__icon" aria-hidden="true">
            <Bell size={24} />
          </span>
          <div>
            <h1>Thông báo</h1>
            <p>Cập nhật chính thức từ StoryForge.</p>
          </div>
        </header>

        {loading ? (
          <div className="notifications-page__empty">
            <strong>Đang tải thông báo...</strong>
          </div>
        ) : announcement.enabled ? (
          <article className="notifications-page__card">
            <div>
              <span>Phiên bản {announcement.revision}</span>
              <h2>{announcement.title}</h2>
              <p>{announcement.body}</p>
            </div>
            <a
              className="btn btn-primary"
              href={announcement.primaryActionUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              {announcement.primaryActionLabel}
            </a>
          </article>
        ) : (
          <div className="notifications-page__empty">
            <strong>Hiện chưa có thông báo mới.</strong>
            <span>Khi StoryForge có cập nhật quan trọng, nội dung sẽ xuất hiện ở đây.</span>
          </div>
        )}
      </section>
    </main>
  );
}
