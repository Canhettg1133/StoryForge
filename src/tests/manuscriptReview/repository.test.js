import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import db from '../../services/db/database.js';
import { loadReviewReports, saveReviewReport } from '../../features/manuscriptReview/repository.js';

const base = { project_id: 1, chapter_id: 2, scene_id: 3, scope: 'scene', mode: 'signals', result: { summary: 'Cũ', findings: [] } };
beforeEach(async () => { await db.qaReports.clear(); });

it('rolls back both deletion and insertion if cancellation arrives during the transaction', async () => {
  await saveReviewReport(base);
  let checks = 0;
  await expect(saveReviewReport({ ...base, result: { summary: 'Mới' } }, () => ++checks > 1)).rejects.toThrow(/hủy/iu);
  const rows = await loadReviewReports({ projectId: 1, sceneId: 3, scope: 'scene' });
  expect(rows).toHaveLength(1); expect(rows[0].result.summary).toBe('Cũ');
});

it('replaces only the same project, scene, scope and pass, including a clean report', async () => {
  await saveReviewReport(base);
  await saveReviewReport({ ...base, project_id: 4 });
  await saveReviewReport({ ...base, scene_id: 5 });
  await saveReviewReport({ ...base, scope: 'selection' });
  await saveReviewReport({ ...base, mode: 'adherence' });
  await db.qaReports.add({ ...base, report_type: 'qa_check' });
  await saveReviewReport({ ...base, result: { summary: 'Không có vấn đề.', findings: [] } });
  expect(await db.qaReports.count()).toBe(6);
  const rows = await loadReviewReports({ projectId: 1, sceneId: 3, scope: 'scene' });
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.mode === 'signals').result.findings).toEqual([]);
  expect(rows.find((row) => row.mode === 'signals').result.summary).toBe('Không có vấn đề.');
});
