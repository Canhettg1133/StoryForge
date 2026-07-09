import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('upload multipart limits', () => {
  it('limits file count, field count, part count, and field name size for local uploads', () => {
    const corpus = read('src/services/corpus/routes/corpus.js');
    const chatAttachments = read('src/services/chatAttachments/routes/chatAttachments.js');

    for (const source of [corpus, chatAttachments]) {
      expect(source).toContain('files: 1');
      expect(source).toContain('fields:');
      expect(source).toContain('parts:');
      expect(source).toContain('fieldNameSize: 100');
    }
  });
});
