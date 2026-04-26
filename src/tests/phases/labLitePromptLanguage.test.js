import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const promptFiles = [
  'src/services/labLite/prompts/chapterScoutPrompt.js',
  'src/services/labLite/prompts/arcMapperPrompt.js',
  'src/services/labLite/prompts/deepAnalysisPrompt.js',
  'src/services/labLite/prompts/canonReviewPrompt.js',
  'src/services/viewer/adaptationService.js',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Lab Lite prompt language contract', () => {
  it('keeps Lab Lite and related adaptation AI instructions in Vietnamese with diacritics', () => {
    const forbiddenInstructionFragments = [
      'You are StoryForge',
      'Return strict JSON only',
      'No markdown',
      'Do not rely on fixed keywords',
      'Use only the provided',
      'Use only the scout metadata',
      'Extract canon artifacts',
      'Your job is to suggest',
      'Short reason grounded',
      'number from 0 to 1',
      'You are a storytelling expert',
      'Only output valid JSON',
      'Be specific about character equivalents',
    ];

    for (const file of promptFiles) {
      const content = read(file);
      expect(content).toContain('Chỉ trả JSON hợp lệ');
      for (const fragment of forbiddenInstructionFragments) {
        expect(content, `${file} still contains English instruction: ${fragment}`).not.toContain(fragment);
      }
    }
  });
});
