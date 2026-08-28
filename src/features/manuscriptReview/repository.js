import db from '../../services/db/database.js';
import { REVIEW_MODES } from './constants.js';

const reportType = (mode, scope) => `manuscript_review:${mode}:${scope}`;

export async function loadReviewReports({ projectId, sceneId, scope }) {
  if (!projectId || !sceneId) return [];
  const types = REVIEW_MODES.map((mode) => reportType(mode, scope));
  return db.qaReports.where('scene_id').equals(sceneId)
    .filter((row) => row.project_id === projectId && types.includes(row.report_type)).toArray();
}

export async function saveReviewReport(report, isCancelled = () => false) {
  const row = { ...report, report_type: reportType(report.mode, report.scope) };
  return db.transaction('rw', db.qaReports, async () => {
    const previous = await db.qaReports.where('scene_id').equals(row.scene_id)
      .filter((item) => item.project_id === row.project_id && item.report_type === row.report_type).primaryKeys();
    if (isCancelled()) return null;
    await db.qaReports.bulkDelete(previous);
    const id = await db.qaReports.add(row);
    // Cancelling during the transaction must roll back deletion as well as insertion.
    if (isCancelled()) throw new Error('Đã hủy lưu báo cáo.');
    return { ...row, id };
  });
}
