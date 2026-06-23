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

  it('adds account access to every mobile navigation surface', () => {
    const dashboardMenu = getArrayBody(read('src/pages/Dashboard/Dashboard.jsx'), 'FULL_MOBILE_DRAWER_ITEMS');
    const projectMenu = getArrayBody(read('src/components/mobile/MobileProjectShell.jsx'), 'MORE_ITEMS');
    const editorMenu = getArrayBody(read('src/pages/SceneEditor/SceneEditor.jsx'), 'MOBILE_NAV_ITEMS');

    for (const menuSource of [dashboardMenu, projectMenu, editorMenu]) {
      expect(menuSource).toContain("id: 'account-vip'");
      expect(menuSource).toContain('/login');
    }
  });

  it('keeps the project mobile menu aligned with the same high-level order as the desktop and dashboard menus', () => {
    const dashboardIds = extractIds(getArrayBody(read('src/pages/Dashboard/Dashboard.jsx'), 'FULL_MOBILE_DRAWER_ITEMS'));
    const projectIds = extractIds(getArrayBody(read('src/components/mobile/MobileProjectShell.jsx'), 'MORE_ITEMS'));
    const normalizedProjectIds = projectIds
      .map((id) => (id === 'chat' ? 'project-chat' : id))
      .map((id) => (id === 'prompts' ? 'project-prompts' : id))
      .map((id) => (id === 'canon' ? 'su-that' : id));
    const expectedProjectOrder = dashboardIds.filter((id) => normalizedProjectIds.includes(id));

    expect(normalizedProjectIds).toEqual(expectedProjectOrder);
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
