import { describe, expect, it } from 'vitest';
import {
  analyzeCharacterHint,
  buildCharacterBatchPlan,
  clampBatchCount,
} from '../../utils/batchCharacterHint.js';

describe('batch character hint helpers', () => {
  it('clamps manual counts from 1 to 20', () => {
    expect(clampBatchCount(0)).toBe(1);
    expect(clampBatchCount('')).toBe(1);
    expect(clampBatchCount(12)).toBe(12);
    expect(clampBatchCount(99)).toBe(20);
  });

  it('detects explicit character lists and removes existing names by name or alias', () => {
    const analysis = analyzeCharacterHint(
      'Nhan vat: Nguyen Linh Dao, Tran Kha Minh, Hac Vu, Tieu Anh',
      [
        { id: 1, name: 'Nguyen Linh Dao', aliases: ['Dao'] },
        { id: 2, name: 'Doan Anh', aliases: ['Tieu Anh'] },
      ],
    );

    expect(analysis.clearList).toBe(true);
    expect(analysis.detectedCharacters.map((item) => item.name)).toEqual([
      'Nguyen Linh Dao',
      'Tran Kha Minh',
      'Hac Vu',
      'Tieu Anh',
    ]);
    expect(analysis.existingCharacters).toHaveLength(2);
    expect(analysis.missingCharacters.map((item) => item.name)).toEqual([
      'Tran Kha Minh',
      'Hac Vu',
    ]);
  });

  it('uses the missing character count when manual count is too high', () => {
    const plan = buildCharacterBatchPlan({
      selectedCount: 10,
      hint: 'Nhan vat: Nguyen Linh Dao, Tran Kha Minh, Hac Vu',
      existingCharacters: [{ id: 1, name: 'Nguyen Linh Dao', aliases: [] }],
    });

    expect(plan.hasClearMissingList).toBe(true);
    expect(plan.count).toBe(10);
    expect(plan.effectiveCount).toBe(2);
    expect(plan.suggestedCount).toBe(2);
    expect(plan.warning).toBe('');
  });

  it('warns when manual count is lower than the missing character count', () => {
    const plan = buildCharacterBatchPlan({
      selectedCount: 1,
      hint: 'Nhan vat: Nguyen Linh Dao, Tran Kha Minh, Hac Vu',
      existingCharacters: [{ id: 1, name: 'Nguyen Linh Dao', aliases: [] }],
    });

    expect(plan.effectiveCount).toBe(1);
    expect(plan.warning).toBe('Phát hiện 3 nhân vật trong dàn ý, đã có 1, còn thiếu 2. Bạn đang chọn 1.');
  });

  it('does not inflate character count from headings, locations, or prose in a full outline', () => {
    const outline = `
**DÀN Ý TỔNG QUÁT DỰ ÁN TRUYỆN "HẸ HẸ"**

**Bối cảnh:** Thế giới Fantasy hậu tận thế, nơi các đại lục bị chia cắt bởi những "Vực thẳm hư vô".

### **I. HỆ THỐNG 5 NHÂN VẬT CHÍNH**

1.  **Kael (Kẻ dẫn đường):** Một cựu hiệp sĩ mang lời nguyền bất tử.
2.  **Lyra (Pháp sư ký ức):** Cô gái có khả năng đọc và điều khiển ký ức.
3.  **Borg (Chiến binh cơ khí):** Một người lùn mất đi thân thể.
4.  **Zeryn (Sát thủ bóng đêm):** Thuộc tộc yêu tinh sa ngã.
5.  **Evelyn (Thánh nữ giả mạo):** Một kẻ lừa đảo có kỹ năng ngoại giao.

### **II. DÀN Ý CỐT TRUYỆN**

* 5 nhân vật tình cờ gặp nhau tại "Thành phố rác thải".
* Mỗi nhân vật tìm thấy một mục đích mới: Zeryn hoàn lương, Kael ra đi thanh thản, Lyra tiếp tục hành trình.
`;

    const analysis = analyzeCharacterHint(outline, []);

    expect(analysis.clearList).toBe(true);
    expect(analysis.detectedCharacters.map((item) => item.name)).toEqual([
      'Kael',
      'Lyra',
      'Borg',
      'Zeryn',
      'Evelyn',
    ]);
    expect(analysis.missingCharacters).toHaveLength(5);
  });

  it('detects Vietnamese, translated Chinese, and English names without relying on capitalization', () => {
    const analysis = analyzeCharacterHint(
      `
### Hệ thống nhân vật chính
1. trần văn đạt (người dẫn chuyện): Sinh viên tỉnh lẻ.
2. Lý Mạc Sầu - phản diện: Cao thủ giang hồ.
3. ngụy vô tiện: Người tu quỷ đạo.
4. John Smith (investigator): English name.
`,
      [{ id: 1, name: 'Ngụy Vô Tiện', aliases: ['A Tiện'] }],
    );

    expect(analysis.clearList).toBe(true);
    expect(analysis.detectedCharacters.map((item) => item.name)).toEqual([
      'trần văn đạt',
      'Lý Mạc Sầu',
      'ngụy vô tiện',
      'John Smith',
    ]);
    expect(analysis.existingCharacters.map((item) => item.matchedName)).toEqual(['Ngụy Vô Tiện']);
    expect(analysis.missingCharacters.map((item) => item.name)).toEqual([
      'trần văn đạt',
      'Lý Mạc Sầu',
      'John Smith',
    ]);
  });

  it('parses explicit count/list labels but ignores prose about every character', () => {
    const analysis = analyzeCharacterHint(
      `
5 nhân vật chính gồm: trần văn đạt, Lý Mạc Sầu, John Smith
Mỗi nhân vật tìm thấy một mục đích mới: trần văn đạt trưởng thành, John Smith rời thành phố.
`,
      [],
    );

    expect(analysis.clearList).toBe(true);
    expect(analysis.detectedCharacters.map((item) => item.name)).toEqual([
      'trần văn đạt',
      'Lý Mạc Sầu',
      'John Smith',
    ]);
  });
});
