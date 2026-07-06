import React, { useState } from 'react';
import {
  ChevronRight,
  LogOut,
  Menu,
  RefreshCw,
  X,
} from 'lucide-react';
import { ADMIN_ROLES } from '@storyforge/access';
import { Badge } from '../components/ui/AdminPrimitives.jsx';
import { getAdminViewTitle } from '../constants/navigation.js';
import { getRoleLabel } from '../utils/adminFormatters.js';

function DesktopSidebar({ actor, activeView, navGroups, onSelectView, onLogout }) {
  return (
    <aside className="admin-sidebar">
      <div className="brand-block">
        <div className="brand-mark">SF</div>
        <div>
          <strong>StoryForge</strong>
          <span>Admin Console</span>
        </div>
      </div>
      <nav aria-label="Admin navigation">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group__label">{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`nav-item ${activeView === item.id ? 'is-active' : ''}`}
                  onClick={() => onSelectView(item.id)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <ChevronRight size={15} />
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="admin-account">
        <span>{actor?.email || 'Admin'}</span>
        <Badge tone={actor?.role === ADMIN_ROLES.OWNER ? 'danger' : 'info'}>{getRoleLabel(actor?.role)}</Badge>
        <button type="button" className="button button--ghost" onClick={onLogout}>
          <LogOut size={15} />
          Đăng xuất
        </button>
      </div>
    </aside>
  );
}

export function AdminMobileTopBar({
  activeView,
  onMenu,
  onRefresh,
  refreshLoading,
}) {
  return (
    <header className="admin-mobile-topbar">
      <button type="button" className="admin-mobile-icon-button" onClick={onMenu} aria-label="Mở menu điều hướng">
        <Menu size={20} />
      </button>
      <div className="admin-mobile-title">
        <span>StoryForge Admin</span>
        <strong>{getAdminViewTitle(activeView)}</strong>
      </div>
      <button
        type="button"
        className="admin-mobile-icon-button admin-mobile-refresh"
        onClick={onRefresh}
        disabled={refreshLoading}
        aria-label="Tải lại"
      >
        <RefreshCw size={18} />
        <span>{refreshLoading ? 'Đang tải' : 'Tải lại'}</span>
      </button>
    </header>
  );
}

export function AdminMobileMenuSheet({
  open,
  actor,
  activeView,
  navGroups,
  onSelectView,
  onLogout,
  onClose,
}) {
  if (!open) return null;

  const handleSelect = (viewId) => {
    onSelectView(viewId);
    onClose();
  };

  return (
    <div className="admin-mobile-sheet-root">
      <button className="admin-mobile-sheet-backdrop" type="button" onClick={onClose} aria-label="Đóng menu" />
      <section className="admin-mobile-menu-sheet" role="dialog" aria-modal="true" aria-label="Menu quản trị">
        <header className="admin-mobile-sheet-header">
          <div>
            <span>StoryForge Admin</span>
            <h2>Menu</h2>
          </div>
          <button type="button" className="admin-mobile-icon-button" onClick={onClose} aria-label="Đóng menu">
            <X size={18} />
          </button>
        </header>
        <div className="admin-mobile-menu-body">
          {navGroups.map((group) => (
            <section className="admin-mobile-menu-group" key={group.label} aria-label={group.label}>
              <h3>{group.label}</h3>
              <div className="admin-mobile-menu-list">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`admin-mobile-menu-item ${activeView === item.id ? 'is-active' : ''}`}
                      onClick={() => handleSelect(item.id)}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                      <ChevronRight size={15} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <footer className="admin-mobile-menu-account">
          <div>
            <strong>{actor?.email || 'Admin'}</strong>
            <Badge tone={actor?.role === ADMIN_ROLES.OWNER ? 'danger' : 'info'}>{getRoleLabel(actor?.role)}</Badge>
          </div>
          <button type="button" className="button button--ghost" onClick={onLogout}>
            <LogOut size={15} />
            Đăng xuất
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AdminMobileDetailSheet({
  open,
  title,
  kicker = '',
  onClose,
  children,
  footer = null,
}) {
  if (!open) return null;

  return (
    <div className="admin-mobile-sheet-root admin-mobile-detail-root">
      <button className="admin-mobile-sheet-backdrop" type="button" onClick={onClose} aria-label="Đóng chi tiết" />
      <section className="admin-mobile-detail-sheet" role="dialog" aria-modal="true" aria-label={title || 'Chi tiết'}>
        <div className="admin-mobile-sheet-handle" />
        <header className="admin-mobile-sheet-header">
          <div>
            {kicker ? <span>{kicker}</span> : null}
            <h2>{title}</h2>
          </div>
          <button type="button" className="admin-mobile-icon-button" onClick={onClose} aria-label="Đóng chi tiết">
            <X size={18} />
          </button>
        </header>
        <div className="admin-mobile-detail-body">{children}</div>
        {footer ? <footer className="admin-mobile-detail-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export default function AdminShell({
  actor,
  activeView,
  navGroups,
  onSelectView,
  onLogout,
  onRefresh,
  refreshLoading,
  children,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="admin-shell admin-mobile-shell">
      <DesktopSidebar
        actor={actor}
        activeView={activeView}
        navGroups={navGroups}
        onSelectView={onSelectView}
        onLogout={onLogout}
      />
      <AdminMobileTopBar
        activeView={activeView}
        onMenu={() => setMobileMenuOpen(true)}
        onRefresh={onRefresh}
        refreshLoading={refreshLoading}
      />
      {children}
      <AdminMobileMenuSheet
        open={mobileMenuOpen}
        actor={actor}
        activeView={activeView}
        navGroups={navGroups}
        onSelectView={onSelectView}
        onLogout={onLogout}
        onClose={() => setMobileMenuOpen(false)}
      />
    </div>
  );
}
