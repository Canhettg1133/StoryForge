import { describe, expect, it } from 'vitest';
import {
  normalizeWizardBlueprintResult,
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
        },
        {
          title: 'Chuong 2: Roi mon tim co duyen',
          summary: 'Mac Van roi tong mon, tien vao Vo Cuc Son Mach de truy tim co duyên.',
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
        required_factions: ['Thanh Van Tong'],
        required_terms: ['Linh can'],
      }],
    });

    expect(validation.blockingIssues.map((item) => item.code)).not.toContain('faction-unused');
    expect(validation.blockingIssues.map((item) => item.code)).not.toContain('term-unused');
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
        },
        {
          title: 'Chuong 2',
          summary: 'Kha vao Rung Sau de truy tim dau vet moi.',
          purpose: 'Mo tiep huong truy tim dau vet.',
          featured_characters: ['Kha'],
          primary_location: 'Rung Sau',
          thread_titles: ['Truy tim dau vet'],
          key_events: ['Kha tim thay dau vet moi'],
        },
      ],
    }, new Set(['chapter-0']));

    expect(validation.blockingIssues).toHaveLength(0);
    expect(validation.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'protagonist-unused',
      'location-unused',
      'thread-without-anchor',
    ]));
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
      },
      {
        title: 'Chuong 2',
        purpose: 'Giu nhip tiep noi.',
        summary: 'Mo rong anh huong cua chapter dau.',
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
