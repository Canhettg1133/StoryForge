import { describe, expect, it } from 'vitest';
import {
  normalizeWizardBlueprintResult,
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
      characters: [{ name: ' Lan ', role: ' protagonist ', story_function: 'neo mo dau' }],
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
    expect(normalized.locations[0].story_function).toBe('san khau mo dau');
    expect(normalized.terms[0].story_function).toBe('giai thich he thong');
    expect(normalized.plot_threads[0].anchor_chapters).toEqual(['Chuong 1']);
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
