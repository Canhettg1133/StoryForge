import { z } from 'zod';

export const ScoutBatchItemSchema = z.object({
  chapterIndex: z.coerce.number().int().positive(),
  priority: z.string().optional(),
  recommendation: z.string().optional(),
  detectedSignals: z.array(z.string()).optional(),
  reason: z.string().optional(),
  confidence: z.coerce.number().optional(),
}).passthrough();

export const ScoutBatchSchema = z.union([
  z.array(ScoutBatchItemSchema),
  z.object({ results: z.array(ScoutBatchItemSchema) }).passthrough(),
]);

export function extractScoutBatchItems(rawResult) {
  const parsed = ScoutBatchSchema.safeParse(rawResult);
  if (!parsed.success) {
    return {
      ok: false,
      items: [],
      missingChapterIndexes: [],
      extraChapterIndexes: [],
      error: parsed.error,
    };
  }
  const value = parsed.data;
  return {
    ok: true,
    items: Array.isArray(value) ? value : value.results,
    missingChapterIndexes: [],
    extraChapterIndexes: [],
    error: null,
  };
}

export function validateChapterCoverage(rawItems = [], expectedChapterIndexes = []) {
  const expected = new Set((expectedChapterIndexes || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0));
  const seen = new Set();
  const extra = new Set();

  for (const item of rawItems || []) {
    const chapterIndex = Number(item?.chapterIndex || 0);
    if (!Number.isFinite(chapterIndex) || chapterIndex <= 0) continue;
    if (expected.has(chapterIndex)) seen.add(chapterIndex);
    else extra.add(chapterIndex);
  }

  return {
    missingChapterIndexes: [...expected].filter((chapterIndex) => !seen.has(chapterIndex)).sort((a, b) => a - b),
    extraChapterIndexes: [...extra].sort((a, b) => a - b),
  };
}
