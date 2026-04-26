import { describe, expect, it } from 'vitest';
import { parseChaptersFromText } from '../../services/labLite/chapterParser.js';

describe('Lab Lite Phase 1 - noisy corpus parser cases', () => {
  it('splits chapters with roman numerals', () => {
    const parsed = parseChaptersFromText([
      'Chapter I: Gate',
      '',
      'The gate opens and the first rule is established for the world.',
      '',
      'Chapter II: Debt',
      '',
      'The debt changes the relationship between the two leads.',
    ].join('\n'));

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].title).toContain('Chapter I');
    expect(parsed.chapters[1].title).toContain('Chapter II');
  });

  it('splits chapters whose numbers are written in Vietnamese words', () => {
    const parsed = parseChaptersFromText([
      'Chuong bon muoi ba',
      '',
      'Noi dung chuong 43 du dai de parser chap nhan la mot chuong that.',
      '',
      'Chuong bon muoi bon',
      '',
      'Noi dung chuong 44 tiep tuc voi mot bien co quan trong hon.',
    ].join('\n'));

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].title).toContain('bon muoi ba');
    expect(parsed.chapters[1].title).toContain('bon muoi bon');
  });

  it('does not split ordinary numbered sentences as chapter headings', () => {
    const parsed = parseChaptersFromText([
      'Chapter 1: Real Start',
      '',
      'The hero counts 1. first door, 2. second door, and 3. final door inside one paragraph.',
      'This should stay in the same chapter because it is prose, not a boundary.',
      '',
      'Chapter 2: Real Next',
      '',
      'The second real chapter begins here with enough words to be kept.',
    ].join('\n'));

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].content).toContain('1. first door');
  });

  it('keeps title-like dialogue inside chapter body when it is not isolated heading structure', () => {
    const parsed = parseChaptersFromText([
      'Chapter 1: Voice',
      '',
      '"Chapter two is a lie," she said before closing the book.',
      'The line is dialogue and must remain in chapter one.',
      '',
      'Chapter 2: Truth',
      '',
      'The actual second chapter starts after a clear boundary.',
    ].join('\n'));

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].content).toContain('"Chapter two is a lie,"');
  });

  it('preserves front matter separate from the first real chapter', () => {
    const parsed = parseChaptersFromText([
      'Nguon: private archive',
      'Tac gia: Demo Author',
      'Convert: StoryForge',
      '',
      'Chuong 1: Vao truyen',
      '',
      'Noi dung dau tien that su bat dau o day.',
    ].join('\n'));

    expect(parsed.frontMatter?.content).toContain('Demo Author');
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0].content).not.toContain('private archive');
  });

  it('normalizes fullwidth punctuation before detecting headings', () => {
    const parsed = parseChaptersFromText([
      'Chapter 1\uff1aFullwidth',
      '',
      'A chapter title using fullwidth colon still parses correctly.',
      '',
      'Chapter 2\uff1aNext',
      '',
      'A second chapter follows.',
    ].join('\n'));

    expect(parsed.chapters).toHaveLength(2);
  });

  it('splits sequential bare numbered novel headings before later explicit chapter headings', () => {
    const makeBody = (index) => [
      `Nội dung chương ${index} có Linh và Minh đi qua thành phố để tìm manh mối mới.`,
      'Đoạn này đủ dài để chứng minh đây là thân chương thật, không phải mục lục hay dòng trang trí.',
      'Nhân vật ghi lại bằng chứng, thay đổi mục tiêu và để lại một móc truyện rõ ràng.',
    ].join(' ');
    const text = Array.from({ length: 105 }, (_item, arrayIndex) => {
      const chapterIndex = arrayIndex + 1;
      const heading = chapterIndex < 100
        ? `${chapterIndex} Phần lớn đều là nam nhân, chỉ có số ít vài cái nữ nhân!`
        : `Chương ${chapterIndex}: Thiên lương là loại bệnh, được trị!`;
      return `${heading}\n\n${makeBody(chapterIndex)}`;
    }).join('\n\n');

    const parsed = parseChaptersFromText(text);

    expect(parsed.chapters).toHaveLength(105);
    expect(parsed.chapters[0].title).toContain('Phần lớn đều là nam nhân');
    expect(parsed.chapters[0].wordCount).toBeLessThan(90);
    expect(parsed.chapters[98].title).toContain('99');
    expect(parsed.chapters[99].title).toContain('Chương 100');
    expect(parsed.chapters[104].title).toContain('Chương 105');
  });
});
