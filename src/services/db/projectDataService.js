import db from './database.js';

export async function deleteProjectCascade(projectId) {
  const normalizedProjectId = Number(projectId);
  if (!Number.isFinite(normalizedProjectId) || normalizedProjectId <= 0) {
    throw new Error('Project ID khong hop le de xoa.');
  }

  const projectPlotThreads = await db.plotThreads.where('project_id').equals(normalizedProjectId).toArray();
  const plotThreadIds = projectPlotThreads.map((item) => item.id);

  await Promise.all([
    db.projects.delete(normalizedProjectId),
    db.chapters.where('project_id').equals(normalizedProjectId).delete(),
    db.scenes.where('project_id').equals(normalizedProjectId).delete(),
    db.characters.where('project_id').equals(normalizedProjectId).delete(),
    db.characterStates.where('project_id').equals(normalizedProjectId).delete(),
    db.relationships.where('project_id').equals(normalizedProjectId).delete(),
    db.locations.where('project_id').equals(normalizedProjectId).delete(),
    db.objects.where('project_id').equals(normalizedProjectId).delete(),
    db.canonFacts.where('project_id').equals(normalizedProjectId).delete(),
    db.plotThreads.where('project_id').equals(normalizedProjectId).delete(),
    db.timelineEvents.where('project_id').equals(normalizedProjectId).delete(),
    db.stylePacks.where('project_id').equals(normalizedProjectId).delete(),
    db.voicePacks.where('project_id').equals(normalizedProjectId).delete(),
    db.aiJobs.where('project_id').equals(normalizedProjectId).delete(),
    db.qaReports.where('project_id').equals(normalizedProjectId).delete(),
    db.suggestions.where('project_id').equals(normalizedProjectId).delete(),
    db.entity_resolution_candidates.where('project_id').equals(normalizedProjectId).delete(),
    db.project_analysis_snapshots.where('project_id').equals(normalizedProjectId).delete(),
    db.worldTerms.where('project_id').equals(normalizedProjectId).delete(),
    db.taboos.where('project_id').equals(normalizedProjectId).delete(),
    db.chapterMeta.where('project_id').equals(normalizedProjectId).delete(),
    db.entityTimeline.where('project_id').equals(normalizedProjectId).delete(),
    db.factions.where('project_id').equals(normalizedProjectId).delete(),
    db.macro_arcs.where('project_id').equals(normalizedProjectId).delete(),
    db.arcs.where('project_id').equals(normalizedProjectId).delete(),
    db.story_events.where('project_id').equals(normalizedProjectId).delete(),
    db.entity_state_current.where('project_id').equals(normalizedProjectId).delete(),
    db.plot_thread_state.where('project_id').equals(normalizedProjectId).delete(),
    db.validator_reports.where('project_id').equals(normalizedProjectId).delete(),
    db.memory_evidence.where('project_id').equals(normalizedProjectId).delete(),
    db.chapter_revisions.where('project_id').equals(normalizedProjectId).delete(),
    db.chapter_commits.where('project_id').equals(normalizedProjectId).delete(),
    db.chapter_snapshots.where('project_id').equals(normalizedProjectId).delete(),
    db.canon_purge_archives.where('project_id').equals(normalizedProjectId).delete(),
    db.ai_chat_threads.where('project_id').equals(normalizedProjectId).delete(),
    db.ai_chat_messages.where('project_id').equals(normalizedProjectId).delete(),
    ...(plotThreadIds.length > 0
      ? [db.threadBeats.where('plot_thread_id').anyOf(plotThreadIds).delete()]
      : []),
  ]);
}

export default {
  deleteProjectCascade,
};
