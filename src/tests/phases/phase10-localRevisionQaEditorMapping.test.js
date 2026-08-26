import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  buildProseMirrorTextMap,
  createEditorAnalysisSource,
  textRangeToProseMirror,
} from '../../services/revisionQa/editorSnapshot.js';
import { buildFindingAnchor, resolveFindingAnchor } from '../../services/revisionQa/sourceSnapshot.js';
import { getLocalRevisionQaFixture } from '../fixtures/localRevisionQaCorpus.js';

const editors = [];

function makeEditor(content) {
  const editor = new Editor({ extensions: [StarterKit], content });
  editors.push(editor);
  return editor;
}

function paragraphDocument(text) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('local Revision QA ProseMirror mapping', () => {
  it('preserves paragraph boundaries and UTF-16 offsets after emoji', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Vy đặt 💍.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Cô đi  tiếp.' }] },
      ],
    });
    const map = buildProseMirrorTextMap(editor.state.doc);
    const start = map.text.indexOf('  ');
    const pmRange = textRangeToProseMirror(map, start, start + 2);

    expect(map.text).toBe('Vy đặt 💍.\n\nCô đi  tiếp.');
    expect(editor.state.doc.textBetween(pmRange.from, pmRange.to)).toBe('  ');
  });

  it('creates a selection source with offsets anchored to the whole scene', () => {
    const editor = makeEditor('<p>Một câu.</p><p>Hai câu.</p>');
    const map = buildProseMirrorTextMap(editor.state.doc);
    const selectedStart = map.text.indexOf('Hai');
    const selectedRange = textRangeToProseMirror(map, selectedStart, selectedStart + 3);
    editor.commands.setTextSelection(selectedRange);

    const source = createEditorAnalysisSource(editor, {
      projectId: 1,
      chapterId: 11,
      sceneId: 101,
      selection: true,
    });

    expect(source.text).toBe('Hai');
    expect(source.sourceText).toBe('Một câu.\n\nHai câu.');
    expect(source.offsetBase).toBe(selectedStart);
  });

  it('applies one A20-style fix without invalidating the unaffected duplicate', () => {
    const text = getLocalRevisionQaFixture('A20').text;
    const editor = makeEditor(paragraphDocument(text));
    const firstStart = text.indexOf('  ');
    const secondStart = text.indexOf('  ', firstStart + 2);
    const firstAnchor = buildFindingAnchor(text, firstStart, firstStart + 2);
    const secondAnchor = buildFindingAnchor(text, secondStart, secondStart + 2);
    const firstPm = textRangeToProseMirror(buildProseMirrorTextMap(editor.state.doc), firstStart, firstStart + 2);

    editor.commands.insertContentAt(firstPm, ' ');
    const updated = buildProseMirrorTextMap(editor.state.doc).text;

    expect(resolveFindingAnchor(updated, firstAnchor)).toBeNull();
    expect(resolveFindingAnchor(updated, secondAnchor)).not.toBeNull();
  });
});
