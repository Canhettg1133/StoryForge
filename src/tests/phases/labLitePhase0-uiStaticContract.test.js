import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Lab Lite Phase 0 - UI static contract', () => {
  it('keeps Lab Lite styles scoped to the Lab Lite page', () => {
    const css = read('src/pages/Lab/LabLite/LabLite.css');

    expect(css).toContain('.lab-lite-page');
    expect(css).toContain('.lab-lite-grid');
    expect(css).not.toContain('.corpus-lab-page');
    expect(css).not.toContain('.narrative-lab');
  });

  it('shows the non-guarantee canon review product message in the page copy', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).toContain('AI chỉ gợi ý phát hiện lệch canon');
    expect(page).not.toContain('dam bao 100%');
    expect(page).not.toContain('đảm bảo 100%');
    expect(page).not.toContain('guarantee');
  });

  it('keeps Lab Lite upload accept list limited to browser MVP file types', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).toContain('accept=".txt,.md,.docx"');
    expect(page).not.toContain('.pdf');
    expect(page).not.toContain('.epub');
  });

  it('renders expected Phase 1-3 surface headings', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).toContain('Nạp liệu offline');
    expect(page).toContain('Danh sách chương');
    expect(page).toContain('Xem trước chương');
    expect(page).toContain('AI quét chương');
    expect(page).toContain('Bản đồ arc');
  });

  it('uses Vietnamese diacritics and the product term Nạp liệu instead of Nhập liệu', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).toContain("label: 'Nạp liệu'");
    expect(page).toContain('Nạp liệu trực tiếp trên trình duyệt');
    expect(page).not.toContain('Nhập liệu');
    expect(page).not.toContain('Nhap lieu');
    expect(page).not.toContain('Nap lieu');
    expect(page).not.toContain('Browser-only corpus import');
  });

  it('does not expose raw Scout enum labels in the Lab Lite UI', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).toContain("deep_load: 'Nạp sâu'");
    expect(page).toContain("light_load: 'Nạp nhẹ'");
    expect(page).toContain("skip: 'Bỏ qua'");
    expect(page).toContain('getRecommendationLabel(result.recommendation)');
    expect(page).not.toContain('{result.recommendation} - {result.priority}');
  });

  it('offers a visible way to rerun all Scout results after prompt/UI changes', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');
    const store = read('src/stores/labLiteStore.js');

    expect(page).toContain('Quét lại tất cả');
    expect(page).toContain('forceRerun');
    expect(store).toContain('forceRerun = false');
    expect(store).toContain('if (forceRerun) return true;');
  });

  it('shows long-context Scout planning instead of hiding request cost from the user', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');
    const store = read('src/stores/labLiteStore.js');

    expect(page).toContain('planLabLiteScoutBatches');
    expect(page).toContain('request quét');
    expect(page).toContain('chương/request');
    expect(store).toContain('runChapterScoutBatch');
    expect(store).toContain('estimatedRequests');
  });

  it('does not import Corpus Lab components into Lab Lite UI', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).not.toContain('../CorpusLab');
    expect(page).not.toContain('UploadDropzone from');
    expect(page).not.toContain('ChapterList from');
  });
});
