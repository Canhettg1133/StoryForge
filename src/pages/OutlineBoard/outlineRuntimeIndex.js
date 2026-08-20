export function buildOutlineRuntimeIndex({
  chapters = [],
  scenes = [],
  characters = [],
  locations = [],
} = {}) {
  const sceneCountByChapterId = new Map();
  const wordCountByChapterId = new Map();
  const firstSceneByChapterId = new Map();
  const firstPovIdByChapterId = new Map();
  const firstLocationIdByChapterId = new Map();
  const characterNameById = new Map(characters.map((character) => [character.id, character.name]));
  const locationNameById = new Map(locations.map((location) => [location.id, location.name]));

  for (const chapter of chapters) {
    sceneCountByChapterId.set(chapter.id, 0);
    const storedWordCount = Number(chapter.actual_word_count);
    wordCountByChapterId.set(
      chapter.id,
      Number.isFinite(storedWordCount) && storedWordCount >= 0 ? storedWordCount : 0,
    );
  }

  for (const scene of scenes) {
    const chapterId = scene.chapter_id;
    sceneCountByChapterId.set(chapterId, (sceneCountByChapterId.get(chapterId) || 0) + 1);
    if (!firstSceneByChapterId.has(chapterId)) {
      firstSceneByChapterId.set(chapterId, scene);
    }
    if (scene.pov_character_id && !firstPovIdByChapterId.has(chapterId)) {
      firstPovIdByChapterId.set(chapterId, scene.pov_character_id);
    }
    if (scene.location_id && !firstLocationIdByChapterId.has(chapterId)) {
      firstLocationIdByChapterId.set(chapterId, scene.location_id);
    }
  }

  return {
    sceneCountByChapterId,
    wordCountByChapterId,
    firstSceneByChapterId,
    povNameByChapterId: new Map(
      [...firstPovIdByChapterId].map(([chapterId, characterId]) => (
        [chapterId, characterNameById.get(characterId) || null]
      )),
    ),
    locationNameByChapterId: new Map(
      [...firstLocationIdByChapterId].map(([chapterId, locationId]) => (
        [chapterId, locationNameById.get(locationId) || null]
      )),
    ),
  };
}
