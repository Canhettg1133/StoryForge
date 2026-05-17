import { describe, expect, it } from 'vitest';
import { validateGeneratedOutline } from '../../stores/arcGenerationStore';

describe('phase10 arc outline handoff stopwords', () => {
  it('validates handoff keyword coverage without relying on an undeclared global', () => {
    const outline = {
      chapters: [
        {
          title: 'Chuong 53: Loi the bat luc',
          purpose: 'Day Lam Mac vao trang thai bi rang buoc voi Diep Ninh.',
          summary: 'Lam Mac chap nhan giu bi mat va tro thanh dong pham bat dac di.',
          key_events: ['Lam Mac chap nhan giu bi mat', 'Diep Ninh nam quyen kiem soat'],
          ending_state: 'Lam Mac bi rang buoc tam ly voi Diep Ninh va tro thanh dong pham bat dac di.',
          state_delta: 'Lam Mac mat duong lui va bi keo sau hon vao bi mat cua lang.',
        },
        {
          title: 'Chuong 54: Am anh sau loi the',
          purpose: 'Cho Lam Mac vat lon voi hau qua cua loi the va su le thuoc.',
          summary: 'Lam Mac roi khoi Diep Ninh trong mac cam toi loi va bat dau so hai dan lang.',
          key_events: ['Lam Mac bi am anh', 'Dan lang nhin anh day nghi ngo'],
          handoff_from_previous: 'Sau khi bi rang buoc voi Diep Ninh va chap nhan lam dong pham bat dac di, Lam Mac roi di trong mac cam.',
        },
      ],
    };

    expect(() => validateGeneratedOutline(outline)).not.toThrow();

    const validation = validateGeneratedOutline(outline);
    expect(validation.issues.some((issue) => issue.code === 'chapter-handoff-weak')).toBe(false);
  });
});
