import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Lab Lite visibility and fanfic flow completion', () => {
  it('keeps Lab Lite visible by default through a dedicated browser-only gate', () => {
    const productSurface = read('src/config/productSurface.js');
    const app = read('src/App.jsx');
    const sidebar = read('src/components/common/Sidebar.jsx');
    const dashboard = read('src/pages/Dashboard/Dashboard.jsx');
    const mobileShell = read('src/components/mobile/MobileProjectShell.jsx');

    expect(productSurface).toContain('showLabLite: import.meta.env.VITE_SHOW_LAB_LITE !==');
    expect(productSurface).toContain("item.id === 'lab-lite' || item.surface === 'lab-lite'");
    expect(app).toContain('PRODUCT_SURFACE.showLabLite ? <LabLite /> : labFallback');
    expect(sidebar).toContain("surface: 'lab-lite'");
    expect(dashboard).toContain("surface: 'lab-lite'");
    expect(mobileShell).toContain("id: 'lab-lite'");
  });

  it('gives fanfic projects without a Canon Pack a visible path back to Lab Lite', () => {
    const sidebar = read('src/components/ai/AISidebar.jsx');

    expect(sidebar).toContain('Chưa liên kết Canon Pack');
    expect(sidebar).toContain('Mở Lab Lite để nạp liệu');
    expect(sidebar).toContain("navigate(`/project/${currentProject.id}/lab-lite`)");
  });

  it('allows a built Canon Pack to be linked to the current project from Lab Lite', () => {
    const labLite = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(labLite).toContain('Dùng cho dự án này');
    expect(labLite).toContain('source_canon_pack_id: canonPackId');
    expect(labLite).toContain("project_mode: ['fanfic', 'rewrite', 'translation_context'].includes(currentMode) ? currentMode : 'fanfic'");
    expect(labLite).toContain('canon_adherence_level');
  });
});
