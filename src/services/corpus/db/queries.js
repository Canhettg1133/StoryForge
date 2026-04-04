import { getCorpusDb } from './schema.js';

const ALLOWED_UPDATE_FIELDS = {
  title: 'title',
  author: 'author',
  fandom: 'fandom',
  isCanonFanfic: 'is_canon_fanfic',
  rating: 'rating',
  language: 'language',
  status: 'status',
  chunkSize: 'chunk_size',
  chunkSizeUsed: 'chunk_size_used',
  chunkCount: 'chunk_count',
  lastRechunkedAt: 'last_rechunked_at',
};

function mapCorpus(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    sourceFile: row.source_file,
    fileType: row.file_type,
    fandom: row.fandom,
    fandomConfidence: row.fandom_confidence == null ? null : Number(row.fandom_confidence),
    isCanonFanfic: row.is_canon_fanfic,
    rating: row.rating,
    language: row.language,
    chunkSize: row.chunk_size == null ? null : Number(row.chunk_size),
    chunkSizeUsed: row.chunk_size_used == null ? null : Number(row.chunk_size_used),
    chunkCount: row.chunk_count == null ? 0 : Number(row.chunk_count),
    lastRechunkedAt: row.last_rechunked_at == null ? null : Number(row.last_rechunked_at),
    wordCount: row.word_count == null ? 0 : Number(row.word_count),
    chapterCount: row.chapter_count == null ? 0 : Number(row.chapter_count),
    status: row.status,
    createdAt: row.created_at == null ? null : Number(row.created_at),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
  };
}

function mapChapter(row, includeContent = false) {
  if (!row) {
    return null;
  }

  const chapter = {
    id: row.id,
    corpusId: row.corpus_id,
    index: row.chapter_index,
    title: row.title,
    wordCount: row.word_count,
    startLine: row.start_line,
    endLine: row.end_line,
    startPage: row.start_page,
    endPage: row.end_page,
  };

  if (includeContent) {
    chapter.content = row.content;
  }

  return chapter;
}

function mapChunk(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    chapterId: row.chapter_id,
    corpusId: row.corpus_id,
    index: row.chunk_index,
    text: row.text,
    wordCount: row.word_count,
    startPosition: row.start_position == null ? null : Number(row.start_position),
    startWord: row.start_word,
    endWord: row.end_word,
  };
}

export function insertCorpusGraph(corpus, chapters = [], chunks = []) {
  const db = getCorpusDb();

  const insertCorpusStatement = db.prepare(`
    INSERT INTO corpuses (
      id, title, author, source_file, file_type, fandom, fandom_confidence,
      is_canon_fanfic, rating, language, chunk_size, chunk_size_used, chunk_count,
      last_rechunked_at, word_count, chapter_count, status, created_at, updated_at
    ) VALUES (
      @id, @title, @author, @sourceFile, @fileType, @fandom, @fandomConfidence,
      @isCanonFanfic, @rating, @language, @chunkSize, @chunkSizeUsed, @chunkCount,
      @lastRechunkedAt, @wordCount, @chapterCount, @status, @createdAt, @updatedAt
    )
  `);

  const insertChapterStatement = db.prepare(`
    INSERT INTO chapters (
      id, corpus_id, chapter_index, title, content, word_count,
      start_line, end_line, start_page, end_page
    ) VALUES (
      @id, @corpusId, @index, @title, @content, @wordCount,
      @startLine, @endLine, @startPage, @endPage
    )
  `);

  const insertChunkStatement = db.prepare(`
    INSERT INTO chunks (
      id, chapter_id, corpus_id, chunk_index, text, word_count,
      start_position, start_word, end_word
    ) VALUES (
      @id, @chapterId, @corpusId, @index, @text, @wordCount,
      @startPosition, @startWord, @endWord
    )
  `);

  const tx = db.transaction(() => {
    insertCorpusStatement.run(corpus);

    for (const chapter of chapters) {
      insertChapterStatement.run(chapter);
    }

    for (const chunk of chunks) {
      insertChunkStatement.run(chunk);
    }
  });

  tx();
}

export function getCorpusById(corpusId, options = {}) {
  const db = getCorpusDb();
  const includeChapterContent = options.includeChapterContent === true;

  const corpusRow = db.prepare('SELECT * FROM corpuses WHERE id = ?').get(corpusId);
  if (!corpusRow) {
    return null;
  }

  const chapterColumns = includeChapterContent
    ? '*'
    : 'id, corpus_id, chapter_index, title, word_count, start_line, end_line, start_page, end_page';

  const chapterRows = db
    .prepare(`
      SELECT ${chapterColumns}
      FROM chapters
      WHERE corpus_id = ?
      ORDER BY chapter_index ASC
    `)
    .all(corpusId);

  return {
    ...mapCorpus(corpusRow),
    chapters: chapterRows.map((row) => mapChapter(row, includeChapterContent)),
  };
}

export function replaceCorpusChunks(corpusId, chunks = []) {
  const db = getCorpusDb();

  const deleteStatement = db.prepare(`
    DELETE FROM chunks
    WHERE corpus_id = @corpusId
  `);

  const insertChunkStatement = db.prepare(`
    INSERT INTO chunks (
      id, chapter_id, corpus_id, chunk_index, text, word_count,
      start_position, start_word, end_word
    ) VALUES (
      @id, @chapterId, @corpusId, @index, @text, @wordCount,
      @startPosition, @startWord, @endWord
    )
  `);

  const tx = db.transaction(() => {
    deleteStatement.run({ corpusId });

    for (const chunk of chunks) {
      insertChunkStatement.run({
        id: chunk.id,
        chapterId: chunk.chapterId,
        corpusId,
        index: chunk.index,
        text: chunk.text,
        wordCount: chunk.wordCount,
        startPosition: chunk.startPosition ?? null,
        startWord: chunk.startWord ?? null,
        endWord: chunk.endWord ?? null,
      });
    }
  });

  tx();
  return chunks.length;
}

export function listCorpuses({
  fandom,
  status,
  search,
  limit = 20,
  offset = 0,
} = {}) {
  const db = getCorpusDb();
  const where = [];
  const params = {};

  if (fandom) {
    where.push('fandom = @fandom');
    params.fandom = fandom;
  }

  if (status) {
    where.push('status = @status');
    params.status = status;
  }

  if (search) {
    where.push('(title LIKE @search OR author LIKE @search OR source_file LIKE @search)');
    params.search = `%${search}%`;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const corpuses = db
    .prepare(`
      SELECT *
      FROM corpuses
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({
      ...params,
      limit: safeLimit,
      offset: safeOffset,
    })
    .map(mapCorpus);

  const totalRow = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM corpuses
      ${whereSql}
    `)
    .get(params);

  return {
    corpuses,
    total: Number(totalRow?.total || 0),
    limit: safeLimit,
    offset: safeOffset,
  };
}

export function updateCorpusById(corpusId, updates = {}) {
  const db = getCorpusDb();
  const setClauses = [];
  const params = {
    id: corpusId,
    updatedAt: Date.now(),
  };

  for (const [inputKey, inputValue] of Object.entries(updates || {})) {
    if (inputValue === undefined || !(inputKey in ALLOWED_UPDATE_FIELDS)) {
      continue;
    }

    const column = ALLOWED_UPDATE_FIELDS[inputKey];
    setClauses.push(`${column} = @${inputKey}`);
    params[inputKey] = inputValue;
  }

  if (setClauses.length === 0) {
    return getCorpusById(corpusId);
  }

  setClauses.push('updated_at = @updatedAt');

  const result = db.prepare(`
    UPDATE corpuses
    SET ${setClauses.join(', ')}
    WHERE id = @id
  `).run(params);

  if (result.changes === 0) {
    return null;
  }

  return getCorpusById(corpusId);
}

export function deleteCorpusById(corpusId) {
  const db = getCorpusDb();
  const result = db.prepare('DELETE FROM corpuses WHERE id = ?').run(corpusId);
  return result.changes > 0;
}

export function getChapterById(corpusId, chapterId) {
  const db = getCorpusDb();

  const chapterRow = db
    .prepare(`
      SELECT *
      FROM chapters
      WHERE id = @chapterId AND corpus_id = @corpusId
      LIMIT 1
    `)
    .get({ chapterId, corpusId });

  if (!chapterRow) {
    return null;
  }

  const chunkRows = db
    .prepare(`
      SELECT *
      FROM chunks
      WHERE chapter_id = @chapterId AND corpus_id = @corpusId
      ORDER BY chunk_index ASC
    `)
    .all({ chapterId, corpusId });

  return {
    ...mapChapter(chapterRow, true),
    chunks: chunkRows.map(mapChunk),
  };
}
