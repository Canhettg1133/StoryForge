import {
  pgGetChapterById,
  pgGetCorpusById,
  pgListCorpuses,
} from '../../storage/postgres/read.js';
import {
  pgDeleteCorpusById,
  pgInsertCorpusGraph,
  pgReplaceCorpusChunks,
  pgUpdateCorpusById,
} from '../../storage/postgres/write.js';

export const corpusRepository = {
  async insertGraph(corpus, chapters = [], chunks = []) {
    return pgInsertCorpusGraph(corpus, chapters, chunks);
  },

  async getByIdAsync(corpusId, options = {}) {
    return pgGetCorpusById(corpusId, options);
  },

  async getChapterByIdAsync(corpusId, chapterId) {
    return pgGetChapterById(corpusId, chapterId);
  },

  async listAsync(filters = {}) {
    return pgListCorpuses(filters);
  },

  async replaceChunks(corpusId, chunks = []) {
    return pgReplaceCorpusChunks(corpusId, chunks);
  },

  async updateById(corpusId, updates = {}) {
    return pgUpdateCorpusById(corpusId, updates);
  },

  async deleteById(corpusId) {
    return pgDeleteCorpusById(corpusId);
  },
};
