import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('phase21 Story Bundle UI contract', () => {
  it('keeps publishing export separate from offline backup and exposes import on Dashboard', () => {
    const dashboard = readFileSync('src/pages/Dashboard/Dashboard.jsx', 'utf8');
    const modal = readFileSync('src/components/storyBundle/StoryBundleModal.jsx', 'utf8');

    expect(dashboard).toContain('Xuất bản truyện');
    expect(dashboard).toContain('Sao lưu truyện (.storyforge)');
    expect(dashboard).toContain('Nhập file StoryForge');
    expect(modal).toContain('Không dữ liệu nào bị thay đổi trước khi kiểm tra file hoàn tất');
    expect(modal).toContain('Kèm workspace Lab Lite');
    expect(modal).toContain('Bảo vệ bằng mật khẩu');
    expect(modal).toContain('Gõ đúng tên project');
  });

  it('keeps the open project menu above neighboring cards on desktop and mobile', () => {
    const dashboard = readFileSync('src/pages/Dashboard/Dashboard.jsx', 'utf8');
    const dashboardCss = readFileSync('src/pages/Dashboard/Dashboard.css', 'utf8');

    expect(dashboard).toContain('project-card--menu-open');
    expect(dashboardCss).toMatch(/\.project-card--menu-open\s*\{[^}]*z-index:\s*1/s);
  });

  it('labels Cloud archive export distinctly and shows offline backup and quota usage', () => {
    const cloud = readFileSync('src/pages/Settings/CloudSyncSection.jsx', 'utf8');

    expect(cloud).toContain('Xuất kho snapshot Cloud');
    expect(cloud).toContain('Sao lưu ngoại tuyến');
    expect(cloud).toContain('256 MiB');
    expect(cloud).toContain('Khôi phục đầy đủ');
    expect(cloud).not.toContain('Project được chọn sẽ bị xóa khỏi máy trước khi import snapshot.');
  });
});
