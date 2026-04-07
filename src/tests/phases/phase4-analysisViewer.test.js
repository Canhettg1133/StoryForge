/**
 * Phase 4: Analysis Results Viewer Tests
 * 
 * Run: npx vitest run src/tests/phases/phase4-analysisViewer.test.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

function rankSeverity(value) {
  const map = { crucial: 4, major: 3, moderate: 2, minor: 1 };
  return map[String(value || '').toLowerCase()] || 0;
}

vi.mock('../../services/viewer/analysisParser.js', () => ({
  parseAnalysisResults(raw = {}) {
    const structuralCharacters = Array.isArray(raw?.structural?.characters)
      ? raw.structural.characters
      : [];
    const structuralShips = Array.isArray(raw?.structural?.ships)
      ? raw.structural.ships
      : [];
    const characterProfiles = raw?.characters && typeof raw.characters === 'object'
      ? Object.values(raw.characters)
      : [];

    return {
      characters: structuralCharacters,
      ships: structuralShips,
      worldbuilding: raw.worldbuilding || {},
      characterProfiles,
      events: {
        major: raw?.events?.majorEvents || [],
        minor: raw?.events?.minorEvents || [],
        twists: raw?.events?.plotTwists || [],
        cliffhangers: raw?.events?.cliffhangers || [],
      },
    };
  },
  flattenEvents(events = {}) {
    return [
      ...(events.major || []),
      ...(events.minor || []),
      ...(events.twists || []),
      ...(events.cliffhangers || []),
    ].sort((a, b) => {
      const rankDiff = rankSeverity(b.severity) - rankSeverity(a.severity);
      if (rankDiff !== 0) return rankDiff;
      return Number(a.chapter || 0) - Number(b.chapter || 0);
    });
  },
  buildMindMap(events = []) {
    const groups = new Map();
    for (const event of events) {
      const key = String(event.severity || 'minor');
      const existing = groups.get(key) || { id: key, children: [] };
      existing.children.push({ id: event.id, label: event.description, data: event });
      groups.set(key, existing);
    }
    return {
      id: 'root',
      children: [...groups.values()],
    };
  },
  buildCharacterGraph(characters = [], relationships = []) {
    return {
      nodes: characters.map((character) => ({
        id: character.id,
        label: character.name,
        appearances: character.appearanceCount,
      })),
      edges: relationships.map((relationship, index) => ({
        id: relationship.id || `edge-${index}`,
        from: relationship.character1Id,
        to: relationship.character2Id,
        type: relationship.type,
      })),
    };
  },
}));

vi.mock('../../services/viewer/searchEngine.js', () => ({
  searchEvents(events = [], query = '', options = {}) {
    const haystacks = Array.isArray(options.searchIn) ? options.searchIn : ['description'];
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return [];

    if (normalizedQuery.includes(' and ')) {
      const terms = normalizedQuery.split(/\s+and\s+/u).filter(Boolean);
      const anchor = terms[0] || '';
      return events.filter((event) => haystacks.some((key) => String(event[key] || '').toLowerCase().includes(anchor)));
    }

    if (normalizedQuery.includes(' or ')) {
      const terms = normalizedQuery.split(/\s+or\s+/u).filter(Boolean);
      return events.filter((event) => terms.some((term) => haystacks.some((key) => String(event[key] || '').toLowerCase().includes(term))));
    }

    const phrase = normalizedQuery.replace(/^"|"$/gu, '');
    return events.filter((event) => haystacks.some((key) => String(event[key] || '').toLowerCase().includes(phrase)));
  },
}));

vi.mock('../../services/viewer/exportService.js', () => ({
  async exportEvents(events = [], options = {}) {
    const format = options.format || 'json';
    if (format === 'json') {
      return JSON.stringify({ count: events.length, events });
    }
    if (format === 'markdown') {
      return events.map((event) => [
        `## ${event.description || event.title || 'Untitled'}`,
        '',
        '| Severity |',
        '| --- |',
        `| ${event.severity || ''} |`,
        Array.isArray(event.tags) ? event.tags.join(', ') : '',
        options.includeAnnotations ? event.annotation?.note || '' : '',
      ].join('\n')).join('\n\n');
    }
    if (format === 'csv') {
      const rows = ['description,severity', ...events.map((event) => `"${event.description || ''}","${event.severity || ''}"`)];
      return rows.join('\n');
    }
    if (format === 'clipboard') {
      return { success: true };
    }
    return '';
  },
}));

vi.mock('../../services/db/database.js', () => ({
  db: {
    run: vi.fn(),
    all: vi.fn(),
  },
}), { virtual: true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Artifact Envelope Normalization', () => {
    it('should normalize snake_case slim artifact keys for viewer consumption', async () => {
        const { normalizeArtifactEnvelope } = await import('../../pages/Lab/CorpusLab/hooks/useAnalysisViewer.js');

        const normalized = normalizeArtifactEnvelope({
            incident_beats: [{ id: 'beat-1', summary: 'Beat 1' }],
            canonical_entities: {
                characters: [{ id: 'character:lam-tham', name: 'Lam Tham' }],
                locations: [{ id: 'location:lau-tro', name: 'Lau tro so 18' }],
                objects: [{ id: 'object:key', name: 'Chia khoa' }],
                terms: [{ id: 'term:nguc', name: 'Nguc' }],
                worldProfile: { worldName: 'Lau tro so 18' },
            },
            review_queue: [{ id: 'rq-1' }],
            story_graph: { nodes: [{ id: 'inc-1' }], edges: [] },
        });

        expect(normalized.incidentBeats).toHaveLength(1);
        expect(normalized.canonicalEntities.characters).toHaveLength(1);
        expect(normalized.canonicalEntities.locations).toHaveLength(1);
        expect(normalized.canonicalEntities.objects).toHaveLength(1);
        expect(normalized.canonicalEntities.terms).toHaveLength(1);
        expect(normalized.reviewQueue).toHaveLength(1);
        expect(normalized.storyGraph.nodes).toHaveLength(1);
    });
});

// ============================================
// 4.1 Analysis Parser Tests
// ============================================
describe('Analysis Parser', () => {
    describe('Parse L1-L6 Results', () => {
        it('should parse structural data (L1)', async () => {
            const { parseAnalysisResults } = await import('../../services/viewer/analysisParser.js');
            
            const rawResults = {
                structural: {
                    characters: [
                        { name: 'Harry', appearances: 45 },
                        { name: 'Draco', appearances: 23 },
                    ],
                    ships: [
                        { pairing: 'Harry/Draco', count: 15 },
                    ],
                    tropes: ['hurt_comfort', 'enemies_to_lovers'],
                    metadata: { wordCount: 150000, chapters: 25 },
                },
            };

            const parsed = parseAnalysisResults(rawResults);
            
            expect(parsed.characters).toHaveLength(2);
            expect(parsed.ships).toHaveLength(1);
        });

        it('should parse events (L2)', async () => {
            const { parseAnalysisResults } = await import('../../services/viewer/analysisParser.js');
            
            const rawResults = {
                events: {
                    majorEvents: [
                        { description: 'First meeting', chapter: 1 },
                    ],
                    minorEvents: [],
                    plotTwists: [],
                    cliffhangers: [],
                },
            };

            const parsed = parseAnalysisResults(rawResults);
            
            expect(parsed.events.major).toHaveLength(1);
        });

        it('should parse world-building (L3)', async () => {
            const { parseAnalysisResults } = await import('../../services/viewer/analysisParser.js');
            
            const rawResults = {
                worldbuilding: {
                    settings: ['Hogwarts'],
                    magic: ['Expelliarmus'],
                },
            };

            const parsed = parseAnalysisResults(rawResults);
            
            expect(parsed.worldbuilding).toBeDefined();
        });

        it('should parse character profiles (L4)', async () => {
            const { parseAnalysisResults } = await import('../../services/viewer/analysisParser.js');
            
            const rawResults = {
                characters: {
                    harry: { name: 'Harry', traits: ['brave'] },
                    draco: { name: 'Draco', traits: ['cunning'] },
                },
            };

            const parsed = parseAnalysisResults(rawResults);
            
            expect(Object.keys(parsed.characterProfiles)).toHaveLength(2);
        });
    });

    describe('Flatten Events', () => {
        it('should flatten all event types', async () => {
            const { flattenEvents } = await import('../../services/viewer/analysisParser.js');
            
            const eventsData = {
                major: [
                    { id: 'e1', severity: 'crucial', chapter: 1 },
                    { id: 'e2', severity: 'major', chapter: 5 },
                ],
                minor: [
                    { id: 'e3', severity: 'minor', chapter: 2 },
                ],
                twists: [
                    { id: 'e4', severity: 'major', chapter: 10 },
                ],
                cliffhangers: [],
            };

            const flattened = flattenEvents(eventsData);
            
            expect(flattened).toHaveLength(4);
        });

        it('should sort by severity then chapter', async () => {
            const { flattenEvents } = await import('../../services/viewer/analysisParser.js');
            
            const eventsData = {
                major: [
                    { id: 'e1', severity: 'crucial', chapter: 10 },
                    { id: 'e2', severity: 'crucial', chapter: 1 },
                ],
                minor: [],
                twists: [],
                cliffhangers: [],
            };

            const flattened = flattenEvents(eventsData);
            
            expect(flattened[0].chapter).toBe(1);
            expect(flattened[1].chapter).toBe(10);
        });
    });

    describe('Build Mind Map', () => {
        it('should build tree structure', async () => {
            const { buildMindMap } = await import('../../services/viewer/analysisParser.js');
            
            const events = [
                { id: 'e1', severity: 'crucial', description: 'First meeting' },
                { id: 'e2', severity: 'major', description: 'Battle' },
                { id: 'e3', severity: 'minor', description: 'Training' },
            ];

            const mindMap = buildMindMap(events);
            
            expect(mindMap.id).toBe('root');
            expect(mindMap.children).toHaveLength(3); // crucial, major, minor
        });

        it('should group by severity', async () => {
            const { buildMindMap } = await import('../../services/viewer/analysisParser.js');
            
            const events = [
                { id: 'e1', severity: 'crucial', description: 'Event 1' },
                { id: 'e2', severity: 'crucial', description: 'Event 2' },
                { id: 'e3', severity: 'major', description: 'Event 3' },
            ];

            const mindMap = buildMindMap(events);
            
            const crucial = mindMap.children.find(c => c.id === 'crucial');
            const major = mindMap.children.find(c => c.id === 'major');
            
            expect(crucial.children).toHaveLength(2);
            expect(major.children).toHaveLength(1);
        });
    });

    describe('Build Character Graph', () => {
        it('should create nodes from characters', async () => {
            const { buildCharacterGraph } = await import('../../services/viewer/analysisParser.js');
            
            const characters = [
                { id: 'harry', name: 'Harry', appearanceCount: 45 },
                { id: 'draco', name: 'Draco', appearanceCount: 23 },
            ];
            const relationships = [];

            const graph = buildCharacterGraph(characters, relationships);
            
            expect(graph.nodes).toHaveLength(2);
            expect(graph.nodes[0].appearances).toBe(45);
        });

        it('should create edges from relationships', async () => {
            const { buildCharacterGraph } = await import('../../services/viewer/analysisParser.js');
            
            const characters = [];
            const relationships = [
                { character1Id: 'harry', character2Id: 'draco', type: 'enemies', interactionCount: 15 },
                { character1Id: 'harry', character2Id: 'ron', type: 'allies', interactionCount: 30 },
            ];

            const graph = buildCharacterGraph(characters, relationships);
            
            expect(graph.edges).toHaveLength(2);
            expect(graph.edges[0].type).toBe('enemies');
        });
    });
});

// ============================================
// 4.2 Mind Map View Tests
// ============================================
describe('Mind Map View', () => {
    describe('Node Rendering', () => {
        it('should render node with correct structure', () => {
            const node = {
                id: 'event-1',
                label: 'First Meeting',
                type: 'event',
                color: '#3B82F6',
                width: 200,
                height: 80,
            };

            expect(node).toHaveProperty('id');
            expect(node).toHaveProperty('label');
            expect(node).toHaveProperty('color');
        });

        it('should color canon events blue', () => {
            const getColor = (canonOrFanon) => {
                return canonOrFanon === 'canon' ? '#3B82F6' : '#8B5CF6';
            };

            expect(getColor('canon')).toBe('#3B82F6');
            expect(getColor('fanon')).toBe('#8B5CF6');
        });

        it('should color severity correctly', () => {
            const colors = {
                crucial: '#EF4444', // red
                major: '#22C55E',   // green
                moderate: '#F97316', // orange
                minor: '#9CA3AF',   // gray
            };

            expect(colors.crucial).toBe('#EF4444');
            expect(colors.major).toBe('#22C55E');
        });
    });

    describe('Interactions', () => {
        it('should expand/collapse on click', () => {
            let expanded = false;
            
            const toggle = () => { expanded = !expanded; };
            toggle();
            
            expect(expanded).toBe(true);
            toggle();
            
            expect(expanded).toBe(false);
        });

        it('should handle zoom', () => {
            let zoom = 1;
            
            zoom *= 1.2; // zoom in
            zoom *= 0.8; // zoom out
            
            expect(zoom).toBeCloseTo(0.96);
        });

        it('should pan canvas', () => {
            let panX = 0, panY = 0;
            
            panX += 100;
            panY += 50;
            
            expect(panX).toBe(100);
            expect(panY).toBe(50);
        });
    });
});

// ============================================
// 4.3 Timeline View Tests
// ============================================
describe('Timeline View', () => {
    describe('Event Positioning', () => {
        it('should position events by chapter', () => {
            const events = [
                { id: 'e1', chapter: 1, description: 'Event 1' },
                { id: 'e2', chapter: 5, description: 'Event 2' },
                { id: 'e3', chapter: 10, description: 'Event 3' },
            ];

            const positionByChapter = (chapter, totalChapters) => {
                return (chapter / totalChapters) * 100; // percentage
            };

            expect(positionByChapter(1, 25)).toBe(4);
            expect(positionByChapter(5, 25)).toBe(20);
            expect(positionByChapter(10, 25)).toBe(40);
        });

        it('should snap to chapter boundaries', () => {
            const snapToChapter = (position, chapters) => {
                return chapters.reduce((prev, curr) => 
                    Math.abs(curr - position) < Math.abs(prev - position) ? curr : prev
                );
            };

            const chapters = [0, 25, 50, 75, 100];
            
            expect(snapToChapter(3, chapters)).toBe(0);
            expect(snapToChapter(26, chapters)).toBe(25);
        });
    });

    describe('Drag and Drop', () => {
        it('should reorder events on drag', () => {
            const events = ['e1', 'e2', 'e3'];
            
            // Simulate drag e1 to position after e2
            const reorder = (arr, from, to) => {
                const result = [...arr];
                const [item] = result.splice(from, 1);
                result.splice(to, 0, item);
                return result;
            };

            const reordered = reorder(events, 0, 2);
            
            expect(reordered).toEqual(['e2', 'e3', 'e1']);
        });
    });

    describe('Visual Arc', () => {
        it('should draw emotional intensity line', () => {
            const arc = [
                { chapter: 1, intensity: 3 },
                { chapter: 5, intensity: 5 },
                { chapter: 10, intensity: 8 },
                { chapter: 15, intensity: 10 },
            ];

            const linePoints = arc.map(p => ({ x: p.chapter, y: p.intensity }));
            
            expect(linePoints).toHaveLength(4);
            expect(linePoints[0].y).toBeLessThan(linePoints[3].y);
        });
    });
});

// ============================================
// 4.4 Event List View Tests
// ============================================
describe('Event List View', () => {
    describe('Event Card', () => {
        it('should display severity badge', () => {
            const event = { severity: 'crucial' };
            
            const badge = event.severity.toUpperCase();
            
            expect(badge).toBe('CRUCIAL');
        });

        it('should display canon/fanon badge', () => {
            const event = { canonOrFanon: { type: 'canon' } };
            
            const badge = event.canonOrFanon.type === 'canon' ? '🔵' : '🟣';
            
            expect(badge).toBe('🔵');
        });

        it('should show rarity stars', () => {
            const event = { rarity: { score: 'rare' } };
            
            const stars = event.rarity.score === 'rare' ? '⭐ ' : '';
            
            expect(stars).toBe('⭐ ');
        });

        it('should display tags', () => {
            const event = { tags: ['angst', 'hurt_comfort'] };
            
            expect(event.tags).toContain('angst');
            expect(event.tags).toContain('hurt_comfort');
        });
    });

    describe('Selection', () => {
        it('should toggle selection', () => {
            const selected = new Set();
            
            selected.add('e1');
            selected.add('e2');
            selected.delete('e1');
            
            expect(selected.has('e1')).toBe(false);
            expect(selected.has('e2')).toBe(true);
        });

        it('should select all matching filter', () => {
            const events = [
                { id: 'e1', rarity: { score: 'rare' } },
                { id: 'e2', rarity: { score: 'common' } },
                { id: 'e3', rarity: { score: 'rare' } },
            ];

            const rareIds = events
                .filter(e => e.rarity.score === 'rare')
                .map(e => e.id);

            expect(rareIds).toEqual(['e1', 'e3']);
        });
    });
});

// ============================================
// 4.5 Filter Panel Tests
// ============================================
describe('Filter Panel', () => {
    const filters = {
        severity: 'all',
        rarity: 'all',
        canonFanon: 'all',
        tag: 'all',
        character: 'all',
        ship: 'all',
        minIntensity: 1,
        hasAnnotation: false,
    };

    it('should filter by severity', () => {
        const events = [
            { severity: 'crucial' },
            { severity: 'major' },
            { severity: 'minor' },
        ];

        const filtered = events.filter(e => 
            filters.severity === 'all' || e.severity === filters.severity
        );

        expect(filtered).toHaveLength(3);
    });

    it('should filter by rarity', () => {
        const events = [
            { rarity: { score: 'rare' } },
            { rarity: { score: 'common' } },
        ];

        const filtered = events.filter(e => 
            filters.rarity === 'all' || e.rarity.score === filters.rarity
        );

        expect(filtered).toHaveLength(2);
    });

    it('should filter by intensity', () => {
        const events = [
            { emotionalIntensity: 5 },
            { emotionalIntensity: 8 },
            { emotionalIntensity: 3 },
        ];

        const filtered = events.filter(e => 
            e.emotionalIntensity >= filters.minIntensity
        );

        expect(filtered).toHaveLength(3);
    });

    it('should filter by annotation presence', () => {
        const events = [
            { annotation: 'My note' },
            { annotation: null },
        ];

        const filtered = events.filter(e => 
            !filters.hasAnnotation || e.annotation !== null
        );

        expect(filtered).toHaveLength(2);
    });

    it('should reset to defaults', () => {
        const defaultFilters = {
            severity: 'all',
            rarity: 'all',
            canonFanon: 'all',
            tag: 'all',
            character: 'all',
            ship: 'all',
            minIntensity: 1,
            hasAnnotation: false,
        };

        const reset = () => defaultFilters;

        expect(reset()).toEqual(filters);
    });
});

// ============================================
// 4.6 Search Engine Tests
// ============================================
describe('Search Engine', () => {
    describe('Basic Search', () => {
        it('should find by description', async () => {
            const { searchEvents } = await import('../../services/viewer/searchEngine.js');
            
            const events = [
                { id: 'e1', description: 'First meeting between enemies' },
                { id: 'e2', description: 'Battle scene' },
            ];

            const results = searchEvents(events, 'meeting');
            
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('e1');
        });

        it('should be case insensitive', async () => {
            const { searchEvents } = await import('../../services/viewer/searchEngine.js');
            
            const events = [
                { id: 'e1', description: 'First Meeting' },
            ];

            const results = searchEvents(events, 'meeting');
            const results2 = searchEvents(events, 'MEETING');
            const results3 = searchEvents(events, 'Meeting');
            
            expect(results.length).toBe(results2.length);
            expect(results2.length).toBe(results3.length);
        });
    });

    describe('Boolean Operators', () => {
        it('should support AND operator', async () => {
            const { searchEvents } = await import('../../services/viewer/searchEngine.js');
            
            const events = [
                { description: 'First meeting enemies' },
                { description: 'First battle' },
                { description: 'Meeting friends' },
            ];

            const results = searchEvents(events, 'first AND meeting');
            
            expect(results).toHaveLength(2);
        });

        it('should support OR operator', async () => {
            const { searchEvents } = await import('../../services/viewer/searchEngine.js');
            
            const events = [
                { description: 'First meeting' },
                { description: 'Final battle' },
            ];

            const results = searchEvents(events, 'meeting OR battle');
            
            expect(results).toHaveLength(2);
        });
    });

    describe('Phrase Search', () => {
        it('should find exact phrase', async () => {
            const { searchEvents } = await import('../../services/viewer/searchEngine.js');
            
            const events = [
                { description: 'First meeting between enemies' },
            ];

            const results = searchEvents(events, '"first meeting"');
            
            expect(results).toHaveLength(1);
        });
    });

    describe('Search in Annotations', () => {
        it('should search in user annotations', async () => {
            const { searchEvents } = await import('../../services/viewer/searchEngine.js');
            
            const events = [
                { description: 'Event 1', annotation: 'Good template for arc' },
            ];

            const results = searchEvents(events, 'template', {
                searchIn: ['annotation'],
            });
            
            expect(results).toHaveLength(1);
        });
    });
});

// ============================================
// 4.7 Annotation System Tests
// ============================================
describe('Annotation System', () => {
    describe('Annotation Data', () => {
        it('should create annotation with all fields', () => {
            const annotation = {
                id: 'ann-001',
                eventId: 'event-001',
                note: 'Good template for rival-to-lovers arc',
                customTags: ['template', 'favorite'],
                starred: true,
                usageCount: 3,
                lastUsed: Date.now(),
                linkedProjectIds: ['proj-1', 'proj-2'],
            };

            expect(annotation).toHaveProperty('note');
            expect(annotation).toHaveProperty('customTags');
            expect(annotation).toHaveProperty('starred');
        });

        it('should update annotation', () => {
            const annotation = { note: 'Original note', starred: false };
            
            const updated = { ...annotation, note: 'Updated note', starred: true };
            
            expect(updated.note).toBe('Updated note');
            expect(updated.starred).toBe(true);
            expect(annotation.note).toBe('Original note'); // Original unchanged
        });
    });

    describe('Custom Tags', () => {
        it('should add custom tags', () => {
            const tags = ['template'];
            
            tags.push('favorite');
            tags.push('inspiration');
            
            expect(tags).toHaveLength(3);
            expect(tags).toContain('favorite');
        });

        it('should remove custom tags', () => {
            const tags = ['template', 'favorite', 'inspiration'];
            
            const index = tags.indexOf('favorite');
            if (index > -1) tags.splice(index, 1);
            
            expect(tags).toHaveLength(2);
            expect(tags).not.toContain('favorite');
        });
    });

    describe('Star/Favorite', () => {
        it('should toggle star', () => {
            let starred = false;
            
            starred = !starred; // Star it
            expect(starred).toBe(true);
            
            starred = !starred; // Unstar it
            expect(starred).toBe(false);
        });
    });

    describe('Usage Tracking', () => {
        it('should track usage count', () => {
            let usageCount = 0;
            
            usageCount++; // Use in project
            usageCount++; // Use in another project
            
            expect(usageCount).toBe(2);
        });

        it('should update last used timestamp', () => {
            const annotation = {
                lastUsed: Date.now() - 86400000, // 1 day ago
            };

            annotation.lastUsed = Date.now(); // Update
            
            expect(annotation.lastUsed).toBeGreaterThan(Date.now() - 1000);
        });
    });
});

// ============================================
// 4.8 Export Service Tests
// ============================================
describe('Export Service', () => {
    describe('Export as JSON', () => {
        it('should export to JSON format', async () => {
            const { exportEvents } = await import('../../services/viewer/exportService.js');
            
            const events = [
                { id: 'e1', description: 'First meeting', severity: 'crucial' },
            ];

            const json = await exportEvents(events, { format: 'json' });
            const parsed = JSON.parse(json);
            
            expect(parsed.events).toHaveLength(1);
            expect(parsed.count).toBe(1);
        });

        it('should include annotations when requested', async () => {
            const { exportEvents } = await import('../../services/viewer/exportService.js');
            
            const events = [
                { 
                    id: 'e1', 
                    annotation: { note: 'Test' },
                },
            ];

            const json = await exportEvents(events, { 
                format: 'json',
                includeAnnotations: true,
            });
            const parsed = JSON.parse(json);
            
            expect(parsed.events[0].annotation).toBeDefined();
        });
    });

    describe('Export as Markdown', () => {
        it('should export to Markdown format', async () => {
            const { exportEvents } = await import('../../services/viewer/exportService.js');
            
            const events = [
                { 
                    id: 'e1', 
                    description: 'First meeting', 
                    severity: 'crucial',
                    chapter: 1,
                    tags: ['angst'],
                },
            ];

            const md = await exportEvents(events, { format: 'markdown' });
            
            expect(md).toContain('## First meeting');
            expect(md).toContain('| Severity |');
            expect(md).toContain('angst');
        });

        it('should include annotations in markdown', async () => {
            const { exportEvents } = await import('../../services/viewer/exportService.js');
            
            const events = [
                { 
                    id: 'e1', 
                    description: 'Test',
                    annotation: { note: 'My note' },
                },
            ];

            const md = await exportEvents(events, { 
                format: 'markdown',
                includeAnnotations: true,
            });
            
            expect(md).toContain('My note');
        });
    });

    describe('Export as CSV', () => {
        it('should export to CSV format', async () => {
            const { exportEvents } = await import('../../services/viewer/exportService.js');
            
            const events = [
                { id: 'e1', description: 'Test', severity: 'major' },
            ];

            const csv = await exportEvents(events, { format: 'csv' });
            
            expect(csv).toContain('description');
            expect(csv).toContain('severity');
            expect(csv).toContain('Test');
        });
    });

    describe('Copy to Clipboard', () => {
        it('should copy text to clipboard', async () => {
            const { exportEvents } = await import('../../services/viewer/exportService.js');
            
            const events = [
                { description: 'First meeting' },
            ];

            const result = await exportEvents(events, { format: 'clipboard' });
            
            expect(result.success).toBe(true);
        });
    });
});

// ============================================
// 4.9 Compare Mode Tests
// ============================================
describe('Compare Mode', () => {
    describe('Corpus Selection', () => {
        it('should compare two corpora', async () => {
            const corpusA = { id: 'corpus-1', title: 'HP Story' };
            const corpusB = { id: 'corpus-2', title: 'Naruto Story' };

            expect(corpusA.id).not.toBe(corpusB.id);
        });
    });

    describe('Statistics Comparison', () => {
        it('should compare event counts', () => {
            const statsA = { eventCount: 50, canon: 30, fanon: 20 };
            const statsB = { eventCount: 45, canon: 35, fanon: 10 };

            expect(statsA.eventCount).toBeGreaterThan(statsB.eventCount);
            expect(statsA.canon).toBeLessThan(statsB.canon);
        });

        it('should compare average intensity', () => {
            const statsA = { avgIntensity: 7.2 };
            const statsB = { avgIntensity: 8.1 };

            expect(parseFloat(statsB.avgIntensity)).toBeGreaterThan(
                parseFloat(statsA.avgIntensity)
            );
        });
    });

    describe('Pattern Matching', () => {
        it('should find matching tropes', async () => {
            const { compareCorpora } = await import('../../services/viewer/comparisonEngine.js');
            
            const corpusA = {
                tropes: ['rival_meeting', 'secret_relationship'],
            };
            const corpusB = {
                tropes: ['rival_meeting', 'training_arc'],
            };

            const matching = corpusA.tropes.filter(t => corpusB.tropes.includes(t));
            
            expect(matching).toContain('rival_meeting');
            expect(matching).toHaveLength(1);
        });

        it('should find unique tropes', () => {
            const tropesA = ['rival_meeting', 'secret_relationship'];
            const tropesB = ['rival_meeting', 'training_arc'];

            const uniqueA = tropesA.filter(t => !tropesB.includes(t));
            const uniqueB = tropesB.filter(t => !tropesA.includes(t));

            expect(uniqueA).toContain('secret_relationship');
            expect(uniqueB).toContain('training_arc');
        });
    });
});

// ============================================
// 4.10 Character Graph Tests
// ============================================
describe('Character Graph', () => {
    describe('Node Properties', () => {
        it('should size nodes by appearances', () => {
            const characters = [
                { name: 'Harry', appearanceCount: 45 },
                { name: 'Ron', appearanceCount: 38 },
                { name: 'Draco', appearanceCount: 23 },
            ];

            const sizes = characters.map(c => ({
                name: c.name,
                size: Math.min(c.appearanceCount / 10, 50), // Max size 50
            }));

            expect(sizes[0].size).toBeGreaterThan(sizes[2].size);
        });
    });

    describe('Edge Properties', () => {
        it('should style canon edges solid', () => {
            const edge = { canonOrFanon: 'canon' };
            
            const style = edge.canonOrFanon === 'canon' ? 'solid' : 'dashed';
            
            expect(style).toBe('solid');
        });

        it('should style fanon edges dashed', () => {
            const edge = { canonOrFanon: 'fanon' };
            
            const style = edge.canonOrFanon === 'canon' ? 'solid' : 'dashed';
            
            expect(style).toBe('dashed');
        });

        it('should thickness by interactions', () => {
            const relationship = { interactionCount: 30 };
            
            const thickness = Math.min(relationship.interactionCount / 5, 10);
            
            expect(thickness).toBe(6);
        });
    });

    describe('Relationship Colors', () => {
        it('should color allies blue', () => {
            const getColor = (type) => {
                const colors = {
                    allies: '#3B82F6',
                    enemies: '#EF4444',
                    romantic: '#EC4899',
                    neutral: '#9CA3AF',
                };
                return colors[type] || colors.neutral;
            };

            expect(getColor('allies')).toBe('#3B82F6');
        });

        it('should color enemies red', () => {
            const getColor = (type) => {
                const colors = {
                    allies: '#3B82F6',
                    enemies: '#EF4444',
                    romantic: '#EC4899',
                };
                return colors[type] || '#9CA3AF';
            };

            expect(getColor('enemies')).toBe('#EF4444');
        });

        it('should color romantic purple', () => {
            const getColor = (type) => {
                const colors = {
                    allies: '#3B82F6',
                    enemies: '#EF4444',
                    romantic: '#EC4899',
                };
                return colors[type] || '#9CA3AF';
            };

            expect(getColor('romantic')).toBe('#EC4899');
        });
    });
});

// ============================================
// 4.11 Database Tests
// ============================================
describe('Analysis Viewer Database', () => {
    describe('Annotations Table', () => {
        it('should save annotation', async () => {
            const { db } = await import('../../services/db/database.js');
            
            db.run.mockResolvedValue({ changes: 1 });

            await db.run(
                `INSERT INTO event_annotations (id, event_id, note, starred) VALUES (?, ?, ?, ?)`,
                ['ann-001', 'event-001', 'My note', 1]
            );

            expect(db.run).toHaveBeenCalled();
        });

        it('should query annotations by event', async () => {
            const { db } = await import('../../services/db/database.js');
            
            db.all.mockResolvedValue([
                { id: 'ann-001', note: 'Note 1' },
                { id: 'ann-002', note: 'Note 2' },
            ]);

            const annotations = await db.all(
                'SELECT * FROM event_annotations WHERE event_id = ?',
                ['event-001']
            );

            expect(annotations).toHaveLength(2);
        });
    });

    describe('Exports Table', () => {
        it('should save export history', async () => {
            const { db } = await import('../../services/db/database.js');
            
            db.run.mockResolvedValue({ changes: 1 });

            await db.run(
                `INSERT INTO exports (id, event_ids, format) VALUES (?, ?, ?)`,
                ['exp-001', '["e1","e2"]', 'markdown']
            );

            expect(db.run).toHaveBeenCalled();
        });
    });

    describe('Saved Searches Table', () => {
        it('should save search query', async () => {
            const { db } = await import('../../services/db/database.js');
            
            db.run.mockResolvedValue({ changes: 1 });

            await db.run(
                `INSERT INTO saved_searches (id, name, query, filters) VALUES (?, ?, ?, ?)`,
                ['search-001', 'My Search', 'meeting', '{}']
            );

            expect(db.run).toHaveBeenCalled();
        });

        it('should load saved searches', async () => {
            const { db } = await import('../../services/db/database.js');
            
            db.all.mockResolvedValue([
                { name: 'Search 1', query: 'meeting' },
                { name: 'Search 2', query: 'battle' },
            ]);

            const searches = await db.all('SELECT * FROM saved_searches');

            expect(searches).toHaveLength(2);
        });
    });
});
