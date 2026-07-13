import { deleteProjectSnapshotData } from './projectSnapshot.js';

export async function deleteProjectCascade(projectId) {
  return deleteProjectSnapshotData(projectId);
}

export default {
  deleteProjectCascade,
};
