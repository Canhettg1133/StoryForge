import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, ExternalLink, X } from 'lucide-react';
import {
  getSiteAnnouncementDismissKey,
  normalizeSiteAnnouncement,
} from '../../config/siteAnnouncement.js';
import {
  dismissSiteAnnouncement,
  fetchSiteAnnouncement,
  getDismissedSiteAnnouncementKey,
} from '../../services/siteAnnouncement/siteAnnouncementClient.js';
import './SiteAnnouncementCenter.css';

export default function SiteAnnouncementCenter() {
  const location = useLocation();
  const isHomePage = location.pathname === '/';
  const [announcement, setAnnouncement] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isHomePage) {
      setAnnouncement(null);
      setOpen(false);
      return undefined;
    }

    const controller = new AbortController();
    let mounted = true;

    fetchSiteAnnouncement({ signal: controller.signal })
      .then(({ announcement: nextAnnouncement }) => {
        if (!mounted) return;
        const normalized = normalizeSiteAnnouncement(nextAnnouncement);
        setAnnouncement(normalized);
        if (
          normalized.enabled
          && getDismissedSiteAnnouncementKey() !== getSiteAnnouncementDismissKey(normalized)
        ) {
          setOpen(true);
        }
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [isHomePage]);

  if (!announcement?.enabled) return null;

  const closeAndDismiss = () => {
    dismissSiteAnnouncement(announcement);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="site-announcement-launcher"
        aria-label="Mở thông báo hệ thống"
        onClick={() => setOpen(true)}
      >
        <Bell size={18} />
        <span className="sr-only">Thông báo</span>
      </button>

      {open ? (
        <div className="site-announcement-overlay" role="presentation">
          <section
            className="site-announcement-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-announcement-title"
          >
            <header>
              <span className="site-announcement-dialog__icon" aria-hidden="true">
                <Bell size={20} />
              </span>
              <div>
                <h2 id="site-announcement-title">{announcement.title}</h2>
                <p>Thông báo từ StoryForge</p>
              </div>
              <button
                type="button"
                className="site-announcement-dialog__close"
                aria-label="Đóng thông báo hệ thống"
                onClick={closeAndDismiss}
              >
                <X size={16} />
              </button>
            </header>

            <p className="site-announcement-dialog__body">{announcement.body}</p>

            <footer>
              <button type="button" className="btn btn-primary" onClick={closeAndDismiss}>
                Tiếp tục vào web
              </button>
              <a
                className="btn btn-secondary site-announcement-dialog__backup"
                href={announcement.primaryActionUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Mở bản dự phòng trong tab mới"
              >
                <ExternalLink size={15} />
                {announcement.primaryActionLabel}
              </a>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
