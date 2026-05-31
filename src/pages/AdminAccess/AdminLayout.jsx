import React from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogIn,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wrench,
} from 'lucide-react';
import { useUserAccess } from '../../hooks/useUserAccess';
import './AdminLayout.css';

const ADMIN_NAV_ITEMS = [
  { to: '/admin/access?tab=overview', tab: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/admin/access?tab=users', tab: 'users', label: 'Người dùng', icon: Users },
  { to: '/admin/access?tab=plans', tab: 'plans', label: 'Gói VIP', icon: ShieldCheck },
  { to: '/admin/access?tab=plan-features', tab: 'plan-features', label: 'Tính năng trong gói', icon: SlidersHorizontal },
  { to: '/admin/access?tab=adult', tab: 'adult', label: 'Điều khoản 18+', icon: FileText },
  { to: '/admin/access?tab=audit', tab: 'audit', label: 'Nhật ký', icon: ClipboardList },
  { to: '/admin/access?tab=advanced', tab: 'advanced', label: 'Nâng cao', icon: Wrench },
];

function isActiveNav(location, tab) {
  const params = new URLSearchParams(location.search);
  const currentTab = params.get('tab') === 'features'
    ? 'advanced'
    : params.get('tab') || 'overview';
  return location.pathname.startsWith('/admin/access')
    && currentTab === tab;
}

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { access, isAdmin, loading } = useUserAccess();

  if (location.pathname === '/admin') {
    return <Navigate to="/admin/access?tab=overview" replace />;
  }

  if (loading) {
    return (
      <div className="admin-layout admin-layout--center">
        <section className="admin-layout-empty">
          <div className="admin-layout-empty__mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>Đang kiểm tra quyền quản trị</h1>
            <p>StoryForge đang tải snapshot quyền tài khoản.</p>
          </div>
        </section>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="admin-layout admin-layout--center">
        <section className="admin-layout-empty">
          <div className="admin-layout-empty__mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>Không có quyền quản trị</h1>
            <p>Bạn cần quyền admin hoặc owner để mở khu vực này. Hãy đăng nhập bằng tài khoản đã được cấp quyền admin.</p>
          </div>
          {!access?.authenticated ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`)}
            >
              <LogIn size={16} />
              Mở trang đăng nhập
            </button>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <aside className="admin-layout-sidebar">
        <div className="admin-layout-brand">
          <span className="admin-layout-brand__mark">SF</span>
          <div>
            <strong>StoryForge Admin</strong>
            <small>VIP và quyền truy cập</small>
          </div>
        </div>

        <nav className="admin-layout-nav" aria-label="Menu quản trị">
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.tab}
                to={item.to}
                className={isActiveNav(location, item.tab) ? 'admin-layout-nav__item is-active' : 'admin-layout-nav__item'}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <main className="admin-layout-main">
        <Outlet />
      </main>
    </div>
  );
}
