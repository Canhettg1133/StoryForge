import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getHistory: vi.fn(),
  getDetail: vi.fn(),
}));

vi.mock('../../services/canon/queries', () => ({
  getChapterRevisionHistory: mocks.getHistory,
  getChapterRevisionDetail: mocks.getDetail,
}));

import ChapterChangeHistory from '../../components/editor/ChapterChangeHistory.jsx';

const currentRevision = {
  id: 102,
  revision_number: 2,
  status: 'canonical',
  is_current: true,
  is_canonical: true,
  event_count: 2,
  report_count: 1,
  evidence_count: 2,
  extraction_status: 'succeeded',
  extracted_count: 3,
  committed_count: 2,
  filtered_count: 1,
  extraction_retried: true,
  extraction_attempt_count: 2,
  created_at: Date.UTC(2026, 7, 1, 8, 0, 0),
};

const olderRevision = {
  id: 101,
  revision_number: 1,
  status: 'superseded',
  event_count: 1,
  report_count: 0,
  evidence_count: 1,
  extraction_status: 'succeeded',
  extracted_count: 1,
  committed_count: 1,
  filtered_count: 0,
  extraction_retried: false,
  extraction_attempt_count: 1,
  created_at: Date.UTC(2026, 6, 31, 8, 0, 0),
};

function currentDetail() {
  return {
    revision: currentRevision,
    events: [
      {
        id: 1,
        op_type: 'GOAL_CHANGED',
        subject_name: 'Duy Khôi',
        summary: 'Duy Khôi quyết định truy tìm nguồn gốc Mảnh Ký Ức Vỡ.',
        status: 'committed',
      },
      {
        id: 2,
        op_type: 'OBJECT_ACQUIRED',
        subject_name: 'Duy Khôi',
        object_name: 'Mảnh Ký Ức Vỡ',
        summary: 'Duy Khôi giữ bản sao trong phân vùng bảo mật.',
        status: 'committed',
      },
    ],
    evidence: [
      { id: 11, evidence_text: 'Tôi cần biết nó là gì.', scene_id: 201 },
      { id: 12, evidence_text: 'Anh chạm vào phím lưu, sao chép tệp Mảnh Ký Ức Vỡ...', scene_id: 201 },
    ],
    reports: [{
      id: 21,
      severity: 'warning',
      rule_code: 'CANON_OP_MISSING_REFERENCE_FILTERED',
      message: 'Một operation không ánh xạ được vật phẩm nên đã bị loại.',
      evidence: 'Địa chỉ và tên Lâm Đồng',
    }],
  };
}

describe('phase10 chapter change history', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mocks.getHistory.mockResolvedValue({
      chapter: { id: 10, title: 'Lỗi Trên Dòng Ký Ức' },
      commit: { current_revision_id: 102, canonical_revision_id: 102 },
      revisions: [currentRevision, olderRevision],
    });
    mocks.getDetail.mockImplementation(async (_projectId, revisionId) => (
      revisionId === 102
        ? currentDetail()
        : {
          revision: olderRevision,
          events: [{ id: 3, op_type: 'THREAD_PROGRESS', summary: 'Tuyến điều tra bắt đầu.', status: 'superseded' }],
          evidence: [],
          reports: [],
        }
    ));
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  async function renderHistory(props = {}) {
    root = createRoot(container);
    await act(async () => {
      root.render(<ChapterChangeHistory projectId={1} chapterId={10} {...props} />);
    });
  }

  it('shows committed changes separately from evidence and filtered reports', async () => {
    await renderHistory();

    expect(mocks.getHistory).toHaveBeenCalledWith(1, 10);
    expect(mocks.getDetail).toHaveBeenCalledWith(1, 102);
    expect(container.textContent).toContain('2 thay đổi đã áp dụng');
    expect(container.textContent).toContain('3 trích xuất');
    expect(container.textContent).toContain('1 bị lọc');
    expect(container.textContent).toContain('2 lượt AI');
    expect(container.textContent).toContain('Đổi mục tiêu');
    expect(container.textContent).toContain('Nhận vật phẩm');
    expect(container.textContent).toContain('Tôi cần biết nó là gì.');
    expect(container.textContent).toContain('Bị lọc và cảnh báo');
    expect(container.textContent).toContain('Một operation không ánh xạ được vật phẩm nên đã bị loại.');
    expect(container.textContent).toContain('Đã tự sửa phản hồi AI');
    expect(container.querySelector('[aria-label="Chọn phiên bản thay đổi"]')).not.toBeNull();
  });

  it('loads an older revision without presenting superseded events as current canon', async () => {
    await renderHistory();
    const select = container.querySelector('[aria-label="Chọn phiên bản thay đổi"]');

    await act(async () => {
      select.value = '101';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(mocks.getDetail).toHaveBeenLastCalledWith(1, 101);
    expect(container.textContent).toContain('Tuyến điều tra bắt đầu.');
    expect(container.textContent).toContain('Phiên bản cũ');
    expect(container.textContent).not.toContain('2 thay đổi đã áp dụng');
  });

  it('explains a successful explicit zero-op completion', async () => {
    mocks.getHistory.mockResolvedValue({
      chapter: { id: 10, title: 'Một ngày bình thường' },
      commit: { current_revision_id: 103, canonical_revision_id: 103 },
      revisions: [{
        ...currentRevision,
        id: 103,
        event_count: 0,
        report_count: 0,
        evidence_count: 0,
        extracted_count: 0,
        committed_count: 0,
        filtered_count: 0,
        extraction_retried: false,
        extraction_attempt_count: 1,
      }],
    });
    mocks.getDetail.mockResolvedValue({
      revision: {
        ...currentRevision,
        id: 103,
        extracted_count: 0,
        committed_count: 0,
        filtered_count: 0,
        extraction_retried: false,
      },
      events: [],
      evidence: [],
      reports: [],
    });

    await renderHistory();

    expect(container.textContent).toContain('Đã phân tích và không có thay đổi canon mới.');
    expect(container.textContent).not.toContain('Bị lọc và cảnh báo');
  });

  it('does not describe an exhausted retry as a successful AI repair', async () => {
    const blockedRevision = {
      ...currentRevision,
      id: 104,
      status: 'blocked',
      is_current: true,
      is_canonical: false,
      event_count: 0,
      extraction_status: 'failed',
      committed_count: 0,
      extraction_retried: true,
    };
    mocks.getHistory.mockResolvedValue({
      chapter: { id: 10, title: 'Lần hoàn thành bị chặn' },
      commit: { current_revision_id: 104, canonical_revision_id: null },
      revisions: [blockedRevision],
    });
    mocks.getDetail.mockResolvedValue({
      revision: blockedRevision,
      events: [],
      evidence: [],
      reports: [{
        id: 22,
        severity: 'error',
        message: 'AI vẫn không trả về operation có thể kiểm chứng.',
      }],
    });

    await renderHistory();

    expect(container.textContent).toContain('Đã thử sửa phản hồi AI');
    expect(container.textContent).not.toContain('Đã tự sửa phản hồi AI');
    expect(container.textContent).toContain('Bị chặn');
  });

  it('shows an honest empty state before a chapter has completion history', async () => {
    mocks.getHistory.mockResolvedValue({
      chapter: { id: 10, title: 'Chương chưa hoàn thành' },
      commit: null,
      revisions: [],
    });

    await renderHistory();

    expect(container.textContent).toContain('Chương này chưa có lịch sử hoàn thành.');
    expect(mocks.getDetail).not.toHaveBeenCalled();
  });
});
