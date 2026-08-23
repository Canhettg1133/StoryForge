import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('admin delivery performance guard', () => {
  it('keeps independent non-default feature views out of the eager admin shell', () => {
    const app = read('apps/admin/src/App.jsx');

    expect(app).not.toContain("import PromptSettingsPage from './features/promptSettings/PromptSettingsPage.jsx'");
    expect(app).not.toContain("import StoryMirrorPage from './features/storyMirror/StoryMirrorPage.jsx'");
    expect(app).toContain("React.lazy(() => import('./features/promptSettings/PromptSettingsPage.jsx'))");
    expect(app).toContain("React.lazy(() => import('./features/storyMirror/StoryMirrorPage.jsx'))");
    expect(app).toContain('<React.Suspense');
  });

  it('keeps large admin collections bounded or server-paginated', () => {
    const worker = read('apps/admin-api-worker/src/index.js');
    const api = read('apps/admin/src/adminApi.js');

    expect(worker).toContain('order=updated_at.desc&limit=200');
    expect(worker).toContain('order=created_at.desc&limit=200');
    expect(api).toContain('pageSize = 100');
    expect(api).toContain("return request(`/usage?${query.toString()}`)");
  });
});


