import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('frontend delivery performance guard', () => {
  it('loads page modules lazily while keeping the persistent app shell eager', () => {
    const app = read('src/App.jsx');
    const sidebar = read('src/components/common/Sidebar.jsx');
    const dashboard = read('src/pages/Dashboard/Dashboard.jsx');
    const projectStore = read('src/stores/projectStore.js');

    expect(app).toContain("import AppLayout from './components/common/AppLayout'");
    expect(app).not.toMatch(/^import\s+\w+\s+from\s+'\.\/pages\//gmu);
    expect(app).toContain("lazyRoute('dashboard')");
    expect(app).toContain("lazyRoute('sceneEditor')");
    expect(app).toContain("from './routes/routeModules.js'");
    expect(sidebar).toContain('prefetchRouteFromPath');
    expect(sidebar).toContain('onPointerEnter');
    expect(sidebar).toContain('onFocus');
    expect(app).toContain('<RouteBoundary>');
    expect(app).toContain('path="*"');
    expect(dashboard).toContain("React.lazy(() => import('../../components/common/ExportModal'))");
    expect(dashboard).toContain("React.lazy(() => import('../../components/storyBundle/StoryBundleModal.jsx'))");
    expect(dashboard).toContain("React.lazy(() => import('./NewProjectModal'))");
    expect(dashboard).not.toContain("import NewProjectModal from './NewProjectModal'");
    expect(dashboard).not.toContain("import ExportModal from '../../components/common/ExportModal'");
    expect(dashboard).not.toContain("import StoryBundleModal from '../../components/storyBundle/StoryBundleModal.jsx'");
    expect(projectStore).not.toContain("import useAIStore from './aiStore'");
    expect(projectStore).not.toContain("import useCodexStore from './codexStore'");
    expect(projectStore).not.toContain("from '../services/canon/workflow'");
    expect(projectStore).toContain("import('./aiStore')");
    expect(projectStore).toContain("import('../services/canon/workflow')");
  });

  it('does not force every node module into one initial vendor chunk', () => {
    const vite = read('vite.config.js');

    expect(vite).toContain("return 'vendor-react'");
    expect(vite).toContain("return 'vendor-cloud'");
    expect(vite).toContain("return 'vendor-editor'");
    expect(vite).toContain("return 'vendor-db'");
    expect(vite).not.toContain("id.includes('/react/')");
    expect(vite).not.toContain("return 'vendor'");
  });

  it('keeps only light first-party obfuscation transformations', () => {
    const obfuscator = read('scripts/obfuscate-first-party.mjs');

    expect(obfuscator).toContain('controlFlowFlattening: false');
    expect(obfuscator).toContain('deadCodeInjection: false');
    expect(obfuscator).toContain('stringArray: false');
    expect(obfuscator).toContain('transformObjectKeys: false');
    expect(obfuscator).toContain("identifierNamesGenerator: 'mangled'");
  });
});
