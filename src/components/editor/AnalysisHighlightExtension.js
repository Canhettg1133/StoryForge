import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const analysisHighlightKey = new PluginKey('analysisHighlight');

const AnalysisHighlightExtension = Extension.create({
  name: 'analysisHighlight',

  addCommands() {
    return {
      setAnalysisHighlight: (range) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(analysisHighlightKey, range));
        return true;
      },
      clearAnalysisHighlight: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(analysisHighlightKey, null));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: analysisHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations) {
            const requested = transaction.getMeta(analysisHighlightKey);
            if (requested === undefined) return decorations.map(transaction.mapping, transaction.doc);
            if (!requested) return DecorationSet.empty;
            const from = Math.max(1, Math.min(requested.from, transaction.doc.content.size));
            const to = Math.max(from, Math.min(requested.to, transaction.doc.content.size));
            if (from === to) return DecorationSet.empty;
            return DecorationSet.create(transaction.doc, [
              Decoration.inline(from, to, {
                class: 'revision-qa-highlight',
                'data-analysis-highlight': 'true',
              }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return analysisHighlightKey.getState(state);
          },
        },
      }),
    ];
  },
});

export default AnalysisHighlightExtension;
