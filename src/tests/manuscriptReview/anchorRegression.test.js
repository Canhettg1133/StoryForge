import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManuscriptSnapshot, findEvidenceInEditor, hashReviewValue, resolveSnapshotEvidence } from '../../features/manuscriptReview/snapshot.js';

describe('manuscript review evidence identity across duplicate paragraphs', () => {
  let editor;
  const repeated = 'Mưa gõ mái hiên. Lan khép cửa.';
  const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const makeEditor = (texts) => (editor = new Editor({
    extensions: [StarterKit],
    content: { type: 'doc', content: texts.map(paragraph) },
  }));
  // Reports survive reload, so anchors must not rely on an in-memory object identity.
  const persisted = (anchor) => JSON.parse(JSON.stringify(anchor));
  const locate = async (anchor, snapshot) => findEvidenceInEditor(editor, anchor, { sceneSignature: await hashReviewValue(snapshot.sceneParagraphs) });
  beforeEach(() => vi.stubGlobal('crypto', webcrypto));
  afterEach(() => { editor?.destroy(); vi.unstubAllGlobals(); });

  it('returns the verified second paragraph when the document is unchanged, including a persisted anchor', async () => {
    makeEditor([repeated, repeated]);
    const snapshot = createManuscriptSnapshot(editor, { scope: 'scene' });
    const anchor = resolveSnapshotEvidence(snapshot, { paragraph_id: 'p2', quote: 'Lan khép cửa.' });
    const secondStart = editor.state.doc.firstChild.nodeSize + 1;

    expect(anchor).not.toBeNull();
    expect(anchor.from).toBe(secondStart + repeated.indexOf('Lan khép cửa.'));
    expect(editor.state.doc.textBetween(anchor.from, anchor.to)).toBe(anchor.quote);
    expect(await locate(persisted(anchor), snapshot)).toMatchObject({ from: anchor.from, to: anchor.to });
  });

  it('does not confuse selection-local paragraph p1 with scene paragraph p1', async () => {
    makeEditor([repeated, repeated]);
    const secondStart = editor.state.doc.firstChild.nodeSize + 1;
    editor.commands.setTextSelection({ from: secondStart, to: secondStart + repeated.length });
    const snapshot = createManuscriptSnapshot(editor, { scope: 'selection' });
    const anchor = resolveSnapshotEvidence(snapshot, { paragraph_id: 'p1', quote: 'Lan khép cửa.' });

    expect(snapshot.paragraphs).toHaveLength(1);
    expect(anchor.from).toBe(secondStart + repeated.indexOf('Lan khép cửa.'));
    expect(await locate(persisted(anchor), snapshot)).toMatchObject({ from: anchor.from, to: anchor.to });
  });

  it('does not redirect an old duplicate anchor to its surviving twin after the target paragraph is deleted', async () => {
    makeEditor([repeated, repeated]);
    const snapshot = createManuscriptSnapshot(editor, { scope: 'scene' });
    const anchor = persisted(resolveSnapshotEvidence(snapshot, { paragraph_id: 'p2', quote: 'Lan khép cửa.' }));
    editor.commands.deleteRange({ from: editor.state.doc.firstChild.nodeSize, to: editor.state.doc.content.size });

    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild.textContent).toBe(repeated);
    expect(await locate(anchor, snapshot)).toBeNull();
  });

  it('never trusts an old offset after another identical paragraph is inserted before the target', async () => {
    makeEditor([repeated, repeated]);
    const snapshot = createManuscriptSnapshot(editor, { scope: 'scene' });
    const anchor = persisted(resolveSnapshotEvidence(snapshot, { paragraph_id: 'p2', quote: 'Lan khép cửa.' }));
    const insertedSize = editor.state.doc.firstChild.nodeSize;
    editor.commands.insertContentAt(0, paragraph(repeated));
    const resolved = await locate(anchor, snapshot);

    expect(editor.state.doc.childCount).toBe(3);
    // Either verified transaction mapping or a conservative refusal is safe.
    // Returning the old position would select the original first paragraph instead.
    expect([null, anchor.from + insertedSize]).toContain(resolved?.from ?? null);
  });

  it('still relocates a uniquely identifiable quote after unrelated text is inserted before it', async () => {
    makeEditor(['Ngoài ngõ có tiếng xe.', 'Lan khép chiếc cửa màu xanh.']);
    const snapshot = createManuscriptSnapshot(editor, { scope: 'scene' });
    const anchor = persisted(resolveSnapshotEvidence(snapshot, { paragraph_id: 'p2', quote: 'chiếc cửa màu xanh' }));
    const insertedText = 'Bà Thu đặt bát xuống.';
    editor.commands.insertContentAt(0, paragraph(insertedText));
    const resolved = await locate(anchor, snapshot);

    expect(resolved).toMatchObject({ from: anchor.from + insertedText.length + 2, quote: anchor.quote });
    expect(editor.state.doc.textBetween(resolved.from, resolved.to)).toBe(anchor.quote);
  });

  it('counts ambiguous matches within one paragraph, not just distinct matching paragraphs', async () => {
    makeEditor(['Lan']);
    const snapshot = createManuscriptSnapshot(editor);
    const anchor = resolveSnapshotEvidence(snapshot, { paragraph_id: 'p1', quote: 'Lan' });
    editor.commands.insertContentAt(0, paragraph('Lan Lan'));
    expect(await locate(anchor, snapshot)).toBeNull();
  });
});
