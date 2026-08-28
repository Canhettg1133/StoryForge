import { webcrypto } from 'node:crypto';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManuscriptSnapshot, hashReviewValue, resolveSnapshotEvidence, findEvidenceInEditor } from '../../features/manuscriptReview/snapshot.js';
import { manuscriptReviewCorpus } from '../fixtures/manuscriptReviewCorpus.js';

describe('manuscript review source snapshot', () => {
  let editor;
  const makeEditor = (content) => (editor = new Editor({ extensions: [StarterKit], content }));
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  afterEach(() => { editor?.destroy(); vi.unstubAllGlobals(); });

  it.each(manuscriptReviewCorpus)('keeps exact text and UTF-16 evidence for $id', ({ text }) => {
    makeEditor({ type: 'doc', content: text.split('\n\n').map((part) => ({ type: 'paragraph', content: [{ type: 'text', text: part }] })) });
    const snapshot = createManuscriptSnapshot(editor, { scope: 'scene', project: { id: 1 }, scene: { id: 2, chapter_id: 3 } });
    expect(snapshot.text).toBe(text);
    for (const paragraph of snapshot.paragraphs) {
      const anchor = resolveSnapshotEvidence(snapshot, { paragraph_id: paragraph.id, quote: paragraph.text });
      expect(editor.state.doc.textBetween(anchor.from, anchor.to, '\n')).toBe(paragraph.text);
    }
  });

  it('reads only the live selection across formatting and paragraph boundaries', () => {
    makeEditor('<p>Vy 💍 <strong>đợi</strong> mãi.</p><p>Hòa về.</p>');
    editor.commands.setTextSelection({ from: 4, to: 19 });
    const snapshot = createManuscriptSnapshot(editor, { scope: 'selection', scene: { draft_text: '<p>old</p>' } });
    expect(snapshot.text).toContain('💍 đợi mãi.\n\n');
    const evidence = resolveSnapshotEvidence(snapshot, { paragraph_id: 'p1', quote: '💍 đợi' });
    expect(editor.state.doc.textBetween(evidence.from, evidence.to)).toBe('💍 đợi');
    expect(snapshot.text).not.toContain('old');
  });

  it('preserves hard breaks, combining marks and distinct duplicate quotes', async () => {
    makeEditor('<p>Vy á<br>đợi. Vy á đợi.</p>');
    const snapshot = createManuscriptSnapshot(editor, { scope: 'scene' });
    expect(snapshot.text).toBe('Vy á\nđợi. Vy á đợi.');
    expect(resolveSnapshotEvidence(snapshot, { paragraph_id: 'p1', quote: 'Vy á' })).toBeNull();
    const evidence = resolveSnapshotEvidence(snapshot, { paragraph_id: 'p1', quote: 'Vy á', suffix: ' đợi.' });
    expect(evidence).not.toBeNull();
    expect(editor.state.doc.textBetween(evidence.from, evidence.to)).toBe('Vy á');
    expect(await findEvidenceInEditor(editor, evidence)).toMatchObject({ from: evidence.from, to: evidence.to });
  });

  it('rejects empty selection and oversized source without falling back or truncating', () => {
    makeEditor('<p>Văn bản.</p>');
    expect(() => createManuscriptSnapshot(editor, { scope: 'selection' })).toThrow(/chọn/i);
    editor.commands.setContent(`<p>${'a'.repeat(60_001)}</p>`);
    expect(() => createManuscriptSnapshot(editor, { scope: 'scene' })).toThrow(/60.000/);
  });

  it('uses stable SHA-256 without collapsing paragraph boundaries or Unicode', async () => {
    expect(await hashReviewValue('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashReviewValue('a\n\nb')).not.toBe(await hashReviewValue('a b'));
    expect(await hashReviewValue({ b: 2, a: 1 })).toBe(await hashReviewValue({ a: 1, b: 2 }));
  });
});
