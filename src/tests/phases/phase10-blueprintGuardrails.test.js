import { describe, expect, it } from 'vitest';
import {
  buildChapterOutlinePassValidation,
  buildStoryBibleSeedValidation,
  normalizeWizardBlueprintResult,
  normalizeStoryBibleSeedResult,
  normalizeChapterOutlinePassResult,
  resolveWizardProjectTitle,
  buildWizardValidation,
  buildChapterBlueprintContext,
  validateChapterWritingReadiness,
  normalizeChapterListField,
} from '../../services/ai/blueprintGuardrails';

describe('phase10 blueprint guardrails', () => {
  it('normalizes and preserves chapter blueprint fields from wizard output', () => {
    const normalized = normalizeWizardBlueprintResult({
      title: '  Huyen Mon  ',
      chapters: [{
        title: ' Chuong 1 ',
        purpose: ' Gioi thieu nhan vat ',
        summary: ' Main den tong mon. ',
        opening_state: ' Main o ngoai tong mon. ',
        ending_state: ' Main da gap Kha. ',
        featured_characters: 'Lan, Kha\nLan',
        primary_location: ' Thanh Co ',
        thread_titles: ['Bi mat hoang toc', 'Bi mat hoang toc'],
        key_events: 'Lan gap Kha',
        required_factions: ['Thanh Van Tong', 'Thanh Van Tong'],
        required_objects: 'Ngoc boi',
      }],
      characters: [{
        name: ' Lan ',
        role: ' protagonist ',
        specific_role: ' nguoi giu ban do co ',
        specific_role_locked: true,
        age: ' thieu nien ',
        current_status: ' Dang bi truy na ',
        story_function: 'neo mo dau',
      }],
      locations: [{ name: ' Thanh Co ', story_function: 'san khau mo dau' }],
      terms: [{ name: ' Linh can ', story_function: 'giai thich he thong' }],
      plot_threads: [{ title: ' Bi mat hoang toc ', opening_window: 'chuong 1-2', anchor_chapters: 'Chuong 1' }],
    });

    expect(normalized.title).toBe('Huyen Mon');
    expect(normalized.chapters[0]).toMatchObject({
      title: 'Chuong 1',
      purpose: 'Gioi thieu nhan vat',
      primary_location: 'Thanh Co',
      opening_state: 'Main o ngoai tong mon.',
      ending_state: 'Main da gap Kha.',
      key_events: ['Lan gap Kha'],
      required_factions: ['Thanh Van Tong'],
      required_objects: ['Ngoc boi'],
    });
    expect(normalized.chapters[0].featured_characters).toEqual(['Lan', 'Kha']);
    expect(normalized.chapters[0].thread_titles).toEqual(['Bi mat hoang toc']);
    expect(normalized.characters[0].story_function).toBe('neo mo dau');
    expect(normalized.characters[0].age).toBe('thieu nien');
    expect(normalized.characters[0].specific_role).toBe('nguoi giu ban do co');
    expect(normalized.characters[0].specific_role_locked).toBe(true);
    expect(normalized.characters[0].current_status).toBe('Dang bi truy na');
    expect(normalized.locations[0].story_function).toBe('san khau mo dau');
    expect(normalized.terms[0].story_function).toBe('giai thich he thong');
    expect(normalized.plot_threads[0].anchor_chapters).toEqual(['Chuong 1']);
  });

  it('does not keep a wizard role lock when the specific role is blank', () => {
    const normalized = normalizeWizardBlueprintResult({
      characters: [{
        name: 'Lan',
        role: 'supporting',
        specific_role: '   ',
        specific_role_locked: true,
      }],
    });

    expect(normalized.characters[0].specific_role).toBe('');
    expect(normalized.characters[0].specific_role_locked).toBe(false);
  });

  it('normalizes Story Bible Seed without keeping chapter output', () => {
    const normalized = normalizeStoryBibleSeedResult({
      title: 'Huyen Mon',
      characters: [{ name: 'Lan', role: 'protagonist' }],
      chapters: [{ title: 'Chuong 1' }],
    });

    expect(normalized.title).toBe('Huyen Mon');
    expect(normalized.characters[0].name).toBe('Lan');
    expect(normalized.chapters).toEqual([]);
  });

  it('blocks one-chapter seeds with too many important characters', () => {
    const validation = buildStoryBibleSeedValidation({
      characters: [
        { name: 'Lan', role: 'protagonist' },
        { name: 'Kha', role: 'supporting', story_function: 'xuat hien o chuong 1' },
        { name: 'Minh', role: 'supporting', story_function: 'xuat hien o chuong 1' },
        { name: 'Vy', role: 'supporting', story_function: 'xuat hien o chuong 1' },
      ],
    }, { initialChapterCount: 1 });

    expect(validation.blockingIssues.map((item) => item.code)).toContain('seed-character-cap-exceeded');
  });

  it('blocks seeds without a protagonist', () => {
    const validation = buildStoryBibleSeedValidation({
      characters: [{ name: 'Kha', role: 'supporting', story_function: 'xuat hien o chuong 1' }],
    }, { initialChapterCount: 2 });

    expect(validation.blockingIssues.map((item) => item.code)).toContain('seed-missing-protagonist');
  });

  it('blocks supporting characters reserved for later instead of early story use', () => {
    const validation = buildStoryBibleSeedValidation({
      characters: [
        { name: 'Lan', role: 'protagonist' },
        { name: 'Kha', role: 'supporting', story_function: 'de danh ve sau' },
      ],
    }, { initialChapterCount: 2 });

    expect(validation.blockingIssues.map((item) => item.code)).toContain('seed-deferred-character');
  });

  it('does not turn prompt-like ideas into story titles', () => {
    const normalized = normalizeWizardBlueprintResult({
      title: '',
      title_options: [],
      premise: 'Mac Van bi cuon vao con duong tranh doat tai mot tong mon suy tan.',
      chapters: [],
    }, 'tao truyen tu tien bat ky');

    expect(normalized.title).toBe('');
    expect(normalized.title_options).toEqual([]);
    expect(resolveWizardProjectTitle(normalized, 'tao truyen tu tien bat ky'))
      .toBe('Mac Van bi cuon vao con duong tranh doat tai mot tong mon suy tan');
  });

  it('hydrates minimal wizard outlines so review page does not hard-block on missing schema fields', () => {
    const normalized = normalizeWizardBlueprintResult({
      title: 'Tan Thu Vo Cuc',
      characters: [
        { name: 'Mac Van', role: 'protagonist' },
        { name: 'Lam Thanh Ha', role: 'supporting' },
      ],
      locations: [
        { name: 'Thanh Van Phong', story_function: 'mo dau o chuong 1' },
        { name: 'Vo Cuc Son Mach', story_function: 'xuat hien o chuong 2' },
      ],
      factions: [
        { name: 'Thanh Van Tong', story_function: 'xuat hien som trong mo dau' },
      ],
      terms: [
        { name: 'Tan Thu Co', story_function: 'neo som o chuong 1' },
      ],
      plot_threads: [
        { title: 'Con Duong Phuc Hung Tong Mon', type: 'main', opening_window: 'Chuong 1' },
        { title: 'Bi Mat Tan Thu Co', type: 'mystery', opening_window: 'Chuong 2' },
      ],
      chapters: [
        {
          title: 'Chuong 1: De tu ngoai mon',
          summary: 'Mac Van tinh co nhat duoc Tan Thu Co tai Thanh Van Phong.',
          opening_state: 'Mac Van con o Thanh Van Phong va chua biet Tan Thu Co.',
          ending_state: 'Mac Van co Tan Thu Co trong tay.',
        },
        {
          title: 'Chuong 2: Roi mon tim co duyen',
          opening_state: 'Mac Van roi Thanh Van Phong voi Tan Thu Co.',
          summary: 'Mac Van roi tong mon, tien vao Vo Cuc Son Mach de truy tim co duyên.',
          handoff_from_previous: 'Sau khi nhat duoc Tan Thu Co, Mac Van roi tong mon de lan theo dau vet moi.',
          ending_state: 'Mac Van vao Vo Cuc Son Mach va thay dau vet moi.',
          primary_location: 'Vo Cuc Son Mach',
        },
      ],
    });

    expect(normalized.chapters[0].purpose).toBeTruthy();
    expect(normalized.chapters[0].featured_characters).toContain('Mac Van');
    expect(normalized.chapters[0].primary_location).toBe('Thanh Van Phong');
    expect(normalized.chapters[0].thread_titles).toContain('Con Duong Phuc Hung Tong Mon');
    expect(normalized.chapters[0].key_events.length).toBeGreaterThan(0);
    expect(normalized.chapters[0].required_factions).toContain('Thanh Van Tong');
    expect(normalized.chapters[1].primary_location).toBe('Vo Cuc Son Mach');
    expect(normalized.chapters[1].thread_titles).toContain('Bi Mat Tan Thu Co');

    const validation = buildWizardValidation(normalized);
    expect(validation.blockingIssues).toHaveLength(0);
  });

  it('blocks missing anchors and only blocks unused early-critical factions/terms', () => {
    const validation = buildWizardValidation({
      characters: [{ name: 'Lan', role: 'protagonist' }],
      locations: [{ name: 'Thanh Co' }],
      factions: [{ name: 'Thanh Van Tong', story_function: 'xuat hien som trong mo dau' }],
      terms: [
        { name: 'Linh can', story_function: 'giai thich o chuong 1' },
        { name: 'Thien Dao', story_function: 'world lore nen, de danh ve sau' },
      ],
      plot_threads: [{ title: 'Bi mat hoang toc', anchor_chapters: [] }],
      chapters: [{
        title: 'Chuong 1',
        summary: 'Mo dau o mot noi xa la.',
        purpose: '',
        featured_characters: [],
        primary_location: '',
        thread_titles: [],
        key_events: [],
      }],
    });

    expect(validation.blockingIssues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'chapter-missing-purpose',
      'chapter-missing-featured-characters',
      'chapter-missing-primary-location',
      'chapter-missing-thread-anchor',
      'protagonist-unused',
      'thread-without-anchor',
      'location-unused',
      'faction-unused',
      'term-unused',
    ]));
    expect(validation.warnings.map((item) => item.code)).toContain('term-unused');
  });

  it('treats required_terms and required_factions as valid early anchors', () => {
    const validation = buildWizardValidation({
      characters: [{ name: 'Lan', role: 'protagonist' }],
      locations: [{ name: 'Thanh Co' }],
      factions: [{ name: 'Thanh Van Tong', story_function: 'xuat hien som trong mo dau' }],
      terms: [{ name: 'Linh can', story_function: 'giai thich o chuong 1' }],
      plot_threads: [{ title: 'Bi mat hoang toc', anchor_chapters: ['Chuong 1'] }],
      chapters: [{
        title: 'Chuong 1',
        summary: 'Lan den Thanh Co.',
        purpose: 'Dat neo mo dau.',
        featured_characters: ['Lan'],
        primary_location: 'Thanh Co',
        thread_titles: ['Bi mat hoang toc'],
        key_events: ['Lan nhap mon'],
        opening_state: 'Lan vua den Thanh Co.',
        ending_state: 'Lan da nhap mon va biet Linh can.',
        required_factions: ['Thanh Van Tong'],
        required_terms: ['Linh can'],
      }],
    });

    expect(validation.blockingIssues.map((item) => item.code)).not.toContain('faction-unused');
    expect(validation.blockingIssues.map((item) => item.code)).not.toContain('term-unused');
  });

  it('blocks multi-chapter wizard outlines that skip the causal handoff', () => {
    const validation = buildWizardValidation({
      characters: [{ name: 'Lan', role: 'protagonist' }],
      locations: [{ name: 'Thanh Co' }],
      factions: [],
      terms: [],
      plot_threads: [{ title: 'Truy dau vet', anchor_chapters: ['Chuong 1'] }],
      chapters: [
        {
          title: 'Chuong 1',
          summary: 'Lan bi thuong o Thanh Co.',
          purpose: 'Dat nguy co mo dau.',
          featured_characters: ['Lan'],
          primary_location: 'Thanh Co',
          thread_titles: ['Truy dau vet'],
          key_events: ['Lan bi thuong'],
          opening_state: 'Lan bat dau dieu tra tai Thanh Co.',
          ending_state: 'Lan bi thuong va bi chan trong Thanh Co.',
        },
        {
          title: 'Chuong 2',
          summary: 'Lan xuat hien tai kinh thanh va bat dau dieu tra.',
          purpose: 'Mo huong dieu tra moi.',
          featured_characters: ['Lan'],
          primary_location: 'Thanh Co',
          thread_titles: ['Truy dau vet'],
          key_events: ['Lan dieu tra'],
          opening_state: 'Lan van bi chan trong Thanh Co.',
          ending_state: 'Lan tim duoc dau moi.',
        },
      ],
    });

    expect(validation.blockingIssues.map((item) => item.code)).toContain('chapter-missing-handoff');
  });

  it('downgrades unused entity blockers after a chapter is excluded', () => {
    const validation = buildWizardValidation({
      characters: [
        { name: 'Lan', role: 'protagonist' },
        { name: 'Kha', role: 'supporting' },
      ],
      locations: [{ name: 'Thanh Co' }, { name: 'Rung Sau' }],
      factions: [],
      terms: [],
      plot_threads: [
        { title: 'Bi mat dau truyen', anchor_chapters: [] },
        { title: 'Truy tim dau vet', anchor_chapters: ['Chuong 2'] },
      ],
      chapters: [
        {
          title: 'Chuong 1',
          summary: 'Lan xuat hien tai Thanh Co va cham vao bi mat dau tien.',
          purpose: 'Gioi thieu Lan va bi mat dau truyen.',
          featured_characters: ['Lan'],
          primary_location: 'Thanh Co',
          thread_titles: ['Bi mat dau truyen'],
          key_events: ['Lan tim thay dau vet'],
          opening_state: 'Lan moi den Thanh Co.',
          ending_state: 'Lan thay dau vet dau tien.',
        },
        {
          title: 'Chuong 2',
          summary: 'Kha vao Rung Sau de truy tim dau vet moi.',
          purpose: 'Mo tiep huong truy tim dau vet.',
          featured_characters: ['Kha'],
          primary_location: 'Rung Sau',
          thread_titles: ['Truy tim dau vet'],
          key_events: ['Kha tim thay dau vet moi'],
          opening_state: 'Kha roi Thanh Co sau dau vet dau tien.',
          handoff_from_previous: 'Sau khi dau vet dau tien lo ra, Kha lan theo ve phia Rung Sau.',
          ending_state: 'Kha tim thay dau vet moi trong Rung Sau.',
        },
      ],
    }, new Set(['chapter-0']));

    expect(validation.blockingIssues).toHaveLength(0);
    expect(validation.warnings.map((item) => item.code)).toContain('thread-without-anchor');
  });

  it('keeps dense or high-entity blueprints as warnings instead of blockers', () => {
    const chapters = [
      {
        title: 'Chuong 1',
        purpose: 'Mo 3 lop xung dot, dung 4 nhan vat, va dat 3 tuyen vao cung mot chuong dau.',
        summary: 'A'.repeat(560),
        featured_characters: ['Lan', 'Kha', 'Minh', 'Vy'],
        primary_location: 'Thanh Co',
        thread_titles: ['Thread A', 'Thread B', 'Thread C'],
        key_events: ['Beat 1', 'Beat 2', 'Beat 3'],
        opening_state: 'Lan o Thanh Co truoc bien co.',
        ending_state: 'Thanh Co bung no ba lop xung dot.',
      },
      {
        title: 'Chuong 2',
        purpose: 'Giu nhip tiep noi.',
        summary: 'Mo rong anh huong cua chapter dau.',
        opening_state: 'Lan tiep tuc xu ly he qua tu Thanh Co.',
        handoff_from_previous: 'Sau cac bien co day dac o chapter dau, Lan tiep tuc xu ly he qua gan nhat.',
        ending_state: 'Lan giu duoc mot dau moi moi.',
        featured_characters: ['Lan'],
        primary_location: 'Tong mon',
        thread_titles: ['Thread A'],
        key_events: ['Beat 4'],
      },
    ];
    const validation = buildWizardValidation({
      characters: [
        { name: 'Lan', role: 'protagonist' },
        { name: 'Kha', role: 'supporting' },
        { name: 'Minh', role: 'supporting' },
        { name: 'Vy', role: 'supporting' },
      ],
      locations: [{ name: 'Thanh Co' }, { name: 'Tong mon' }],
      factions: [],
      terms: [],
      plot_threads: [
        { title: 'Thread A', anchor_chapters: ['Chuong 1'] },
        { title: 'Thread B', anchor_chapters: ['Chuong 1'] },
        { title: 'Thread C', anchor_chapters: ['Chuong 1'] },
      ],
      chapters,
    });

    expect(validation.blockingIssues).toHaveLength(0);
    expect(validation.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'chapter-too-dense',
      'entity-density-high',
      'pacing-too-fast',
    ]));
  });

  it('normalizes Chapter Outline Pass with proposed entities', () => {
    const seed = normalizeStoryBibleSeedResult({
      title: 'Huyen Mon',
      characters: [{ name: 'Lan', role: 'protagonist' }],
      locations: [{ name: 'Thanh Co' }],
      plot_threads: [{ title: 'Bi mat dau tien', type: 'main' }],
    });
    const outline = normalizeChapterOutlinePassResult({
      chapters: [{
        title: 'Chuong 1',
        purpose: 'Dat neo mo dau.',
        summary: 'Lan gap Kha tai Thanh Co.',
        opening_state: 'Lan o Thanh Co.',
        ending_state: 'Lan gap Kha.',
        featured_characters: ['Lan', 'Kha'],
        primary_location: 'Thanh Co',
        thread_titles: ['Bi mat dau tien'],
        key_events: ['Lan gap Kha'],
      }],
      proposed_entities: {
        characters: [{ name: 'Kha', role: 'supporting', story_function: 'xuat hien o chuong 1' }],
      },
    }, seed);

    expect(outline.chapters[0].featured_characters).toEqual(['Lan', 'Kha']);
    expect(outline.proposed_entities.characters[0].name).toBe('Kha');
  });

  it('blocks outline chapters missing opening and ending state', () => {
    const seed = normalizeStoryBibleSeedResult({
      characters: [{ name: 'Lan', role: 'protagonist' }],
      locations: [{ name: 'Thanh Co' }],
      plot_threads: [{ title: 'Bi mat dau tien', type: 'main' }],
    });
    const validation = buildChapterOutlinePassValidation({
      chapters: [{
        title: 'Chuong 1',
        featured_characters: ['Lan'],
        primary_location: 'Thanh Co',
        thread_titles: ['Bi mat dau tien'],
      }],
    }, seed);

    expect(validation.blockingIssues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'chapter-missing-opening-state',
      'chapter-missing-ending-state',
    ]));
  });

  it('blocks unknown outline references unless they are proposed and approved', () => {
    const seed = normalizeStoryBibleSeedResult({
      characters: [{ name: 'Lan', role: 'protagonist' }],
      locations: [{ name: 'Thanh Co' }],
      plot_threads: [{ title: 'Bi mat dau tien', type: 'main' }],
    });
    const outline = {
      chapters: [{
        title: 'Chuong 1',
        opening_state: 'Lan o Thanh Co.',
        ending_state: 'Lan gap Kha.',
        featured_characters: ['Lan', 'Kha'],
        primary_location: 'Thanh Co',
        thread_titles: ['Bi mat dau tien'],
      }],
      proposed_entities: {
        characters: [{ name: 'Kha', role: 'supporting', story_function: 'xuat hien o chuong 1' }],
      },
    };

    const pending = buildChapterOutlinePassValidation(outline, seed);
    expect(pending.blockingIssues.map((item) => item.code)).toContain('outline-proposal-pending');

    const approved = buildChapterOutlinePassValidation(outline, seed, {
      acceptedProposals: new Set(['proposal-characters-0']),
    });
    expect(approved.blockingIssues.map((item) => item.code)).not.toContain('outline-proposal-pending');

    const unknown = buildChapterOutlinePassValidation({
      ...outline,
      proposed_entities: {},
    }, seed);
    expect(unknown.blockingIssues.map((item) => item.code)).toContain('outline-unknown-characters');
  });

  it('auto-proposes outline references missing from the approved seed', () => {
    const seed = normalizeStoryBibleSeedResult({
      characters: [{ name: 'Trần Diệp', role: 'protagonist' }],
      locations: [{ name: 'Hồi Âm Cốc', story_function: 'mở đầu chương 1' }],
      objects: [{ name: 'Thanh Khuyết Tàn Kiếm', story_function: 'bảo vật mở đầu' }],
      terms: [{ name: 'Thần Thức', story_function: 'gợi ý tu luyện sớm' }],
      plot_threads: [{ title: 'Bí Ẩn Thanh Khuyết', type: 'mystery' }],
    });

    const outline = normalizeChapterOutlinePassResult({
      chapters: [{
        title: 'Chương 5: Đột Phá Luyện Khí Tầng 2',
        purpose: 'Cho nhân vật chính tăng tiến tu vi.',
        summary: 'Trần Diệp dùng Linh Thạch trong Thanh Vân Tông để đột phá Luyện Khí tầng 2.',
        opening_state: 'Trần Diệp đang chuẩn bị đột phá.',
        ending_state: 'Trần Diệp đạt Luyện Khí tầng 2.',
        featured_characters: ['Trần Diệp'],
        primary_location: 'Thanh Vân Tông',
        thread_titles: ['Bí Ẩn Thanh Khuyết'],
        key_events: ['Đột phá Luyện Khí tầng 2'],
        required_objects: ['Linh Thạch'],
        required_terms: ['Luyện Khí'],
      }],
    }, seed);

    expect(outline.proposed_entities.locations.map((item) => item.name)).toContain('Thanh Vân Tông');
    expect(outline.proposed_entities.objects.map((item) => item.name)).toContain('Linh Thạch');
    expect(outline.proposed_entities.terms.map((item) => item.name)).toContain('Luyện Khí');

    const pending = buildChapterOutlinePassValidation(outline, seed);
    expect(pending.blockingIssues.map((item) => item.code)).not.toContain('outline-unknown-locations');
    expect(pending.blockingIssues.map((item) => item.code)).not.toContain('outline-unknown-objects');
    expect(pending.blockingIssues.map((item) => item.code)).not.toContain('outline-unknown-terms');
    expect(pending.blockingIssues.map((item) => item.code)).toContain('outline-proposal-pending');

    const approved = buildChapterOutlinePassValidation(outline, seed, {
      acceptedProposals: new Set([
        'proposal-locations-0',
        'proposal-objects-0',
        'proposal-terms-0',
      ]),
    });
    expect(approved.blockingIssues).toHaveLength(0);
  });

  it('auto-proposes Linh Khí when an outline term is missing from the approved seed', () => {
    const seed = normalizeStoryBibleSeedResult({
      title: 'Huyền Môn',
      characters: [{ name: 'Trần Diệp', role: 'protagonist' }],
      locations: [{ name: 'Hồi Âm Cốc', story_function: 'mở đầu chương 1' }],
      plot_threads: [{ title: 'Bí Ẩn Thanh Khuyết', type: 'mystery' }],
    });

    const outline = normalizeChapterOutlinePassResult({
      chapters: [{
        title: 'Chương 2: Tinh Lọc Linh Khí',
        purpose: 'Cho nhân vật chính hiểu cơ chế tu luyện đầu tiên.',
        summary: 'Trần Diệp phát hiện tàn kiếm có thể tinh lọc Linh Khí quanh Hồi Âm Cốc.',
        opening_state: 'Trần Diệp đang thử cảm nhận năng lượng quanh tàn kiếm.',
        ending_state: 'Trần Diệp biết Linh Khí bị tàn kiếm tinh lọc trước khi hấp thụ.',
        featured_characters: ['Trần Diệp'],
        primary_location: 'Hồi Âm Cốc',
        thread_titles: ['Bí Ẩn Thanh Khuyết'],
        key_events: ['Tàn kiếm tinh lọc Linh Khí'],
        required_terms: ['Linh Khí'],
      }],
    }, seed);

    expect(outline.proposed_entities.terms.map((item) => item.name)).toContain('Linh Khí');

    const pending = buildChapterOutlinePassValidation(outline, seed);
    expect(pending.blockingIssues.map((item) => item.code)).not.toContain('outline-unknown-terms');
    expect(pending.blockingIssues.map((item) => item.code)).toContain('outline-proposal-pending');
  });

  it('builds chapter blueprint context and pre-write validation for empty scenes', () => {
    const chapterBlueprintContext = buildChapterBlueprintContext({
      chapter: {
        title: 'Chuong 1',
        purpose: 'Dat neo mo dau',
        summary: 'Lan den Thanh Co.',
        featured_characters: normalizeChapterListField('Lan, Kha'),
        primary_location: 'Thanh Co',
        thread_titles: ['Bi mat hoang toc'],
        key_events: ['Lan gap Kha'],
        required_factions: ['Thanh Van Tong'],
        required_objects: ['Ngoc boi'],
      },
      allCharacters: [{ name: 'Lan' }, { name: 'Kha' }],
      allLocations: [{ name: 'Thanh Co' }],
      allObjects: [{ name: 'Ngoc boi' }],
      allFactions: [{ name: 'Thanh Van Tong' }],
      allTerms: [{ name: 'Linh can' }],
      plotThreads: [{ title: 'Bi mat hoang toc' }],
    });
    const validation = validateChapterWritingReadiness({
      chapterBlueprintContext,
      sceneContract: {},
      sceneText: '',
    });

    expect(chapterBlueprintContext.required_factions).toEqual(['Thanh Van Tong']);
    expect(chapterBlueprintContext.required_objects).toEqual(['Ngoc boi']);
    expect(chapterBlueprintContext.relatedFactions.map((item) => item.name)).toEqual(['Thanh Van Tong']);
    expect(validation.blockingIssues).toHaveLength(0);
    expect(validation.warnings.some((item) => item.code === 'empty-scene-bootstrap-weak')).toBe(true);
  });
});
