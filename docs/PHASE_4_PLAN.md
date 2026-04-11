# PHASE 4: Analysis Results Viewer

## Mục tiêu

Xem kết quả phân tích từ Phase 3, chọn cái nào muốn dùng cho project.

---

## 1. File Structure

```
src/
├── pages/
│   └── Lab/
│       └── CorpusLab/
│           ├── AnalysisViewer.jsx     # Main viewer page
│           ├── components/
│           │   ├── ViewToggle.jsx     # Switch views
│           │   ├── MindMapView.jsx    # Mind map visualization
│           │   ├── TimelineView.jsx   # Horizontal timeline
│           │   ├── EventListView.jsx  # Filterable list
│           │   ├── EventCard.jsx      # Individual event card
│           │   ├── SelectionPanel.jsx # Selected items panel
│           │   ├── FilterPanel.jsx    # Filters sidebar
│           │   ├── CrossFandomPanel.jsx # Browse other fandoms
│           │   ├── CompareMode.jsx     # Compare 2 corpora
│           │   ├── CharacterGraph.jsx  # Character relationship graph
│           │   ├── SearchPanel.jsx     # Advanced search
│           │   └── AnnotationEditor.jsx # Add notes to events
│           └── hooks/
│               ├── useAnalysisViewer.js
│               ├── useMindMap.js
│               ├── useCharacterGraph.js
│               └── useExport.js
│
├── services/
│   └── viewer/
│       ├── analysisParser.js        # Parse L1-L6 results
│       ├── exportService.js         # Export to various formats
│       ├── comparisonEngine.js      # Compare 2 corpora
│       └── searchEngine.js          # Advanced search
```

---

## 2. Views

### 2.1 Mind Map View

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 Mind Map View                                              │
│                                                                 │
│                        [Story Arc]                              │
│                        /    |    \                              │
│                       /     |     \                             │
│              [Event 1]  [Event 2]  [Event 3]                    │
│                 │          │          │                         │
│              [Sub 1]   [Sub 1]    [Sub 1]                      │
│                           ↓                                    │
│                        🔵 Canon                                │
│                        🟣 Fanon                                │
│                                                                 │
│  [Zoom +] [Zoom -] [Fit] [Center] [Export PNG]                │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Pan: Drag canvas
- Zoom: Mouse wheel / buttons
- Node click: Expand/collapse children
- Node drag: Reorder manually
- Double-click: Edit event details
- Right-click: Context menu (edit, delete, add note)
- Color coding:
  - 🔵 Canon (blue)
  - 🟣 Fanon (purple)
  - 🟢 Major event (green)
  - 🟠 Moderate (orange)
  - ⚪ Minor (gray)
- Connect lines: Bezier curves with arrows
- Hover: Show event preview tooltip
- Auto-layout: Dagre algorithm (horizontal tree)

**Node Rendering:**

```javascript
// Mind map node structure
const node = {
    id: 'event-1',
    label: 'First Meeting',
    type: 'event',
    data: {
        severity: 'crucial',
        chapter: 1,
        canonOrFanon: 'canon',
        rarity: 'rare',
        tags: ['angst', 'character_development'],
        emotionalIntensity: 9,
        description: 'Harry meets Draco for the first time...',
    },
    children: [
        { id: 'sub-1', label: 'Draco mocks Harry', type: 'subevent' },
        { id: 'sub-2', label: 'Ron intervenes', type: 'subevent' },
    ],
    // Visual
    x: 0, y: 0,
    color: '#3B82F6', // blue for canon
    width: 200,
    height: 80,
};
```

### 2.2 Timeline View

```
┌─────────────────────────────────────────────────────────────────┐
│  📅 Timeline View                                              │
│                                                                 │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐           │
│  │ Ch1 │ Ch2 │ Ch3 │ Ch4 │ Ch5 │ Ch6 │ Ch7 │ Ch8 │  ← Scroll │
│  ├─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┤           │
│  │ Setup│Conf │Conf │ Mid │ Mid │Clim │Clim │Res │           │
│  │   ●═══════●═══════╪═════●═════●═════●═════════●           │
│  │   │     │     │     │     │     │     │     │   │          │
│  │ Event1 Event2 Event3 Event4 Event5 Event6 Event7          │
│  │    🔵      🟣        🔵        🟢        🔵                │
│  │                                                                 │
│  │  ← Drag events to reorder                                    │
│  │  ← Click to edit                                             │
│  │  ← Right-click to add note                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Horizontal scroll with chapter markers
- Events as nodes on timeline
- Drag & drop to reorder events
- Click to select
- Double-click to edit
- Right-click context menu:
  - Edit event
  - Add annotation
  - Delete event
  - Add new event
  - Split event
  - Merge events
- Zoom: Fit all / Zoom in / Zoom out
- Filter by character presence
- Filter by POV character
- Color by: Severity / Canon-Fanon / Rarity
- Snap to chapter boundaries
- Visual arc line overlay (emotional intensity)

**Event Edit Modal:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Edit Event                                          [×]        │
│                                                                 │
│  Title: [First Meeting                              ]          │
│  Chapter: [1        ]  Position: [Start ▼]                     │
│                                                                 │
│  Severity: [Crucial ▼]  Rarity: [Rare ▼]                      │
│  Canon/Fanon: (•) Canon  ( ) Fanon                            │
│                                                                 │
│  Description:                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Harry meets Draco in Diagon Alley. Draco mocks Harry    │   │
│  │ for his second-hand robes. Ron intervenes.              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Tags: [+angst] [+hurt_comfort] [+character_development]      │
│                                                                 │
│  Characters: [Harry ✓] [Draco ✓] [Ron ✓] [Hermione ☐]        │
│                                                                 │
│  Ships: [Harry/Draco ✓]                                       │
│                                                                 │
│  Emotional Intensity: [●━━━━━━━━━] 9/10                       │
│  Insertability: [━━━●━━━━━━━] 7/10                            │
│                                                                 │
│  Annotation (your notes):                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ "This is a good template for my rival-to-lovers arc"    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                              [Cancel] [Save]                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Event List View

```
┌─────────────────────────────────────────────────────────────────┐
│  📋 Event List                              [Filters] [Search]  │
│                                                                 │
│  Severity: [All ▼]  Rarity: [All ▼]  Tags: [angst ▼]          │
│  Character: [All ▼]  Ship: [All ▼]                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ [🔵] Event: First meeting                             │   │
│  │    Severity: Crucial | Rarity: Rare | Tags: angst      │   │
│  │    Canon/Fanon: Canon | Emotional: 9/10                │   │
│  │    📝 "Good template for rival-to-lovers" ← Annotation  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☑ [🟣] Event: Betrayal reveal                           │   │
│  │    Severity: Major | Rarity: Common+Good | Tags: angst │   │
│  │    Canon/Fanon: Fanon | Emotional: 8/10                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☑ [🟢] Event: Training montage                           │   │
│  │    Severity: Minor | Rarity: Common | Tags: fluff      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 EventCard

```jsx
// src/pages/Lab/CorpusLab/components/EventCard.jsx

export function EventCard({ event, selected, onToggle }) {
    return (
        <div className={`event-card ${event.severity} ${selected ? 'selected' : ''}`}>
            <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(event.id)}
            />
            
            <div className="event-header">
                <span className={`badge ${event.canonOrFanon}`}>
                    {event.canonOrFanon.type === 'canon' ? '🔵' : '🟣'}
                    {event.canonOrFanon.type}
                </span>
                
                <span className={`severity ${event.severity}`}>
                    {event.severity}
                </span>
                
                <span className="rarity">
                    {event.rarity.score === 'rare' && '⭐ '}
                    {event.rarity.score}
                </span>
            </div>
            
            <p className="description">{event.description}</p>
            
            <div className="tags">
                {event.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                ))}
            </div>
            
            <div className="meta">
                <span>Ch. {event.chapter}</span>
                <span>Intensity: {event.emotionalIntensity}/10</span>
                <span>Insertable: {event.insertability}/10</span>
            </div>
            
            {/* Annotation preview */}
            {event.annotation && (
                <div className="annotation-preview">
                    📝 {event.annotation.substring(0, 50)}...
                </div>
            )}
            
            {/* Actions */}
            <div className="actions">
                <button onClick={() => editEvent(event)}>Edit</button>
                <button onClick={() => addAnnotation(event)}>Annotate</button>
                <button onClick={() => duplicateEvent(event)}>Duplicate</button>
            </div>
        </div>
    );
}
```

### 3.2 SelectionPanel

```jsx
// src/pages/Lab/CorpusLab/components/SelectionPanel.jsx

export function SelectionPanel({ selectedItems, onRemove, onExport }) {
    return (
        <div className="selection-panel">
            <h3>Selected ({selectedItems.length})</h3>
            
            {/* Quick select buttons */}
            <div className="quick-select">
                <button onClick={() => selectByRarity('rare')}>
                    ⭐ Select All Rare
                </button>
                <button onClick={() => selectBySeverity('crucial')}>
                    🎯 Select All Crucial
                </button>
                <button onClick={() => selectByTag('angst')}>
                    💔 Select All Angst
                </button>
                <button onClick={() => selectByFandom('canon')}>
                    🔵 Select All Canon
                </button>
                <button onClick={() => selectByFandom('fanon')}>
                    🟣 Select All Fanon
                </button>
                <button onClick={() => selectByIntensity(8)}>
                    🔥 Select High Intensity (8+)
                </button>
            </div>
            
            {/* Batch operations */}
            <div className="batch-ops">
                <button onClick={mergeSelected}>
                    🔗 Merge Selected
                </button>
                <button onClick={createGroup}>
                    📁 Create Group
                </button>
                <button onClick={assignToProject}>
                    ➕ Assign to Project
                </button>
            </div>
            
            {/* Selected list */}
            <div className="selected-list">
                {selectedItems.map(item => (
                    <div key={item.id} className="selected-item">
                        <span className="icon">
                            {item.type === 'event' ? '📖' : '👤'}
                        </span>
                        <span className="name">{item.name || item.description?.substring(0, 30)}</span>
                        <span className="meta">{item.severity}</span>
                        <button onClick={() => onRemove(item.id)}>×</button>
                    </div>
                ))}
            </div>
            
            {/* Export options */}
            <div className="export-section">
                <h4>Export</h4>
                <button onClick={() => onExport('clipboard')}>📋 Copy to Clipboard</button>
                <button onClick={() => onExport('json')}>📄 Export JSON</button>
                <button onClick={() => onExport('markdown')}>📝 Export Markdown</button>
                <button onClick={() => onExport('project')}>📁 Add to Project</button>
                <button onClick={() => onExport('library')}>📚 Save to Library</button>
            </div>
        </div>
    );
}
```

### 3.3 FilterPanel

```jsx
// src/pages/Lab/CorpusLab/components/FilterPanel.jsx

export function FilterPanel({ filters, onChange }) {
    return (
        <div className="filter-panel">
            <h4>Filters</h4>
            
            <label>
                Severity:
                <select
                    value={filters.severity}
                    onChange={e => onChange({ ...filters, severity: e.target.value })}
                >
                    <option value="all">All</option>
                    <option value="crucial">Crucial</option>
                    <option value="major">Major</option>
                    <option value="moderate">Moderate</option>
                    <option value="minor">Minor</option>
                </select>
            </label>
            
            <label>
                Rarity:
                <select
                    value={filters.rarity}
                    onChange={e => onChange({ ...filters, rarity: e.target.value })}
                >
                    <option value="all">All</option>
                    <option value="rare">⭐ Rare Only</option>
                    <option value="common_but_good">Common+Good</option>
                    <option value="common">Common</option>
                </select>
            </label>
            
            <label>
                Canon/Fanon:
                <select
                    value={filters.canonFanon}
                    onChange={e => onChange({ ...filters, canonFanon: e.target.value })}
                >
                    <option value="all">All</option>
                    <option value="canon">🔵 Canon Only</option>
                    <option value="fanon">🟣 Fanon Only</option>
                </select>
            </label>
            
            <label>
                Tags:
                <select
                    value={filters.tag}
                    onChange={e => onChange({ ...filters, tag: e.target.value })}
                >
                    <option value="all">All</option>
                    <option value="angst">💔 Angst</option>
                    <option value="hurt_comfort">🩹 Hurt/Comfort</option>
                    <option value="fluff">☁️ Fluff</option>
                    <option value="character_development">📈 Character Dev</option>
                    <option value="plot_twist">🎭 Plot Twist</option>
                    <option value="romance">💕 Romance</option>
                    <option value="action">⚔️ Action</option>
                </select>
            </label>
            
            <label>
                Character:
                <select
                    value={filters.character}
                    onChange={e => onChange({ ...filters, character: e.target.value })}
                >
                    <option value="all">All</option>
                    {characters.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </label>
            
            <label>
                Ship:
                <select
                    value={filters.ship}
                    onChange={e => onChange({ ...filters, ship: e.target.value })}
                >
                    <option value="all">All</option>
                    {ships.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </label>
            
            <label>
                Emotional Intensity:
                <input
                    type="range"
                    min="1" max="10"
                    value={filters.minIntensity}
                    onChange={e => onChange({ ...filters, minIntensity: parseInt(e.target.value) })}
                />
                <span>{filters.minIntensity}+</span>
            </label>
            
            <label>
                Has Annotation:
                <input
                    type="checkbox"
                    checked={filters.hasAnnotation}
                    onChange={e => onChange({ ...filters, hasAnnotation: e.target.checked })}
                />
            </label>
            
            <button onClick={() => onChange(defaultFilters)}>
                Reset Filters
            </button>
        </div>
    );
}
```

---

## 4. Character Graph

```
┌─────────────────────────────────────────────────────────────────┐
│  👥 Character Graph                                            │
│                                                                 │
│           Harry ──── Ron ──── Hermione                          │
│            │  ╲      │      │                                  │
│            │   ╲     │      │                                  │
│            │    ╲    │      │                                  │
│            │     ╲   │      │                                  │
│           Draco ──────┘                                        │
│              │                                                 │
│              │ Snape                                           │
│              │                                                 │
│  Legend:                                                     │
│  ─ Solid: Canon relationship                                  │
│  - - Dashed: Fanon relationship                                │
│  👥 Size: Appearance count                                     │
│  ❤️ Thickness: Interaction frequency                           │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Force-directed graph layout
- Node size: By appearance count
- Edge thickness: By interaction frequency
- Edge style: Solid = Canon, Dashed = Fanon
- Edge color: 
  - Blue: Allies
  - Red: Enemies
  - Purple: Romantic
  - Gray: Neutral
- Click node: Highlight connections
- Hover: Show relationship details
- Drag nodes to reposition
- Filter by:
  - Canon/Fanon
  - Relationship type (allies, enemies, romantic)
  - Character
- Click edge: View all interactions
- Export as PNG

**Character Graph Data Structure:**

```javascript
const characterGraph = {
    nodes: [
        { id: 'harry', name: 'Harry Potter', appearances: 45, mainPOV: true },
        { id: 'draco', name: 'Draco Malfoy', appearances: 23 },
        { id: 'ron', name: 'Ron Weasley', appearances: 38 },
        { id: 'hermione', name: 'Hermione Granger', appearances: 40 },
    ],
    edges: [
        { 
            source: 'harry', 
            target: 'draco', 
            type: 'enemies', 
            canonOrFanon: 'canon',
            interactions: 15,
            polarity: 'negative',
        },
        { 
            source: 'harry', 
            target: 'draco', 
            type: 'romantic', 
            canonOrFanon: 'fanon',
            interactions: 8,
            polarity: 'positive',
        },
    ],
};
```

---

## 5. Compare Mode

```
┌─────────────────────────────────────────────────────────────────┐
│  🔄 Compare Mode                                               │
│                                                                 │
│  Corpus A: [Harry Potter ▼]     Corpus B: [Naruto ▼]           │
│                                                                 │
│  ┌─────────────────────┬─────────────────────┐                │
│  │ Harry Potter        │ Naruto               │                │
│  ├─────────────────────┼─────────────────────┤                │
│  │ Events: 50          │ Events: 45           │                │
│  │ Canon: 30           │ Canon: 35            │                │
│  │ Fanon: 20           │ Fanon: 10            │                │
│  │ Avg Intensity: 7.2  │ Avg Intensity: 8.1   │                │
│  └─────────────────────┴─────────────────────┘                │
│                                                                 │
│  Similar Patterns:                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔵 Rival Meeting → Canon ✓ (Both)                       │   │
│  │   HP: Ch1, Naruto: Ch1                                   │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 🟣 Secret Relationship → HP only                        │   │
│  │   Naruto: Doesn't have this pattern                      │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 💕 Training Arc → Naruto only                           │   │
│  │   HP: Partially (Quidditch training)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Adapt: HP Events → Naruto]                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Side-by-side comparison
- Similarity analysis:
  - Find matching tropes
  - Find unique events per corpus
  - Find partial matches
- Statistics comparison:
  - Event count
  - Canon/Fanon ratio
  - Emotional intensity average
  - Character count
  - Ship count
- Pattern matching:
  - "Rival Meeting" in HP = "Rivals" in Naruto
  - "Secret Relationship" = "Hidden Feelings"
- AI adaptation:
  - "Adapt HP events to Naruto fandom"
  - Suggest Naruto-equivalent events
- Warnings:
  - "Event may not fit Naruto canon"
  - "Character equivalent not found"

**Comparison Algorithm:**

```javascript
// src/services/viewer/comparisonEngine.js

export async function compareCorpora(corpusA, corpusB) {
    const eventsA = parseAnalysisResults(corpusA.analysis).events;
    const eventsB = parseAnalysisResults(corpusB.analysis).events;
    
    // 1. Extract patterns
    const patternsA = extractPatterns(eventsA);
    const patternsB = extractPatterns(eventsB);
    
    // 2. Find similar patterns
    const similarities = [];
    for (const patternA of patternsA) {
        for (const patternB of patternsB) {
            const similarity = calculateSimilarity(patternA, patternB);
            if (similarity > 0.7) {
                similarities.push({
                    patternA,
                    patternB,
                    similarity,
                    corpusA: patternA.event,
                    corpusB: patternB.event,
                });
            }
        }
    }
    
    // 3. Find unique patterns
    const uniqueA = patternsA.filter(p => 
        !similarities.some(s => s.patternA === p)
    );
    const uniqueB = patternsB.filter(p => 
        !similarities.some(s => s.patternB === p)
    );
    
    // 4. Statistics
    const stats = {
        corpusA: calculateStats(eventsA),
        corpusB: calculateStats(eventsB),
    };
    
    return { similarities, uniqueA, uniqueB, stats };
}

async function adaptEvent(event, targetFandom) {
    const prompt = `
        Adapt this event from ${event.fandom} to ${targetFandom}:
        
        Event: ${event.description}
        Severity: ${event.severity}
        Tags: ${event.tags.join(', ')}
        
        Provide:
        1. Equivalent event in ${targetFandom}
        2. Warnings/cautions
        3. Adaptation notes
    `;
    
    const response = await aiService.generate(prompt);
    return parseAdaptationResponse(response);
}
```

---

## 6. Advanced Search

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 Advanced Search                                             │
│                                                                 │
│  Query: [first meeting between enemies                    ]     │
│                                                                 │
│  Filters:                                                      │
│  ┌──────────────┬──────────────┬──────────────┐               │
│  │ Chapter: 1-3 │ Intensity: 7+│ Tags: angst  │               │
│  └──────────────┴──────────────┴──────────────┘               │
│                                                                 │
│  Search in:                                                    │
│  [✓] Description  [✓] Annotation  [ ] Character names        │
│                                                                 │
│  Results: 3 found                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📖 "First meeting" (Ch.1, Intensity: 9)                  │   │
│  │    ...Harry meets Draco in Diagon Alley. Draco mocks... │   │
│  │    Match highlight: [meets] [Draco]                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📖 "Second encounter" (Ch.3, Intensity: 7)              │   │
│  │    ...Harry meets Ron on the train...                   │   │
│  │    Match highlight: [meets]                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Search All Corpuses] [Save Search] [Clear]                   │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Full-text search in:
  - Event descriptions
  - User annotations
  - Character names
  - Ship names
- Boolean operators: AND, OR, NOT
- Phrase search: "quoted phrase"
- Fuzzy matching: typo tolerance
- Filters:
  - Chapter range
  - Intensity range
  - Severity
  - Tags
  - Canon/Fanon
- Search across all corpora
- Save search queries
- Search history
- Highlight matches in results
- Export search results

**Search Engine:**

```javascript
// src/services/viewer/searchEngine.js

export function searchEvents(events, query, options = {}) {
    const {
        searchIn = ['description', 'annotation'],
        filters = {},
        fuzzy = true,
        caseSensitive = false,
    } = options;
    
    // 1. Parse query
    const parsedQuery = parseQuery(query);
    
    // 2. Filter by criteria
    let results = events.filter(event => {
        // Text search
        let textMatch = true;
        if (parsedQuery.text) {
            textMatch = searchIn.some(field => {
                const text = event[field] || '';
                return matchText(text, parsedQuery.text, { fuzzy, caseSensitive });
            });
        }
        
        // Filters
        if (filters.severity && event.severity !== filters.severity) return false;
        if (filters.minIntensity && event.emotionalIntensity < filters.minIntensity) return false;
        if (filters.chapter && !isInChapterRange(event.chapter, filters.chapter)) return false;
        if (filters.canonFanon && event.canonOrFanon.type !== filters.canonFanon) return false;
        
        return textMatch;
    });
    
    // 3. Score and sort by relevance
    results = results.map(event => ({
        ...event,
        relevance: calculateRelevance(event, parsedQuery),
        highlights: getHighlights(event, parsedQuery, searchIn),
    }));
    
    results.sort((a, b) => b.relevance - a.relevance);
    
    return results;
}

function parseQuery(query) {
    // Handle boolean operators
    const andTerms = query.split(/\s+AND\s+/i);
    const orTerms = [];
    const notTerms = [];
    
    let text = query;
    
    // Extract quoted phrases
    const quoted = query.match(/"([^"]+)"/g) || [];
    quoted.forEach(phrase => {
        text = text.replace(phrase, '');
    });
    
    // Remaining terms
    const terms = text.split(/\s+/).filter(t => t.length > 0);
    
    return { quoted, terms, andTerms, orTerms, notTerms };
}
```

---

## 7. Annotation System

```
┌─────────────────────────────────────────────────────────────────┐
│  📝 Annotations                                                │
│                                                                 │
│  Each event can have:                                          │
│  - Personal notes                                              │
│  - Custom tags                                                 │
│  - Star/favorite                                               │
│  - Usage tracking                                              │
│                                                                 │
│  Annotation Data Model:                                        │
│                                                                 │
│  {                                                            │
│    id: "annotation-uuid",                                      │
│    eventId: "event-uuid",                                      │
│    note: "This is a good template for my rival-to-lovers arc", │
│    customTags: ["template", "favorite"],                       │
│    starred: true,                                              │
│    usageCount: 3,                                              │
│    lastUsed: 1704067200000,                                   │
│    linkedProjectIds: ["proj-1", "proj-2"],                    │
│    createdAt: 1704067200000,                                  │
│    updatedAt: 1704067200000,                                  │
│  }                                                            │
│                                                                 │
│  Annotation Views:                                             │
│  - Inline: Show annotation preview in event card               │
│  - Expanded: Click to expand full annotation                  │
│  - Panel: Dedicated annotation panel on sidebar               │
│  - Edit Modal: Full annotation editor                         │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Add/edit annotations on any event
- Custom tags (user-defined)
- Star/favorite events
- Track usage count
- Link to multiple projects
- Annotation templates:
  - "Template for [arc type]"
  - "Inspiration for [character]"
  - "Avoid for [reason]"
- Annotation categories:
  - Personal notes
  - Usage notes
  - Adaptation notes
  - Warning/caution notes
- Batch annotate: Select multiple → add same annotation
- Search within annotations
- Filter events by annotation presence

**Annotation Editor:**

```jsx
// src/pages/Lab/CorpusLab/components/AnnotationEditor.jsx

export function AnnotationEditor({ event, onSave, onCancel }) {
    const [annotation, setAnnotation] = useState(event.annotation || {
        note: '',
        customTags: [],
        starred: false,
    });
    
    const templates = [
        { label: 'Template for arc...', value: 'Template for ' },
        { label: 'Inspiration for...', value: 'Inspiration for ' },
        { label: 'Avoid because...', value: 'Avoid because ' },
        { label: 'Similar to...', value: 'Similar to ' },
    ];
    
    return (
        <div className="annotation-editor">
            <h3>Annotate: {event.description}</h3>
            
            {/* Quick templates */}
            <div className="templates">
                {templates.map(t => (
                    <button
                        key={t.label}
                        onClick={() => setAnnotation({
                            ...annotation,
                            note: annotation.note + t.value,
                        })}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            
            {/* Note */}
            <textarea
                value={annotation.note}
                onChange={e => setAnnotation({ ...annotation, note: e.target.value })}
                placeholder="Add your notes here..."
                rows={6}
            />
            
            {/* Custom tags */}
            <div className="custom-tags">
                <label>Custom Tags:</label>
                <input
                    type="text"
                    placeholder="Add tag..."
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            addTag(e.target.value);
                            e.target.value = '';
                        }
                    }}
                />
                <div className="tags">
                    {annotation.customTags.map(tag => (
                        <span key={tag} className="tag">
                            {tag}
                            <button onClick={() => removeTag(tag)}>×</button>
                        </span>
                    ))}
                </div>
            </div>
            
            {/* Star */}
            <label className="star-toggle">
                <input
                    type="checkbox"
                    checked={annotation.starred}
                    onChange={e => setAnnotation({ ...annotation, starred: e.target.checked })}
                />
                ⭐ Star this event
            </label>
            
            {/* Link to project */}
            <label>
                Link to Project:
                <select
                    multiple
                    value={annotation.linkedProjectIds}
                    onChange={e => setAnnotation({
                        ...annotation,
                        linkedProjectIds: Array.from(e.target.selectedOptions).map(o => o.value),
                    })}
                >
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                </select>
            </label>
            
            {/* Actions */}
            <div className="actions">
                <button onClick={onCancel}>Cancel</button>
                <button onClick={() => onSave(annotation)}>Save</button>
                <button onClick={() => copyToClipboard(event)}>
                    📋 Copy to Clipboard
                </button>
            </div>
        </div>
    );
}
```

---

## 8. Export Formats

### 8.1 Export Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  📤 Export Selected Events                                     │
│                                                                 │
│  Format:                                                       │
│  ○ JSON (for backup/import)                                    │
│  ● Markdown (for notes/docs)                                   │
│  ○ Plain Text (simple list)                                    │
│  ○ CSV (for spreadsheets)                                      │
│                                                                 │
│  Options:                                                      │
│  [✓] Include annotations                                       │
│  [✓] Include character info                                    │
│  [✓] Include chapter references                                │
│  [ ] Include full descriptions                                 │
│  [ ] Include emotional intensity                               │
│                                                                 │
│  Preview:                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ## Event: First Meeting                                 │   │
│  │ **Severity:** Crucial                                   │   │
│  │ **Chapter:** 1                                          │   │
│  │ **Canon:** ✅ Canon                                     │   │
│  │ **Tags:** angst, character_development                  │   │
│  │                                                         │   │
│  │ Harry meets Draco in Diagon Alley. Draco mocks Harry... │   │
│  │                                                         │   │
│  │ 📝 *This is a good template for rival-to-lovers arc*   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Cancel]  [Copy to Clipboard]  [Download File]                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Export Service

```javascript
// src/services/viewer/exportService.js

export async function exportEvents(selectedEvents, options = {}) {
    const { format = 'markdown', includeAnnotations = true, ...rest } = options;
    
    switch (format) {
        case 'json':
            return exportAsJSON(selectedEvents, rest);
        case 'markdown':
            return exportAsMarkdown(selectedEvents, { includeAnnotations, ...rest });
        case 'csv':
            return exportAsCSV(selectedEvents, rest);
        case 'clipboard':
            return copyToClipboard(selectedEvents, rest);
        default:
            throw new Error(`Unknown format: ${format}`);
    }
}

function exportAsMarkdown(events, options) {
    let md = `# Exported Events\n\n`;
    md += `Generated: ${new Date().toLocaleString()}\n\n`;
    md += `Total: ${events.length} events\n\n---\n\n`;
    
    for (const event of events) {
        md += `## ${event.description}\n\n`;
        md += `| Field | Value |\n`;
        md += `|-------|-------|\n`;
        md += `| Severity | ${event.severity} |\n`;
        md += `| Chapter | ${event.chapter} |\n`;
        md += `| Canon/Fanon | ${event.canonOrFanon.type} |\n`;
        md += `| Rarity | ${event.rarity.score} |\n`;
        md += `| Tags | ${event.tags.join(', ')} |\n`;
        
        if (options.includeIntensity) {
            md += `| Intensity | ${event.emotionalIntensity}/10 |\n`;
        }
        
        md += `\n`;
        
        if (options.includeAnnotations && event.annotation?.note) {
            md += `> 📝 *${event.annotation.note}*\n\n`;
        }
        
        md += `---\n\n`;
    }
    
    return md;
}

function exportAsJSON(events, options) {
    return JSON.stringify({
        version: '1.0',
        exportedAt: Date.now(),
        count: events.length,
        events: events.map(e => ({
            id: e.id,
            description: e.description,
            severity: e.severity,
            chapter: e.chapter,
            canonOrFanon: e.canonOrFanon,
            rarity: e.rarity,
            tags: e.tags,
            emotionalIntensity: e.emotionalIntensity,
            insertability: e.insertability,
            annotation: options.includeAnnotations ? e.annotation : undefined,
            characters: e.characters,
            ships: e.ships,
        })),
    }, null, 2);
}
```

---

## 9. Cross-Fandom Reference

```jsx
// src/pages/Lab/CorpusLab/components/CrossFandomPanel.jsx

export function CrossFandomPanel({ currentFandom, onAdapt }) {
    const [otherCorpora, setOtherCorpora] = useState([]);
    
    useEffect(() => {
        loadOtherFandomCorpora(currentFandom);
    }, [currentFandom]);
    
    return (
        <div className="cross-fandom-panel">
            <h4>Browse Other Fandoms</h4>
            
            {/* Fandom tabs */}
            <div className="fandom-tabs">
                {FANDOMS.filter(f => f !== currentFandom).map(fandom => (
                    <button
                        key={fandom}
                        className={selectedFandom === fandom ? 'active' : ''}
                        onClick={() => setSelectedFandom(fandom)}
                    >
                        {fandom}
                    </button>
                ))}
            </div>
            
            {/* Corpus list for selected fandom */}
            <div className="corpus-list">
                {corporaForFandom.map(corpus => (
                    <div key={corpus.id} className="corpus-item">
                        <span>{corpus.title}</span>
                        <button onClick={() => loadAnalysis(corpus.id)}>
                            View
                        </button>
                    </div>
                ))}
            </div>
            
            {/* Adapt section */}
            <div className="adapt-section">
                <h4>Adapt Event</h4>
                <textarea
                    placeholder="Describe your story situation..."
                />
                
                <div className="adapt-options">
                    <label>Target Fandom:</label>
                    <select>
                        {FANDOMS.map(f => (
                            <option key={f} value={f}>{f}</option>
                        ))}
                    </select>
                </div>
                
                <button onClick={onAdapt}>
                    🤖 AI Suggest Equivalent
                </button>
                
                {adaptationResult && (
                    <div className="adaptation-result">
                        <h5>Suggested Equivalent:</h5>
                        <p>{adaptationResult.event}</p>
                        <div className="cautions">
                            <h6>⚠️ Cautions:</h6>
                            <ul>
                                {adaptationResult.cautions.map(c => (
                                    <li key={c}>{c}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
```

---

## 10. Analysis Parser

```javascript
// src/services/viewer/analysisParser.js

/**
 * Parse L1-L6 results từ Phase 3
 */

export function parseAnalysisResults(rawResults) {
    return {
        // L1: Structural
        characters: rawResults.structural?.characters || [],
        ships: rawResults.structural?.ships || [],
        tropes: rawResults.structural?.tropes || [],
        metadata: rawResults.structural?.metadata || {},
        
        // L2: Events
        events: {
            major: rawResults.events?.majorEvents || [],
            minor: rawResults.events?.minorEvents || [],
            twists: rawResults.events?.plotTwists || [],
            cliffhangers: rawResults.events?.cliffhangers || [],
        },
        
        // L3: World-building
        worldbuilding: rawResults.worldbuilding || {},
        
        // L4: Characters
        characterProfiles: rawResults.characters || {},
        
        // L5: Relationships
        relationships: rawResults.relationships || {},
        
        // L6: Craft
        craft: rawResults.craft || {},
        
        // Summary
        summary: rawResults.summary || {},
    };
}

/**
 * Flatten events for list view
 */
export function flattenEvents(eventsData) {
    const all = [
        ...eventsData.major.map(e => ({ ...e, _type: 'major' })),
        ...eventsData.minor.map(e => ({ ...e, _type: 'minor' })),
        ...eventsData.twists.map(e => ({ ...e, _type: 'twist' })),
        ...eventsData.cliffhangers.map(e => ({ ...e, _type: 'cliffhanger' })),
    ];
    
    return all.sort((a, b) => {
        // Sort by severity first
        const severityOrder = { crucial: 0, major: 1, moderate: 2, minor: 3 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        }
        // Then by chapter
        return parseInt(a.chapter) - parseInt(b.chapter);
    });
}

/**
 * Build mind map tree structure
 */
export function buildMindMap(events) {
    const root = { id: 'root', label: 'Story Arc', children: [] };
    
    // Group by severity
    const bySeverity = {
        crucial: [],
        major: [],
        moderate: [],
        minor: [],
    };
    
    events.forEach(event => {
        bySeverity[event.severity]?.push(event);
    });
    
    // Build tree
    Object.entries(bySeverity).forEach(([severity, items]) => {
        const node = {
            id: severity,
            label: severity,
            children: items.map(item => ({
                id: item.id,
                label: item.description.substring(0, 50),
                data: item,
            })),
        };
        root.children.push(node);
    });
    
    return root;
}

/**
 * Build character graph data
 */
export function buildCharacterGraph(characterProfiles, relationships) {
    const nodes = characterProfiles.map(c => ({
        id: c.id,
        name: c.name,
        appearances: c.appearanceCount || 0,
        mainPOV: c.isPOV || false,
    }));
    
    const edges = relationships.map(r => ({
        source: r.character1Id,
        target: r.character2Id,
        type: r.type, // 'allies', 'enemies', 'romantic'
        canonOrFanon: r.canonOrFanon,
        interactions: r.interactionCount || 0,
        polarity: r.polarity, // 'positive', 'negative'
    }));
    
    return { nodes, edges };
}
```

---

## 11. Integration

```jsx
// src/pages/Lab/CorpusLab/AnalysisViewer.jsx

export function AnalysisViewer({ corpusId }) {
    const [analysis, setAnalysis] = useState(null);
    const [view, setView] = useState('list'); // 'mindmap' | 'timeline' | 'list' | 'graph' | 'compare'
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [filters, setFilters] = useState(defaultFilters);
    const [searchQuery, setSearchQuery] = useState('');
    const [compareCorpusId, setCompareCorpusId] = useState(null);
    
    // Load analysis
    useEffect(() => {
        loadAnalysis(corpusId);
    }, [corpusId]);
    
    // Parse results
    const parsed = useMemo(() => {
        if (!analysis?.results) return null;
        return parseAnalysisResults(analysis.results);
    }, [analysis]);
    
    // Search results
    const searchResults = useMemo(() => {
        if (!searchQuery || !parsed?.events) return null;
        return searchEvents(flattenEvents(parsed.events), searchQuery, {
            searchIn: ['description', 'annotation'],
            filters,
        });
    }, [searchQuery, parsed, filters]);
    
    // Filter + search events
    const displayEvents = useMemo(() => {
        if (searchResults) return searchResults;
        
        const allEvents = flattenEvents(parsed?.events || []);
        return allEvents.filter(event => {
            if (filters.severity !== 'all' && event.severity !== filters.severity) return false;
            if (filters.rarity !== 'all' && event.rarity.score !== filters.rarity) return false;
            if (filters.canonFanon !== 'all' && event.canonOrFanon.type !== filters.canonFanon) return false;
            if (filters.tag !== 'all' && !event.tags.includes(filters.tag)) return false;
            if (filters.character && !event.characters?.includes(filters.character)) return false;
            if (filters.ship && !event.ships?.includes(filters.ship)) return false;
            if (filters.minIntensity && event.emotionalIntensity < filters.minIntensity) return false;
            if (filters.hasAnnotation && !event.annotation) return false;
            return true;
        });
    }, [parsed, filters, searchResults]);
    
    // Character graph data
    const characterGraph = useMemo(() => {
        if (!parsed) return null;
        return buildCharacterGraph(
            parsed.characters,
            parsed.relationships
        );
    }, [parsed]);
    
    return (
        <div className="analysis-viewer">
            <header>
                <h2>{corpus.title} - Analysis Results</h2>
                <ViewToggle view={view} onChange={setView} />
            </header>
            
            <main className={view}>
                <FilterPanel filters={filters} onChange={setFilters} />
                
                <SearchPanel
                    query={searchQuery}
                    onSearch={setSearchQuery}
                    resultsCount={searchResults?.length}
                />
                
                <div className="view-content">
                    {view === 'mindmap' && (
                        <MindMapView data={buildMindMap(displayEvents)} />
                    )}
                    {view === 'timeline' && (
                        <TimelineView 
                            events={displayEvents}
                            onEdit={handleEditEvent}
                            onAddAnnotation={handleAddAnnotation}
                        />
                    )}
                    {view === 'list' && (
                        <EventListView
                            events={displayEvents}
                            selectedIds={selectedIds}
                            onToggle={toggleSelection}
                        />
                    )}
                    {view === 'graph' && (
                        <CharacterGraph
                            data={characterGraph}
                            onNodeClick={handleCharacterClick}
                        />
                    )}
                    {view === 'compare' && (
                        <CompareMode
                            corpusA={corpus}
                            corpusB={compareCorpusId}
                            onSelectCorpusB={setCompareCorpusId}
                        />
                    )}
                </div>
                
                <SelectionPanel
                    selectedItems={displayEvents.filter(e => selectedIds.has(e.id))}
                    onRemove={id => setSelectedIds(prev => {
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                    })}
                    onExport={handleExport}
                />
            </main>
            
            {/* Modals */}
            {editingEvent && (
                <EventEditModal
                    event={editingEvent}
                    onSave={handleSaveEvent}
                    onClose={() => setEditingEvent(null)}
                />
            )}
            
            {annotatingEvent && (
                <AnnotationEditor
                    event={annotatingEvent}
                    onSave={handleSaveAnnotation}
                    onCancel={() => setAnnotatingEvent(null)}
                />
            )}
            
            {exportModalOpen && (
                <ExportModal
                    selectedItems={displayEvents.filter(e => selectedIds.has(e.id))}
                    onClose={() => setExportModalOpen(false)}
                />
            )}
        </div>
    );
}
```

---

## 12. Database Schema

```sql
-- annotations table
CREATE TABLE event_annotations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    corpus_id TEXT NOT NULL,
    note TEXT,
    custom_tags TEXT,  -- JSON array
    starred INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    last_used_at INTEGER,
    linked_project_ids TEXT,  -- JSON array
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id)
);

-- Export history
CREATE TABLE exports (
    id TEXT PRIMARY KEY,
    corpus_id TEXT,
    event_ids TEXT NOT NULL,  -- JSON array
    format TEXT NOT NULL,
    options TEXT,  -- JSON
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id)
);

-- Saved searches
CREATE TABLE saved_searches (
    id TEXT PRIMARY KEY,
    name TEXT,
    query TEXT,
    filters TEXT,  -- JSON
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

---

## 13. Checklist

### Core Features
- [ ] AnalysisViewer main component
- [ ] ViewToggle (MindMap / Timeline / List / Graph / Compare)
- [ ] EventCard component
- [ ] FilterPanel with all filters
- [ ] SelectionPanel with quick-select
- [ ] SearchPanel with advanced search
- [ ] analysisParser utilities

### Views
- [ ] MindMapView (expandable tree, zoom, pan, drag)
- [ ] TimelineView (horizontal scroll, drag & drop, edit)
- [ ] EventListView (filterable list)
- [ ] CharacterGraphView (force-directed graph)
- [ ] CompareMode (side-by-side comparison)

### Editing & Annotation
- [ ] Event edit modal
- [ ] Annotation editor
- [ ] Custom tags system
- [ ] Star/favorite system
- [ ] Usage tracking

### Export
- [ ] Export modal
- [ ] Export as JSON
- [ ] Export as Markdown
- [ ] Export as CSV
- [ ] Copy to clipboard
- [ ] Add to project

### Search
- [ ] Full-text search
- [ ] Boolean operators (AND, OR, NOT)
- [ ] Phrase search
- [ ] Fuzzy matching
- [ ] Filter by annotation
- [ ] Save searches
- [ ] Search history

### Compare Mode
- [ ] Select corpus A and B
- [ ] Statistics comparison
- [ ] Pattern matching
- [ ] Similarity analysis
- [ ] AI adaptation suggestions

### Character Graph
- [ ] Force-directed layout
- [ ] Node size by appearances
- [ ] Edge thickness by interactions
- [ ] Edge style (solid/dashed) by canon/fanon
- [ ] Filter by relationship type
- [ ] Click to highlight connections
- [ ] Export as PNG

### Integration
- [ ] Load analysis from corpus
- [ ] Parse L1-L6 JSON
- [ ] Filter, search, select
- [ ] Edit events
- [ ] Add annotations
- [ ] Export to various formats
- [ ] Link to projects

### Database
- [ ] event_annotations table
- [ ] exports table
- [ ] saved_searches table
- [ ] API endpoints for CRUD
