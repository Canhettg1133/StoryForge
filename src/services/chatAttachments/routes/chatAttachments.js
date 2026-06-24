import express from 'express';
import multer from 'multer';
import { parseCorpusFile } from '../../corpus/parser/index.js';
import { validateChatAttachmentFile, MAX_CHAT_ATTACHMENT_FILE_BYTES } from '../fileSafety.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CHAT_ATTACHMENT_FILE_BYTES,
  },
});

function toHttpError(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, message: 'Tệp vượt giới hạn 25 MB cho chat.' };
  }
  if (error?.code === 'UNSUPPORTED_FILE_TYPE' || error?.code?.includes('UNSUPPORTED')) {
    return { status: 415, message: error.message };
  }
  if (error?.code === 'PARSE_FAILED' || error?.code?.includes('INVALID')) {
    return { status: 422, message: error.message };
  }
  return { status: 500, message: error?.message || 'Không thể đọc tệp đính kèm.' };
}

function flattenParsedText(parsed = {}) {
  if (parsed.rawText) return String(parsed.rawText);
  return (parsed.chapters || [])
    .map((chapter, index) => [
      chapter.title || `Chương ${index + 1}`,
      chapter.content || '',
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

export function createChatAttachmentsRouter() {
  const router = express.Router();

  router.post('/parse', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Chưa chọn tệp.' });
      }

      const safety = await validateChatAttachmentFile(req.file);
      if (!safety.ok) {
        return res.status(400).json({ error: safety.message, code: safety.code });
      }

      const parsed = await parseCorpusFile({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        options: {},
      });
      const rawText = flattenParsedText(parsed);
      if (!rawText.trim()) {
        return res.status(422).json({ error: 'Tệp không có nội dung văn bản đọc được.' });
      }

      return res.json({
        fileType: parsed.fileType,
        sourceFileName: req.file.originalname,
        title: parsed.metadata?.title || req.file.originalname.replace(/\.[^.]+$/u, ''),
        rawText,
        sectionCount: parsed.chapters?.length || 1,
        metadata: parsed.metadata || {},
      });
    } catch (error) {
      const httpError = toHttpError(error);
      return res.status(httpError.status).json({ error: httpError.message });
    }
  });

  return router;
}
