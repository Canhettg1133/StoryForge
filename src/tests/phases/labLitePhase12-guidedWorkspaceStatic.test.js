import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Lab Lite Phase 12 - guided workspace static UX contract', () => {
  it('exposes a guided workspace rail and next action panel', () => {
    const labLite = read('src/pages/Lab/LabLite/LabLite.jsx');
    const rail = read('src/pages/Lab/LabLite/components/GuidedWorkspaceRail.jsx');

    expect(labLite).toContain('GuidedWorkspaceRail');
    expect(rail).toContain('Việc tiếp theo');
    expect(labLite).toContain('Nạp liệu -> Quét nhanh');
    expect(rail).toContain('data-testid="lab-lite-guided-workspace"');
    expect(rail).toContain('Chạy bước đề xuất');
  });

  it('adds Canon Pack readiness and author-readable preview tabs instead of a JSON-first preview', () => {
    const labLite = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(labLite).toContain('evaluateCanonPackReadiness');
    expect(labLite).toContain('Dùng Canon Pack để viết');
    expect(labLite).toContain('Nhân vật');
    expect(labLite).toContain('Quan hệ');
    expect(labLite).toContain('Cấm phá canon');
    expect(labLite).toContain('Vùng trống');
    expect(labLite).not.toContain('globalCanon: latestPack.globalCanon');
  });

  it('uses Deep Selection Planner presets for large corpus selection', () => {
    const labLite = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(labLite).toContain('Phân tích sâu');
    expect(labLite).toContain('AI tự chọn phần quan trọng');
    expect(labLite).toContain('Cảnh 18+ / nhạy cảm');
    expect(labLite).toContain('buildDeepSelectionPlan');
    expect(labLite).not.toContain('chapters.slice(0, 180)');
  });

  it('surfaces nạp thêm, adult Canon, fanfic CTA, and materialize selection controls', () => {
    const labLite = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(labLite).toContain('Lịch sử lượt nạp');
    expect(labLite).toContain('Cảnh 18+');
    expect(labLite).toContain('Adult Canon đang được ẩn');
    expect(labLite).toContain('Tạo project đồng nhân từ Canon Pack');
    expect(labLite).toContain('Mở editor với Canon Pack');
    expect(labLite).toContain('Đưa vào Story Bible');
    expect(labLite).toContain('selectedActionIds');
  });
});
