import { describe, expect, it } from 'vitest';
import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';

describe('user-facing error messages', () => {
  it('translates common technical English errors before they reach UI', () => {
    expect(toVietnameseErrorMessage(new Error('Request failed: 500'))).toBe('Yêu cầu thất bại với mã 500.');
    expect(toVietnameseErrorMessage(new Error('Malformed JSON response'))).toBe('Phản hồi JSON không đúng định dạng.');
    expect(toVietnameseErrorMessage(new Error('Failed to fetch'))).toBe('Không thể kết nối mạng hoặc dịch vụ đang không phản hồi.');
  });

  it('keeps existing accented Vietnamese messages and hides unknown English fallback detail', () => {
    expect(toVietnameseErrorMessage(new Error('Không thể xử lý canon.'))).toBe('Không thể xử lý canon.');
    expect(toVietnameseErrorMessage(new Error('Some opaque provider error'), 'Không chạy được tác vụ.')).toBe('Không chạy được tác vụ.');
  });
});
