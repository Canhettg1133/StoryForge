function appendNodeText(node, nodePosition, state) {
  if (node.isText) {
    for (let index = 0; index < node.text.length; index += 1) {
      state.positions[state.text.length] = nodePosition + index;
      state.text += node.text[index];
    }
    state.positions[state.text.length] = nodePosition + node.text.length;
    return;
  }

  if (node.type?.name === 'hardBreak') {
    state.positions[state.text.length] = nodePosition;
    state.text += '\n';
    state.positions[state.text.length] = nodePosition + 1;
    return;
  }

  node.forEach((child, offset) => {
    appendNodeText(child, nodePosition + offset + 1, state);
  });
}

export function buildProseMirrorTextMap(doc) {
  const state = { text: '', positions: [] };
  const blocks = [];
  doc.forEach((node, offset) => blocks.push({ node, offset }));

  blocks.forEach(({ node, offset }, index) => {
    appendNodeText(node, offset, state);
    if (index < blocks.length - 1) {
      const nextPosition = blocks[index + 1].offset + 1;
      state.positions[state.text.length] = nextPosition;
      state.text += '\n\n';
      state.positions[state.text.length - 1] = nextPosition;
      state.positions[state.text.length] = nextPosition;
    }
  });

  if (state.positions[0] == null) state.positions[0] = 1;
  if (state.positions[state.text.length] == null) state.positions[state.text.length] = doc.content.size;
  return state;
}

export function textRangeToProseMirror(map, from, to) {
  const safeFrom = Math.max(0, Math.min(from, map.text.length));
  const safeTo = Math.max(safeFrom, Math.min(to, map.text.length));
  const pmFrom = map.positions[safeFrom];
  const pmTo = map.positions[safeTo];
  if (!Number.isInteger(pmFrom) || !Number.isInteger(pmTo) || pmTo < pmFrom) return null;
  return { from: pmFrom, to: pmTo };
}

export function proseMirrorPositionToTextOffset(map, position) {
  let best = 0;
  for (let offset = 0; offset < map.positions.length; offset += 1) {
    const current = map.positions[offset];
    if (current === position) {
      best = offset;
      continue;
    }
    if (current < position) best = offset;
    if (current > position) break;
  }
  return best;
}

export function createEditorAnalysisSource(editor, { projectId, chapterId, sceneId, selection = false } = {}) {
  const map = buildProseMirrorTextMap(editor.state.doc);
  let from = 0;
  let to = map.text.length;
  if (selection && !editor.state.selection.empty) {
    from = proseMirrorPositionToTextOffset(map, editor.state.selection.from);
    to = proseMirrorPositionToTextOffset(map, editor.state.selection.to);
  }
  return {
    projectId,
    chapterId,
    sceneId,
    text: map.text.slice(from, to),
    sourceText: map.text,
    offsetBase: from,
  };
}
