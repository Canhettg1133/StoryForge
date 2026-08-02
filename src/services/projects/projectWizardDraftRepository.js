import db from '../db/database.js';

export const PROJECT_WIZARD_DRAFT_ID = 'ai-story-wizard';
export const PROJECT_WIZARD_DRAFT_VERSION = 1;

let writeQueue = Promise.resolve();

function getDraftTable() {
  return db.wizard_drafts || null;
}

export async function loadProjectWizardDraft() {
  const table = getDraftTable();
  if (!table) return null;

  await writeQueue.catch(() => undefined);
  const record = await table.get(PROJECT_WIZARD_DRAFT_ID);
  if (
    !record
    || record.version !== PROJECT_WIZARD_DRAFT_VERSION
    || !record.payload
    || typeof record.payload !== 'object'
  ) {
    return null;
  }
  return record;
}

export function saveProjectWizardDraft(payload) {
  const table = getDraftTable();
  if (!table) return Promise.resolve(null);

  const record = {
    id: PROJECT_WIZARD_DRAFT_ID,
    version: PROJECT_WIZARD_DRAFT_VERSION,
    updated_at: Date.now(),
    payload,
  };

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => table.put(record));

  return writeQueue.then(() => record);
}

export function clearProjectWizardDraft() {
  const table = getDraftTable();
  if (!table) return Promise.resolve();

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => table.delete(PROJECT_WIZARD_DRAFT_ID));

  return writeQueue;
}
