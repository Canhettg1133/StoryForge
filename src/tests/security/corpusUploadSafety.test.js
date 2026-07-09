import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  MAX_CORPUS_UPLOAD_FILE_BYTES,
  validateCorpusUploadFile,
} from '../../services/chatAttachments/fileSafety.js';

function makeFile(name, content, type = 'text/plain') {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    originalname: name,
    mimetype: type,
    size: buffer.length,
    buffer,
  };
}

async function makeZipFile(name, entries, type) {
  const zip = new JSZip();
  Object.entries(entries).forEach(([entryName, entryText]) => {
    zip.file(entryName, entryText);
  });
  return makeFile(name, Buffer.from(await zip.generateAsync({ type: 'uint8array' })), type);
}

describe('corpus upload safety', () => {
  it('uses corpus limits instead of chat attachment limits for large text uploads', async () => {
    const file = {
      originalname: 'long-story.txt',
      mimetype: 'text/plain',
      size: 30 * 1024 * 1024,
      buffer: Buffer.from('Chapter 1\nSafe text.'),
    };

    const result = await validateCorpusUploadFile(file);

    expect(MAX_CORPUS_UPLOAD_FILE_BYTES).toBeGreaterThan(30 * 1024 * 1024);
    expect(result).toMatchObject({ ok: true, fileType: 'txt' });
  });

  it('rejects executable or browser-rendered corpus uploads before parsing', async () => {
    await expect(validateCorpusUploadFile(makeFile('page.html', '<script>alert(1)</script>', 'text/html')))
      .resolves.toMatchObject({ ok: false, code: 'UNSAFE_EXTENSION' });
    await expect(validateCorpusUploadFile(makeFile('fake.pdf', 'not a pdf', 'application/pdf')))
      .resolves.toMatchObject({ ok: false, code: 'PDF_INVALID_SIGNATURE' });
  });

  it('rejects DOCX/EPUB zip containers with unsafe paths before parsing', async () => {
    const docx = await makeZipFile('story.docx', {
      '[Content_Types].xml': '<Types></Types>',
      '../evil.txt': 'bad',
    }, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    await expect(validateCorpusUploadFile(docx))
      .resolves.toMatchObject({ ok: false, code: 'ZIP_UNSAFE_PATH' });
  });
});
