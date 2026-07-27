import { describe, expect, it } from 'vitest';
import {
  classifySupremeChunkResult,
  classifySupremeMergeResult,
  getReusableSupremeChunkNote,
} from '../../services/ai/supremeFullRead.js';

describe('Supreme full-read resume and blocked-output state', () => {
  it('reuses a previously completed safe chunk instead of calling the provider again', () => {
    expect(getReusableSupremeChunkNote({
      ai_notes: 'Ghi chú an toàn đã lưu.',
      ai_error_code: '',
    })).toBe('Ghi chú an toàn đã lưu.');
    expect(getReusableSupremeChunkNote({
      ai_notes: 'Không được dùng',
      ai_error_code: 'PROTECTED_OUTPUT_BLOCKED',
    })).toBe('');
  });

  it('never classifies a protected blocked response as a reusable note', () => {
    expect(classifySupremeChunkResult({
      blocked: true,
      text: 'Câu từ chối cố định.',
      skippedAttachmentChunks: [],
    })).toEqual({
      note: '',
      errorCode: 'PROTECTED_OUTPUT_BLOCKED',
    });
  });

  it('keeps a server-skipped injection as an error while accepting safe output', () => {
    expect(classifySupremeChunkResult({
      blocked: false,
      text: 'Ghi chú hợp lệ.',
      skippedAttachmentChunks: [],
    })).toEqual({
      note: 'Ghi chú hợp lệ.',
      errorCode: '',
    });
    expect(classifySupremeChunkResult({
      blocked: false,
      text: 'Không được lưu',
      skippedAttachmentChunks: [{
        fileId: 12,
        chunkIndex: 4,
        code: 'UNTRUSTED_INSTRUCTION_BLOCKED',
      }],
    })).toEqual({
      note: '',
      errorCode: 'UNTRUSTED_INSTRUCTION_BLOCKED',
    });
  });

  it('never accepts a blocked, skipped, or empty merge result as a file profile', () => {
    expect(classifySupremeMergeResult({
      blocked: false,
      text: 'Hồ sơ an toàn.',
      skippedAttachmentChunks: [],
    })).toEqual({
      profileText: 'Hồ sơ an toàn.',
      errorCode: '',
    });
    expect(classifySupremeMergeResult({
      blocked: true,
      text: 'Không được lưu.',
      skippedAttachmentChunks: [],
    }).errorCode).toBe('PROTECTED_OUTPUT_BLOCKED');
    expect(classifySupremeMergeResult({
      blocked: false,
      text: 'Không được lưu.',
      skippedAttachmentChunks: [{ fileId: 1, chunkIndex: 0 }],
    }).errorCode).toBe('UNTRUSTED_INSTRUCTION_BLOCKED');
    expect(classifySupremeMergeResult({
      blocked: false,
      text: '   ',
      skippedAttachmentChunks: [],
    }).errorCode).toBe('SUPREME_EMPTY_OUTPUT');
  });
});
