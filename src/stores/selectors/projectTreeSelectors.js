const CHAPTER_TREE_FIELDS = ['id', 'project_id', 'title', 'status', 'actual_word_count'];
const SCENE_TREE_FIELDS = ['id', 'project_id', 'chapter_id', 'title', 'order_index', 'status'];

function projectStableRows(rows, previousRows, fields) {
  const source = Array.isArray(rows) ? rows : [];
  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  let changed = source.length !== previousRows.length;
  const projected = source.map((row, index) => {
    const previous = previousById.get(row.id);
    if (previous && fields.every((field) => previous[field] === row[field])) {
      if (previousRows[index] !== previous) changed = true;
      return previous;
    }
    changed = true;
    return Object.fromEntries(fields.map((field) => [field, row[field]]));
  });
  return changed ? projected : previousRows;
}

export function createProjectTreeSelector() {
  let chapters = [];
  let scenes = [];

  return (state) => {
    chapters = projectStableRows(state.chapters, chapters, CHAPTER_TREE_FIELDS);
    scenes = projectStableRows(state.scenes, scenes, SCENE_TREE_FIELDS);
    return {
      chapters,
      scenes,
      activeChapterId: state.activeChapterId,
      activeSceneId: state.activeSceneId,
      completingChapterId: state.completingChapterId,
      chapterCompletionById: state.chapterCompletionById,
    };
  };
}
