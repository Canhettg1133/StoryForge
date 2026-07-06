import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MOJIBAKE_PATTERN = /\u0102|\u00c6|\u00e1\u00ba|\u00e1\u00bb|\u00e2\u20ac|\u00c4|\u00c5|\ufffd/u;

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function readAdminSource(paths) {
  return paths.map((path) => read(path)).join('\n');
}

function readCssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return matches.at(-1)?.[1] || '';
}

describe('admin mobile responsive layout contract', () => {
  it('moves admin navigation into a shared module consumed by desktop and mobile shells', () => {
    const navigation = read('apps/admin/src/constants/navigation.js');
    const app = read('apps/admin/src/App.jsx');
    const shell = read('apps/admin/src/layout/AdminShell.jsx');

    expect(navigation).toContain('export const NAV_GROUPS');
    expect(navigation).toContain('export function getAdminViewTitle');
    expect(app).toContain('NAV_GROUPS');
    expect(shell).toContain('navGroups');
    expect(shell).toContain('AdminMobileMenuSheet');

    for (const label of [
      'Tổng quan',
      'Người dùng',
      'Gói VIP',
      'Tính năng trong gói',
      'Điều khoản 18+',
      'Thông báo',
      'Kho truyện',
      'Nhật ký quản trị',
      'Xếp hạng VIP',
      'Hoạt động người dùng',
      'Nâng cao',
    ]) {
      expect(navigation).toContain(label);
    }
  });

  it('provides mobile admin topbar, full-screen menu sheet, and detail sheet components', () => {
    const shell = read('apps/admin/src/layout/AdminShell.jsx');

    for (const sourceContract of [
      'function AdminMobileTopBar',
      'function AdminMobileMenuSheet',
      'function AdminMobileDetailSheet',
      'admin-mobile-topbar',
      'admin-mobile-menu-sheet',
      'admin-mobile-detail-sheet',
      'StoryForge Admin',
      'Menu',
      'Tải lại',
      'Đóng menu',
    ]) {
      expect(shell).toContain(sourceContract);
    }
  });

  it('imports access labels used by user filters and user plan forms', () => {
    const views = read('apps/admin/src/views/AdminViews.jsx');
    const accessImport = views.match(/import\s*\{[\s\S]*?\}\s*from '@storyforge\/access';/)?.[0] || '';

    expect(accessImport).toContain('PLAN_LABELS_VI');
    expect(accessImport).toContain('STATUS_LABELS_VI');
    expect(views).toContain('Object.entries(PLAN_LABELS_VI)');
    expect(views).toContain('Object.entries(STATUS_LABELS_VI)');
  });

  it('keeps mobile filter controls compact and prevents search boxes from stretching vertically', () => {
    const views = read('apps/admin/src/views/AdminViews.jsx');
    const responsive = read('apps/admin/src/styles/responsive.css');

    expect(views).toContain('panel panel--table usage-panel');
    expect(views).toContain('table-toolbar table-toolbar--split usage-control-panel');
    expect(responsive).toContain('.usage-panel');
    expect(responsive).toContain('.usage-control-panel');
    expect(responsive).toContain('.table-toolbar--split .search-box');
    expect(responsive).toContain('flex: 0 0 auto');
    expect(responsive).toContain('height: 36px');
    expect(responsive).toContain('min-height: 36px');
    expect(responsive).toContain('repeat(auto-fit, minmax(140px, 1fr))');
    const usageGridRule = readCssRule(responsive, '.usage-filter-grid');
    const usageButtonRule = readCssRule(responsive, '.usage-filter-grid .button');
    const usagePanelRule = readCssRule(responsive, '.usage-panel');
    const usageControlPanelRule = readCssRule(responsive, '.usage-control-panel');
    expect(usagePanelRule).toContain('padding: 0');
    expect(usageControlPanelRule).toContain('display: grid');
    expect(usageControlPanelRule).toContain('min-height: 0');
    expect(usageControlPanelRule).toContain('align-content: start');
    expect(usageGridRule).toContain('flex: 0 0 auto');
    expect(usageGridRule).toContain('align-content: start');
    expect(usageGridRule).toContain('align-items: end');
    expect(usageButtonRule).toContain('align-self: end');
    expect(usageButtonRule).toContain('height: 36px');
    expect(usageButtonRule).toContain('white-space: nowrap');
  });

  it('keeps mobile user stats compact and exposes VIP quick actions near the selected user', () => {
    const views = read('apps/admin/src/views/AdminViews.jsx');
    const responsive = read('apps/admin/src/styles/responsive.css');

    expect(views).toContain('user-mobile-action-strip');
    expect(views).toContain('Cấp VIP nhanh');
    expect(views).toContain('quickGrantPlanActions');
    expect(responsive).toContain('.user-mobile-action-strip');
    expect(readCssRule(responsive, '.user-insight-strip')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(readCssRule(responsive, '.user-mobile-action-strip')).toContain('display: grid;');
  });

  it('keeps desktop shell classes while adding safe mobile viewport rules', () => {
    const css = readAdminSource([
      'apps/admin/src/App.css',
      'apps/admin/src/styles/base.css',
      'apps/admin/src/styles/shell.css',
      'apps/admin/src/styles/responsive.css',
    ]);

    for (const className of [
      '.admin-shell',
      '.admin-sidebar',
      '.topbar',
      '.data-table',
      '.admin-mobile-shell',
      '.admin-mobile-topbar',
      '.admin-mobile-menu-sheet',
      '.admin-mobile-detail-sheet',
      '.admin-mobile-card-list',
    ]) {
      expect(css).toContain(className);
    }

    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('100dvh');
    expect(css).toContain('100svh');
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('@media (min-width: 901px)');
    expect(css).toContain('@media (max-width: 1120px)');
  });

  it('adds mobile card/list alternatives for dense admin tables without removing desktop tables', () => {
    const views = read('apps/admin/src/views/AdminViews.jsx');
    const storyMirror = read('apps/admin/src/features/storyMirror/StoryMirrorPage.jsx');

    for (const sourceContract of [
      'admin-mobile-user-list',
      'admin-mobile-audit-list',
      'admin-mobile-usage-list',
      'admin-mobile-ranking-list',
      'admin-mobile-card-list',
      'data-table',
      'panel--table',
    ]) {
      expect(`${views}\n${storyMirror}`).toContain(sourceContract);
    }
  });

  it('keeps new admin modules in valid Vietnamese UTF-8', () => {
    const paths = [
      'apps/admin/src/constants/navigation.js',
      'apps/admin/src/components/ui/AdminPrimitives.jsx',
      'apps/admin/src/layout/AdminShell.jsx',
      'apps/admin/src/views/AdminViews.jsx',
      'apps/admin/src/styles/responsive.css',
    ];

    for (const path of paths) {
      expect(existsSync(resolve(process.cwd(), path)), `${path} should exist`).toBe(true);
    }

    const combined = readAdminSource(paths);
    expect(combined).toContain('Người dùng');
    expect(combined).toContain('Đăng xuất');
    expect(combined).toContain('Chưa có');
    expect(combined).not.toMatch(MOJIBAKE_PATTERN);
  });
});
