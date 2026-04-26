import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FILES = [
  'src/pages/Lab/LabLite/LabLite.jsx',
  'src/pages/Lab/LabLite/LabLite.css',
  'src/services/labLite/deepAnalyzer.js',
  'src/services/labLite/prompts/deepAnalysisPrompt.js',
  'src/services/labLite/canonPackBuilder.js',
  'src/services/labLite/canonPackSchema.js',
  'src/services/labLite/canonPackContext.js',
  'src/services/labLite/canonPackReadiness.js',
  'src/services/labLite/chapterScout.js',
  'src/services/labLite/fileReader.js',
  'src/services/labLite/ingestWorker.js',
  'src/services/labLite/longContextPlanner.js',
  'src/services/labLite/fanficProjectSetup.js',
  'src/services/labLite/materializeCanonPack.js',
  'src/stores/labLiteStore.js',
  'src/services/labLite/analysisValidation.js',
  'src/components/ai/AISidebar.jsx',
  'src/components/ai/AISidebar.css',
  'src/pages/Dashboard/NewProjectModal.jsx',
  'src/services/ai/promptBuilder/systemParts.js',
  'src/tests/helpers/labLiteTestUtils.js',
  'src/tests/phases/labLiteDbLocalFirst.test.js',
  'src/tests/phases/labLiteStoreLocalFirstFlow.test.js',
  'src/tests/phases/labLiteScoutCoverageValidation.test.js',
  'src/tests/phases/labLiteGeminiBudgetPlanner.test.js',
  'src/tests/phases/labLiteFileReaderWorkerFallback.test.js',
  'src/tests/phases/labLiteUiLocalFirstContract.test.jsx',
  'src/tests/phases/labLiteProjectScope.test.js',
  'src/tests/phases/labLiteReadinessCoverage.test.js',
  'src/tests/phases/labLitePhase8-uiEncoding.test.js',
];

const MOJIBAKE_MARKERS = [
  'Ch\u00c6',
  '\u00c4\u2018',
  'ph\u0102',
  'Ph\u0102',
  'D\u00e1\u00bb',
  'N\u00e1\u00ba',
  '\u00c6\u00b0',
  '\u00e1\u00ba',
  '\u0102\u00a9',
  '\u0102\u00a2',
  '\u0102\u00aa',
  '\u0102\u00b4',
  '\u0102\u00aa',
  '\u00ef\u00bf\u00bd',
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Lab Lite Phase 8 - Vietnamese UI/source encoding', () => {
  it('does not introduce common mojibake markers in Lab Lite UI, services, or tests', () => {
    const offenders = FILES.flatMap((file) => {
      const content = read(file);
      return MOJIBAKE_MARKERS
        .filter((marker) => content.includes(marker))
        .map((marker) => `${file}:${marker}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps key Lab Lite user-facing strings as Vietnamese with diacritics', () => {
    const page = read('src/pages/Lab/LabLite/LabLite.jsx');

    expect(page).toContain('Phân tích nhanh');
    expect(page).toContain('Phân tích đầy đủ');
    expect(page).toContain('Phân tích sâu');
    expect(page).toContain('Độ phủ phân tích');
    expect(page).toContain('Chương');
    expect(page).toContain('Dữ liệu');
    expect(page).toContain('Chưa có dữ liệu Lab Lite cho dự án này.');
    expect(page).not.toContain('Phan tich nhanh');
    expect(page).not.toContain('Do phu phan tich');
  });

  it('keeps validation defaults readable for Vietnamese users', () => {
    const scout = read('src/services/labLite/chapterScout.js');
    const store = read('src/stores/labLiteStore.js');

    expect(scout).toContain('AI không trả lý do.');
    expect(scout).toContain('AI không trả kết quả cho chương này.');
    expect(store).toContain('Hãy chọn chương hoặc arc để phân tích sâu.');
    expect(store).not.toContain('AI khong tra ly do');
    expect(store).not.toContain('phan tich sau');
  });
});
