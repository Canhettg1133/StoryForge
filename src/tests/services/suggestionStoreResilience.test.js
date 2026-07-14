import { afterEach, describe, expect, it } from 'vitest';
import useSuggestionStore from '../../stores/suggestionStore.js';

describe('Suggestion inbox store resilience', () => {
  afterEach(() => {
    useSuggestionStore.setState({
      suggestions: [],
      loading: false,
      errorCode: '',
    });
  });

  it('fails closed when IndexedDB is unavailable instead of leaking an unhandled rejection', async () => {
    const suggestions = await useSuggestionStore.getState().loadSuggestions(987654321);

    expect(suggestions).toEqual([]);
    expect(useSuggestionStore.getState()).toMatchObject({
      suggestions: [],
      loading: false,
      errorCode: 'SUGGESTION_STORE_UNAVAILABLE',
    });
  });
});
