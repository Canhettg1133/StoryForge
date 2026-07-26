import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function getArrayBody(source, declarationName) {
  const start = source.indexOf(`const ${declarationName} = [`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('];', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function extractIds(arrayBody) {
  return Array.from(arrayBody.matchAll(/id:\s*'([^']+)'/g), (match) => match[1]);
}

describe('phase10 navigation menu ordering', () => {
  it('keeps desktop sidebar order stable instead of moving the global prompt entry in project context', () => {
    const sidebar = read('src/components/common/Sidebar.jsx');
    const sidebarItems = getArrayBody(sidebar, 'RAW_NAV_ITEMS');
    const sidebarIds = extractIds(sidebarItems);

    expect(sidebarIds).toContain('account-vip');
    expect(sidebarItems).toContain("path: '/login'");
    expect(sidebar).not.toContain('globalPromptIndex');
    expect(sidebar).not.toContain('projectPromptIndex');
    expect(sidebar).not.toContain('items.splice(projectPromptIndex + 1');
  });

  it('keeps the account route inside the app layout so persistent navigation remains visible', () => {
    const app = read('src/App.jsx');
    const appLayoutIndex = app.indexOf('<Route element={<AppLayout />}>');
    const accountRouteIndex = app.indexOf('<Route path="/login" element={withRouteBoundary(<Login />)} />');

    expect(appLayoutIndex).toBeGreaterThanOrEqual(0);
    expect(accountRouteIndex).toBeGreaterThan(appLayoutIndex);
  });

  it('adds account access to every mobile navigation surface', () => {
    const dashboardMenu = getArrayBody(read('src/components/mobile/MobileNavigationMenu.jsx'), 'FULL_MOBILE_DRAWER_ITEMS');
    const projectMenu = getArrayBody(read('src/components/mobile/MobileProjectShell.jsx'), 'MORE_ITEMS');
    const editorMenu = getArrayBody(read('src/pages/SceneEditor/SceneEditor.jsx'), 'MOBILE_NAV_ITEMS');

    for (const menuSource of [dashboardMenu, projectMenu, editorMenu]) {
      expect(menuSource).toContain("id: 'account-vip'");
      expect(menuSource).toContain('/login');
    }
  });

  it('keeps the project mobile menu aligned with the same high-level order as the desktop and dashboard menus', () => {
    const dashboardIds = extractIds(getArrayBody(read('src/components/mobile/MobileNavigationMenu.jsx'), 'FULL_MOBILE_DRAWER_ITEMS'));
    const projectIds = extractIds(getArrayBody(read('src/components/mobile/MobileProjectShell.jsx'), 'MORE_ITEMS'));
    const normalizedProjectIds = projectIds
      .map((id) => (id === 'chat' ? 'project-chat' : id))
      .map((id) => (id === 'prompts' ? 'project-prompts' : id))
      .map((id) => (id === 'canon' ? 'su-that' : id));
    const expectedProjectOrder = dashboardIds.filter((id) => normalizedProjectIds.includes(id));

    expect(normalizedProjectIds).toEqual(expectedProjectOrder);
  });

  it('reuses the shared mobile navigation menu on Dashboard and account pages', () => {
    const dashboard = read('src/pages/Dashboard/Dashboard.jsx');
    const login = read('src/pages/Login/Login.jsx');

    expect(dashboard).toContain('MobileNavigationMenu');
    expect(login).toContain('MobileNavigationMenu');
    expect(login).not.toContain('ACCOUNT_MOBILE_NAV_ITEMS');
    expect(login).not.toContain('login-page__mobile-menu-list');
  });

  it('gates editor mobile roadmap items behind the roadmap product surface flag', () => {
    const editorMenu = getArrayBody(read('src/pages/SceneEditor/SceneEditor.jsx'), 'MOBILE_NAV_ITEMS');

    for (const id of ['timeline', 'revision', 'style-lab']) {
      const itemLine = editorMenu
        .split('\n')
        .find((line) => line.includes(`id: '${id}'`));
      expect(itemLine).toContain("surface: 'roadmap'");
    }
  });
});
