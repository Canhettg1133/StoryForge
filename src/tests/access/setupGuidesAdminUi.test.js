import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('setup guides admin UI contract', () => {
  it('supports batched CRUD, ordering, preview and dirty navigation protection', () => {
    const page = read('apps/admin/src/features/setupGuides/SetupGuidesPage.jsx');
    const app = read('apps/admin/src/App.jsx');
    const api = read('apps/admin/src/adminApi.js');
    const navigation = read('apps/admin/src/constants/navigation.js');
    const styles = read('apps/admin/src/features/setupGuides/setupGuides.css');
    const settingsStyles = read('src/pages/Settings/Settings.css');

    expect(page).toContain('updateSetupGuides');
    expect(page).toContain('expectedRevision');
    expect(page).toContain('Thêm nút');
    expect(page).toContain('Xem trước');
    expect(page).toContain('moveItem');
    expect(page).toContain('setItems((current) => current.filter');
    expect(page).toContain('beforeunload');
    expect(app).toContain('canDiscardSetupGuideChanges');
    expect(app).toContain('onDirtyChange={setSetupGuidesDirty}');
    expect(api).toContain("requestIdempotentMutation('/setup-guides'");
    expect(api).toContain("path === '/setup-guides' ? 'PUT' : 'POST'");
    expect(navigation).toContain("permission: ADMIN_PERMISSIONS.CATALOG_READ");
    expect(styles).toMatch(/\.setup-guide-item \.icon-button[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/u);
    expect(settingsStyles).toMatch(/\.setup-guide-button\s*\{[\s\S]*?min-height:\s*44px;/u);
    expect(app).not.toContain('<React.Suspense fallback={null}>');
  });
});


