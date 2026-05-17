export const OUTLINE_METADATA_TEXT_FIELDS = [
  'purpose',
  'summary',
  'state_delta',
  'conflict',
  'decision_or_consequence',
  'pacing',
  'primary_location',
  'opening_state',
  'handoff_from_previous',
  'ending_state',
];

export const OUTLINE_METADATA_LIST_FIELDS = [
  'featured_characters',
  'thread_titles',
  'key_events',
  'required_factions',
  'required_objects',
  'required_terms',
];

export function buildClearOutlinePatch() {
  return {
    purpose: '',
    summary: '',
    state_delta: '',
    conflict: '',
    decision_or_consequence: '',
    continuity_in: { response: '' },
    continuity_out: { text: '' },
    state_changes: [],
    pacing: '',
    featured_characters: [],
    primary_location: '',
    thread_titles: [],
    key_events: [],
    required_factions: [],
    required_objects: [],
    required_terms: [],
    opening_state: '',
    handoff_from_previous: '',
    ending_state: '',
    arc_id: null,
  };
}
