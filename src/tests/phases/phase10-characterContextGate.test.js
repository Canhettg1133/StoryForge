import { describe, expect, it } from 'vitest';
import { buildCharacterContextGate } from '../../services/ai/characterContextGate';

describe('phase10 character context gate', () => {
  const characters = [
    { id: 1, name: 'Lan', role: 'protagonist', aliases: ['A Lan'] },
    { id: 2, name: 'Kha', role: 'supporting', aliases: ['Bach Y'] },
    { id: 3, name: 'Mai', role: 'supporting', aliases: ['Hoa'] },
    { id: 4, name: 'Long', role: 'supporting', aliases: ['Thanh'] },
    { id: 5, name: 'Thanh', role: 'supporting', aliases: ['Thanh'] },
    { id: 6, name: 'Ngoc', role: 'supporting', aliases: ['Ngoc boi'] },
    { id: 7, name: 'Huyen', role: 'supporting', aliases: ['Bach Y'] },
  ];

  it('keeps POV and characters_present in sceneCast even when scene text mentions another character', () => {
    const gate = buildCharacterContextGate({
      allCharacters: characters,
      allLocations: [],
      allObjects: [],
      allTerms: [],
      allFactions: [],
      allRelationships: [],
      canonFacts: [],
      taboos: [],
      scene: { pov_character_id: 1, characters_present: '[2]' },
      sceneText: 'Huyen dung ngoai cua va nghe tieng gio.',
      userPrompt: '',
      currentChapterOutline: null,
      chapterBlueprintContext: null,
    });

    expect(gate.sceneCast.map((item) => item.character.name)).toEqual(['Lan', 'Kha']);
    expect(gate.referencedCanonCast.map((item) => item.character.name)).toContain('Huyen');
    expect(gate.sceneCast.some((item) => item.character.name === 'Huyen')).toBe(false);
  });

  it('puts featured characters into chapterFocusCast without granting scene permission', () => {
    const gate = buildCharacterContextGate({
      allCharacters: characters,
      allLocations: [],
      allObjects: [],
      allTerms: [],
      allFactions: [],
      allRelationships: [],
      canonFacts: [],
      taboos: [],
      scene: { pov_character_id: 1, characters_present: '[]' },
      sceneText: '',
      userPrompt: '',
      currentChapterOutline: { featuredCharacters: ['Kha'], summary: 'Kha bi cuon vao bien co.' },
      chapterBlueprintContext: null,
    });

    expect(gate.sceneCast.map((item) => item.character.name)).toEqual(['Lan']);
    expect(gate.chapterFocusCast.map((item) => item.character.name)).toEqual(['Kha']);
    expect(gate.chapterFocusCast[0].permission).toBe('chapter_focus_only');
  });

  it('downgrades ambiguous short names and terms that collide with objects or locations', () => {
    const gate = buildCharacterContextGate({
      allCharacters: characters,
      allLocations: [{ id: 11, name: 'Mai' }],
      allObjects: [{ id: 21, name: 'Ngoc boi' }],
      allTerms: [],
      allFactions: [],
      allRelationships: [],
      canonFacts: [],
      taboos: [],
      scene: { pov_character_id: null, characters_present: '[]' },
      sceneText: 'Mai den som. Ngoc boi nam tren ban. Thanh van im lang.',
      userPrompt: '',
      currentChapterOutline: null,
      chapterBlueprintContext: null,
    });

    expect(gate.sceneCast).toHaveLength(0);
    expect(gate.referencedCanonCast.map((item) => item.character.name)).not.toContain('Mai');
    expect(gate.referencedCanonCast.map((item) => item.character.name)).not.toContain('Ngoc');
    expect(gate.blockedOrWeakCast.map((item) => item.character.name)).toEqual(expect.arrayContaining(['Mai', 'Ngoc']));
    expect(gate.blockedOrWeakCast.map((item) => item.character.name)).toEqual(expect.arrayContaining(['Long', 'Thanh']));
  });
});
