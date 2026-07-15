import { beforeEach, describe, expect, it } from 'vitest';

import {
  RECENT_WRITING_REQUESTS_KEY,
  addRecentWritingRequest,
  loadRecentWritingRequests,
  persistRecentWritingRequests,
} from '../../components/ai/recentWritingRequests.js';

describe('phase10 recent AI writing requests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps only the three newest non-empty user inputs', () => {
    let recent = [];
    recent = addRecentWritingRequest(recent, '  Viết cảnh mở đầu.  ');
    recent = addRecentWritingRequest(recent, 'Viết tiếp cuộc đối thoại.');
    recent = addRecentWritingRequest(recent, 'Mở rộng đoạn chiến đấu.');
    recent = addRecentWritingRequest(recent, 'Thêm phản ứng của nhân vật phụ.');
    recent = addRecentWritingRequest(recent, '   ');

    expect(recent).toEqual([
      'Thêm phản ứng của nhân vật phụ.',
      'Mở rộng đoạn chiến đấu.',
      'Viết tiếp cuộc đối thoại.',
    ]);
  });

  it('moves a repeated input to the newest position without duplicating it', () => {
    const recent = addRecentWritingRequest(
      ['Mở rộng đoạn chiến đấu.', 'Viết tiếp cuộc đối thoại.', 'Viết cảnh mở đầu.'],
      'Viết tiếp cuộc đối thoại.',
    );

    expect(recent).toEqual([
      'Viết tiếp cuộc đối thoại.',
      'Mở rộng đoạn chiến đấu.',
      'Viết cảnh mở đầu.',
    ]);
  });

  it('persists and reloads only the user-entered strings', () => {
    const saved = persistRecentWritingRequests([
      '  Viết chính theo góc nhìn của Lan.  ',
      'Viết lại đoạn này nhẹ nhàng hơn.',
      '',
      'Mở rộng cảnh gặp gỡ.',
      'Yêu cầu cũ không còn trong giới hạn.',
    ]);

    expect(saved).toEqual([
      'Viết chính theo góc nhìn của Lan.',
      'Viết lại đoạn này nhẹ nhàng hơn.',
      'Mở rộng cảnh gặp gỡ.',
    ]);
    expect(JSON.parse(localStorage.getItem(RECENT_WRITING_REQUESTS_KEY))).toEqual(saved);
    expect(loadRecentWritingRequests()).toEqual(saved);
  });

  it('falls back to an empty history when stored data is invalid', () => {
    localStorage.setItem(RECENT_WRITING_REQUESTS_KEY, '{invalid-json');
    expect(loadRecentWritingRequests()).toEqual([]);

    localStorage.setItem(RECENT_WRITING_REQUESTS_KEY, JSON.stringify({ prompt: 'Không phải danh sách' }));
    expect(loadRecentWritingRequests()).toEqual([]);
  });
});
