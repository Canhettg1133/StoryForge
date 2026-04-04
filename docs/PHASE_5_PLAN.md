# PHASE 5: Writing Studio Integration + Export

## Mục tiêu

Tích hợp kết quả phân tích vào writing flow và export ra định dạng đọc được.

---

## 1. File Structure

```
src/
├── pages/
│   └── Lab/
│       └── CorpusLab/
│           ├── ReferencePanel.jsx    # Corpus reference sidebar
│           └── ContinueAnalyzer.jsx  # Quick analysis panel
│
├── pages/
│   └── Studio/
│       └── WritingStudio/
│           ├── components/
│           │   ├── AISidebar.jsx        # AI query interface
│           │   ├── CorpusReference.jsx  # Reference mode
│           │   ├── ContinuityChecker.jsx # Timeline/character checker
│           │   ├── LibraryBrowser.jsx    # Browse saved events
│           │   ├── ReferenceCard.jsx    # Draggable reference card
│           │   └── ExportModal.jsx      # Export dialog
│           └── services/
│               ├── referenceEngine.js   # Query corpus
│               ├── continuityService.js  # Check consistency
│               └── exportService.js      # Export to various formats
│
├── services/
│   └── writing/
│       ├── analysisIntegrator.js     # Connect analysis to studio
│       ├── eventInserter.js         # Insert references into editor
│       └── genreAnalyzer.js         # Genre & content analysis
```

---

## 2. Reference Mode

### 2.1 Attach Corpus to Project

```
┌─────────────────────────────────────────────────────────────────┐
│  📚 Attached Corpora                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📖 HP Enemies to Lovers (Harry Potter)                   │   │
│  │    Events: 45 | Canon: 30 | Fanon: 15                    │   │
│  │    [View Analysis] [Detach]                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [+ Attach Corpus]                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Attach multiple corpora to one project
- Each corpus shows: event count, canon/fanon ratio
- Quick view analysis summary
- Detach when not needed
- Data synced to project store

### 2.2 AI Sidebar Queries

```
┌─────────────────────────────────────────────────────────────────┐
│  🤖 AI Query                                                    │
│                                                                 │
│  Context: Scene 3 - Ron and Hermione argue about Harry          │
│                                                                 │
│  Query: "Suggest events for reconciliation scene"             │
│  [Ask AI]                                                      │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  💡 Suggested Events:                                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📖 Comfort After Argument (Ch.5)                        │   │
│  │    "Hermione helps Ron with homework, tension eases"   │   │
│  │    Severity: Minor | Tags: hurt_comfort, fluff          │   │
│  │    [Insert Reference]                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📖 Shared Moment (Ch.12)                                │   │
│  │    "They laugh together for the first time"             │   │
│  │    Severity: Minor | Tags: fluff, bonding               │   │
│  │    [Insert Reference]                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Insert Both] [View Full Analysis]                            │
└─────────────────────────────────────────────────────────────────┘
```

**Query Types:**
| Query | Description | Example |
|-------|-------------|---------|
| Event suggestion | Gợi sự kiện phù hợp | "Events for reconciliation" |
| Emotional arc | Xem emotional arc của char | "Harry's emotional journey" |
| Trope search | Tìm trope cụ thể | "Find hurt/comfort scenes" |
| Character moment | Moment cụ thể cho char | "Draco's vulnerable moment" |
| Ship content | Nội dung romantic | "Intimate moments between Harry/Draco" |
| Timeline | Sự kiện theo timeline | "Events in chapter 10-15" |

**Reference Card Structure:**

```jsx
const referenceCard = {
    id: 'ref-001',
    corpusId: 'corpus-001',
    eventId: 'event-001',
    type: 'event',
    data: {
        description: 'Comfort After Argument',
        chapter: 5,
        severity: 'minor',
        tags: ['hurt_comfort', 'fluff'],
        canonOrFanon: 'canon',
        emotionalIntensity: 6,
        insertability: 8,
        excerpt: 'Hermione helped Ron with his homework...',
    },
    createdAt: Date.now(),
};
```

### 2.3 Insert Reference to Editor

```
┌─────────────────────────────────────────────────────────────────┐
│  Scene: Ron and Hermione finally make up                        │
│                                                                 │
│  Ron looked at Hermione, guilt written on his face.             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📋 INSERTED REFERENCE                                   │   │
│  │ ─────────────────────────────────────────────────────── │   │
│  │ 📖 "Comfort After Argument" (Corpus: HP Enemies)        │   │
│  │ Ch.5 | Minor | hurt_comfort, fluff                      │   │
│  │ "Hermione helped Ron with his homework, tension eases"  │   │
│  │ [Edit] [Remove] [View Original]                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  "I'm sorry," he said. Hermione smiled and forgave him.        │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Insert as blockquote with metadata
- Click to expand full context
- Edit reference notes
- Remove reference
- Link back to original corpus
- Track usage for analytics

---

## 3. Continue Mode (Quick Analysis)

### 3.1 Quick Analysis Panel

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 Quick Analysis                                              │
│                                                                 │
│  Project: My Harry/Draco Story (50,000 words)                   │
│  Last analyzed: Chapter 12                                       │
│                                                                 │
│  [Analyze New Chapters] [Full Re-analyze]                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  ⚠️ Warnings (3)                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚠️ Timeline: Harry is 15 in Ch.15 but was 16 in Ch.12 │   │
│  │    [Fix Suggestion] [Ignore]                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚠️ Character: Draco OOC in Ch.14                       │   │
│  │    He's acting friendly, but canon Draco is cold here   │   │
│  │    [View Canon Behavior] [Ignore]                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  💡 Suggestions (2)                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 💡 Emotional Arc: Dropping at Ch.14                     │   │
│  │    Consider a moment of levity before next climax      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  📊 Genre Analysis                                              │
│  Primary: Slow Burn Romance                                     │
│  Secondary: Angst, Hurt/Comfort                                 │
│  Content: Mild (suitable for teens+)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Continuity Checker

**Timeline Checker:**

```javascript
// src/pages/Studio/WritingStudio/services/continuityService.js

export function checkTimelineConsistency(chapters) {
    const issues = [];
    
    // Extract timeline markers (ages, dates, seasons)
    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        
        // Check for age inconsistencies
        const ageMarkers = extractAgeMarkers(chapter.content);
        if (ageMarkers.length > 0) {
            const expectedAge = calculateAge(chapters[0], i);
            const statedAge = ageMarkers[0].value;
            
            if (statedAge !== expectedAge) {
                issues.push({
                    type: 'timeline',
                    chapter: i,
                    severity: 'warning',
                    message: `Character age is ${statedAge} but should be ${expectedAge}`,
                    suggestion: `Change to "${expectedAge}" or add time passage note`,
                });
            }
        }
        
        // Check for season/weather consistency
        const seasonMarkers = extractSeasonMarkers(chapter.content);
        const expectedSeason = getExpectedSeason(chapters[0], i);
        
        if (seasonMarkers.length > 0 && seasonMarkers[0] !== expectedSeason) {
            issues.push({
                type: 'timeline',
                chapter: i,
                severity: 'info',
                message: `Season changed unexpectedly`,
            });
        }
    }
    
    return issues;
}
```

**Character Consistency Checker:**

```javascript
export function checkCharacterConsistency(chapters, characterProfiles) {
    const issues = [];
    
    for (const character of Object.values(characterProfiles)) {
        // Check for behavior that contradicts personality
        for (const chapter of chapters) {
            const behaviors = extractBehaviors(chapter.content, character.name);
            
            for (const behavior of behaviors) {
                const isInCharacter = checkBehaviorConsistency(
                    behavior,
                    character.personality,
                    character.arcStage
                );
                
                if (!isInCharacter.confistent) {
                    issues.push({
                        type: 'character',
                        character: character.name,
                        chapter: chapter.index,
                        severity: 'warning',
                        message: `${character.name} OOC: ${behavior.description}`,
                        canonBehavior: isInCharacter.canonBehavior,
                        suggestion: `Consider revising to show ${character.traits[0]} instead`,
                    });
                }
            }
        }
    }
    
    return issues;
}
```

### 3.3 Plot Hole Detector

```javascript
export function detectPlotHoles(chapters, analysisResults) {
    const holes = [];
    
    // 1. Check for introduced plot points that are never resolved
    const introducedPlots = new Set();
    const resolvedPlots = new Set();
    
    for (const chapter of chapters) {
        const plots = extractPlotPoints(chapter.content);
        
        for (const plot of plots) {
            if (plot.type === 'introduced') {
                introducedPlots.add(plot.id);
            }
            if (plot.type === 'resolved') {
                resolvedPlots.add(plot.id);
            }
        }
    }
    
    const unresolvedPlots = [...introducedPlots].filter(
        id => !resolvedPlots.has(id)
    );
    
    if (unresolvedPlots.length > 0) {
        holes.push({
            type: 'unresolved_plot',
            severity: 'error',
            message: `${unresolvedPlots.length} plot point(s) never resolved`,
            suggestions: unresolvedPlots.map(p => 
                `Resolve: ${p.description}`
            ),
        });
    }
    
    // 2. Check for plot holes from analysis
    if (analysisResults.relationships?.plotHoles) {
        for (const hole of analysisResults.relationships.plotHoles) {
            holes.push({
                type: 'plot_inconsistency',
                severity: hole.severity,
                message: hole.description,
                chapter: hole.chapter,
            });
        }
    }
    
    return holes;
}
```

### 3.4 Emotional Arc Suggestions

```javascript
export function suggestEmotionalArcImprovements(chapters, analysisResults) {
    const suggestions = [];
    
    // Extract emotional beats from each chapter
    const emotionalBeats = chapters.map(ch => ({
        chapter: ch.index,
        intensity: estimateEmotionalIntensity(ch.content),
    }));
    
    // Find drops in emotional arc
    for (let i = 1; i < emotionalBeats.length; i++) {
        const prev = emotionalBeats[i - 1];
        const curr = emotionalBeats[i];
        
        // Major drop after climax
        if (prev.intensity > 8 && curr.intensity < 4) {
            suggestions.push({
                type: 'emotional_drop',
                chapter: i,
                message: `Emotional drop after climax at Ch.${i-1}`,
                suggestion: `Add a moment of levity or quiet reflection before next conflict`,
            });
        }
        
        // Flat emotional arc
        if (Math.abs(curr.intensity - prev.intensity) < 2) {
            // Check if this is intentional (slow burn) or a problem
            if (analysisResults.metadata?.pacing === 'slow') {
                // This is OK for slow burn
            } else {
                suggestions.push({
                    type: 'flat_arc',
                    chapter: i,
                    message: `Flat emotional arc at Ch.${i}`,
                    suggestion: `Add tension or stakes`,
                });
            }
        }
    }
    
    // Suggest based on story structure
    const climaxPoint = findClimaxPoint(emotionalBeats);
    const midpoint = Math.floor(chapters.length / 2);
    
    if (climaxPoint < midpoint - 2) {
        suggestions.push({
            type: 'early_climax',
            message: `Climax at Ch.${climaxPoint} seems early for ${chapters.length} chapters`,
            suggestion: `Consider building more tension or adding subplot`,
        });
    }
    
    return suggestions;
}
```

### 3.5 Genre Analysis

```javascript
export function analyzeGenre(chapters) {
    const signals = {
        romance: 0,
        angst: 0,
        hurtComfort: 0,
        fluff: 0,
        action: 0,
        drama: 0,
        dark: 0,
    };
    
    const tagWeights = {
        romance: { keywords: ['love', 'kiss', 'date', 'relationship'], weight: 1 },
        angst: { keywords: ['pain', 'cry', 'suffer', 'hurt'], weight: 1 },
        hurtComfort: { keywords: ['comfort', 'heal', 'protect'], weight: 1.5 },
        fluff: { keywords: ['laugh', 'smile', 'cute', 'sweet'], weight: 1 },
        action: { keywords: ['fight', 'battle', 'chase', 'escape'], weight: 1 },
        drama: { keywords: ['argument', 'fight', 'betrayal'], weight: 1 },
        dark: { keywords: ['death', 'blood', 'torment', 'dark'], weight: 1 },
    };
    
    // Score each genre
    const allContent = chapters.map(ch => ch.content).join(' ');
    
    for (const [genre, config] of Object.entries(tagWeights)) {
        for (const keyword of config.keywords) {
            const count = (allContent.match(new RegExp(keyword, 'gi')) || []).length;
            signals[genre] += count * config.weight;
        }
    }
    
    // Determine primary and secondary genres
    const sorted = Object.entries(signals)
        .sort((a, b) => b[1] - a[1])
        .filter(([_, score]) => score > 0);
    
    return {
        primary: sorted[0]?.[0] || 'general',
        secondary: sorted[1]?.[0] || null,
        allSignals: signals,
    };
}

export function estimateContentRating(chapters) {
    const contentFlags = {
        violence: false,
        sexualContent: false,
        language: false,
        darkThemes: false,
    };
    
    const allContent = chapters.map(ch => ch.content).join(' ');
    
    // Violence indicators
    if (/gore|bloody|graphic violence/.test(allContent)) {
        contentFlags.violence = 'graphic';
    } else if (/fight|battle|killed/.test(allContent)) {
        contentFlags.violence = 'mild';
    }
    
    // Sexual content indicators
    if (/explicit|sexual content/.test(allContent)) {
        contentFlags.sexualContent = 'explicit';
    } else if (/kiss|intimate|romantic/.test(allContent)) {
        contentFlags.sexualContent = 'mild';
    }
    
    // Language indicators
    if (/fuck|shit/.test(allContent)) {
        contentFlags.language = 'moderate';
    }
    
    // Determine rating
    const rating = determineRating(contentFlags);
    
    return { rating, flags: contentFlags };
}
```

---

## 4. Library Integration

### 4.1 Browse Saved Events

```
┌─────────────────────────────────────────────────────────────────┐
│  📚 Event Library                                               │
│                                                                 │
│  Search: [________________] [Filters ▼]                          │
│                                                                 │
│  Tabs: [All] [⭐ Starred] [My Projects] [By Tag ▼]            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⭐ 📖 First Meeting (Harry Potter)                       │   │
│  │    "Harry meets Draco in Diagon Alley"                  │   │
│  │    Crucial | Canon | ⭐ starred | Used 3x              │   │
│  │    [View] [Edit] [Delete] [Drag to Editor]              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📖 Betrayal Reveal (HP Enemies)                         │   │
│  │    "Draco's true allegiance is revealed"                │   │
│  │    Major | Fanon | Used 1x                              │   │
│  │    [View] [Edit] [Delete] [Drag to Editor]              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Load More]                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Drag & Drop to Editor

**Features:**
- Drag event card from library
- Drop into editor at cursor position
- Insert as formatted blockquote
- Preserve all metadata
- Track usage count

**Drag Implementation:**

```jsx
// ReferenceCard.jsx

import { useDraggable } from '@dnd-kit/core';

export function ReferenceCard({ event, onEdit, onDelete }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: event.id,
        data: {
            type: 'reference',
            event,
        },
    });
    
    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
    } : undefined;
    
    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className="reference-card"
        >
            <div className="card-header">
                <span className="icon">📖</span>
                <span className="title">{event.description}</span>
                {event.starred && <span className="star">⭐</span>}
            </div>
            <div className="card-meta">
                <span className="severity">{event.severity}</span>
                <span className="tags">{event.tags.join(', ')}</span>
            </div>
            <div className="card-actions">
                <button onClick={onEdit}>Edit</button>
                <button onClick={onDelete}>Delete</button>
            </div>
        </div>
    );
}
```

**Drop Handler:**

```jsx
// WritingEditor.jsx

import { useDroppable } from '@dnd-kit/core';

export function WritingEditor({ content, onChange }) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'editor-drop-zone',
    });
    
    const handleDrop = (event) => {
        const reference = event.data.current?.get('reference');
        
        if (reference) {
            const blockquote = formatAsBlockquote(reference);
            insertIntoEditor(content, cursorPosition, blockquote);
        }
    };
    
    return (
        <div
            ref={setNodeRef}
            className={`writing-editor ${isOver ? 'drop-target' : ''}`}
            onDrop={handleDrop}
        >
            <EditorContent content={content} />
        </div>
    );
}
```

### 4.3 Search by Tags/Type

```javascript
export async function searchLibrary(query, filters = {}) {
    const conditions = [];
    const params = [];
    
    if (query) {
        conditions.push('(description LIKE ? OR annotation LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
    }
    
    if (filters.tag) {
        conditions.push('tags LIKE ?');
        params.push(`%${filters.tag}%`);
    }
    
    if (filters.severity) {
        conditions.push('severity = ?');
        params.push(filters.severity);
    }
    
    if (filters.canonFanon) {
        conditions.push('canon_or_fanon = ?');
        params.push(filters.canonFanon);
    }
    
    if (filters.starred) {
        conditions.push('starred = 1');
    }
    
    if (filters.minUsage) {
        conditions.push('usage_count >= ?');
        params.push(filters.minUsage);
    }
    
    const whereClause = conditions.length > 0 
        ? 'WHERE ' + conditions.join(' AND ')
        : '';
    
    const results = await db.all(
        `SELECT * FROM library_events ${whereClause} ORDER BY usage_count DESC`,
        params
    );
    
    return results;
}
```

---

## 5. Export

### 5.1 Export Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  📤 Export Project                                              │
│                                                                 │
│  Format:                                                       │
│  ○ DOCX (.docx) - Microsoft Word                               │
│  ● EPUB (.epub) - E-book                                       │
│  ○ PDF (.pdf) - Print-ready                                     │
│  ○ TXT (.txt) - Plain text                                     │
│  ○ HTML (.html) - Web view                                     │
│                                                                 │
│  Options:                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Export References: [✓] Include all citations           │   │
│  │ Chapter Breaks: [✓] Add chapter headings               │   │
│  │ Metadata: [✓] Include title, author, summary            │   │
│  │ Table of Contents: [✓] Auto-generate                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Format-Specific:                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Font: [Times New Roman ▼]                              │   │
│  │ Font Size: [12pt ▼]                                    │   │
│  │ Margins: [Normal (1") ▼]                               │   │
│  │ Line Spacing: [1.5 ▼]                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Preview:                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Chapter 1: The Beginning                                │   │
│  │                                                           │   │
│  │ Harry walked through the castle, thinking about Draco.  │   │
│  │                                                           │   │
│  │ [Reference: "First Meeting", Ch.1, HP Enemies]           │   │
│  │                                                           │   │
│  │ ...                                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                              [Cancel] [Export]                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Export Service

```javascript
// src/pages/Studio/WritingStudio/services/exportService.js

export async function exportProject(project, options = {}) {
    const { format = 'docx', ...exportOptions } = options;
    
    // Get all chapters
    const chapters = await projectStore.getChapters(project.id);
    
    // Combine with references
    const fullContent = chapters.map(ch => ({
        ...ch,
        content: insertReferences(ch.content, ch.references),
    })).join('\n\n');
    
    switch (format) {
        case 'docx':
            return exportToDocx(fullContent, exportOptions);
        case 'epub':
            return exportToEpub(project, chapters, exportOptions);
        case 'pdf':
            return exportToPdf(fullContent, exportOptions);
        case 'txt':
            return exportToTxt(fullContent, exportOptions);
        case 'html':
            return exportToHtml(project, chapters, exportOptions);
        default:
            throw new Error(`Unsupported format: ${format}`);
    }
}

async function exportToEpub(project, chapters, options) {
    const JSZip = await import('jszip');
    const zip = new JSZip();
    
    // Add mimetype (must be first and uncompressed)
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    
    // Add META-INF/container.xml
    zip.file('META-INF/container.xml', `
        <?xml version="1.0"?>
        <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
            <rootfiles>
                <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
        </container>
    `);
    
    // Add OEBPS/content.opf
    const contentOpf = generateContentOpf(project, chapters);
    zip.file('OEBPS/content.opf', contentOpf);
    
    // Add OEBPS/toc.ncx
    const tocNcx = generateTocNcx(project, chapters);
    zip.file('OEBPS/toc.ncx', tocNcx);
    
    // Add chapters
    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterHtml = generateChapterHtml(chapter, i + 1, options);
        zip.file(`OEBPS/chapter${i + 1}.xhtml`, chapterHtml);
    }
    
    // Add styles if requested
    if (options.includeStyles) {
        zip.file('OEBPS/styles.css', generateStyles(options));
    }
    
    // Generate ZIP
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    
    return blob;
}

async function exportToPdf(content, options) {
    // Use html2pdf or similar
    const html = `
        <html>
            <head>
                <style>
                    body {
                        font-family: ${options.font || 'Times New Roman'};
                        font-size: ${options.fontSize || '12pt'};
                        line-height: ${options.lineSpacing || 1.5};
                        margin: ${options.margins || '1in'};
                    }
                    h1 { text-align: center; margin-bottom: 2em; }
                    p { text-indent: 2em; margin-bottom: 1em; }
                    blockquote {
                        border-left: 3px solid #ccc;
                        padding-left: 1em;
                        color: #666;
                        font-style: italic;
                    }
                </style>
            </head>
            <body>
                ${content}
            </body>
        </html>
    `;
    
    const { default: html2pdf } = await import('html2pdf.js');
    const pdf = await html2pdf().from(html).set({
        margin: 1,
        filename: `${project.title}.pdf`,
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    }).outputPdf();
    
    return pdf;
}
```

### 5.3 Export Settings

```javascript
// Export settings defaults

const DEFAULT_SETTINGS = {
    docx: {
        font: 'Times New Roman',
        fontSize: 12,
        margins: { top: 1, right: 1, bottom: 1, left: 1 }, // inches
        lineSpacing: 1.15,
        paragraphSpacing: 6, // pt
        firstLineIndent: true, // 0.5 inch indent
    },
    
    epub: {
        fontSize: 16,
        lineSpacing: 1.5,
        includeToc: true,
        includeCover: true,
        metadata: {
            title: '',
            author: '',
            language: 'en',
            publisher: '',
            description: '',
        },
    },
    
    pdf: {
        font: 'Times New Roman',
        fontSize: 12,
        margins: 1, // inches
        lineSpacing: 1.5,
        pageSize: 'letter', // A4, letter, etc.
        orientation: 'portrait', // landscape
    },
    
    txt: {
        encoding: 'utf-8',
        lineEndings: 'unix', // unix (\n), windows (\r\n), mac (\r)
        maxLineLength: 80, // wrap at 80 chars
    },
};

export function validateExportSettings(settings, format) {
    const errors = [];
    const defaults = DEFAULT_SETTINGS[format];
    
    // Validate font exists
    if (settings.font && !isValidFont(settings.font)) {
        errors.push(`Font "${settings.font}" not available`);
    }
    
    // Validate margins
    if (settings.margins) {
        const margin = typeof settings.margins === 'number' 
            ? settings.margins 
            : settings.margins.top;
        
        if (margin < 0.5 || margin > 2) {
            errors.push('Margins must be between 0.5 and 2 inches');
        }
    }
    
    // Validate font size
    if (settings.fontSize && (settings.fontSize < 8 || settings.fontSize > 72)) {
        errors.push('Font size must be between 8 and 72 pt');
    }
    
    return {
        valid: errors.length === 0,
        errors,
    };
}
```

---

## 6. Integration Points

### 6.1 Project Store Integration

```javascript
// Connect corpus analysis to project

export function attachCorpusToProject(projectId, corpusId) {
    const project = projectStore.get(projectId);
    const corpus = corpusStore.get(corpusId);
    
    // Add corpus reference to project
    project.attachedCorpora.push({
        corpusId,
        attachedAt: Date.now(),
        autoUpdate: true, // Sync with corpus analysis updates
    });
    
    // Store reference in IndexedDB
    projectStore.save(project);
}

export function insertReference(projectId, chapterId, reference) {
    const chapter = projectStore.getChapter(chapterId);
    
    chapter.references.push({
        ...reference,
        insertedAt: Date.now(),
    });
    
    // Update reference usage count in library
    libraryStore.incrementUsage(reference.eventId);
    
    projectStore.saveChapter(chapter);
}

export function getContinuityIssues(projectId) {
    const project = projectStore.get(projectId);
    const chapters = projectStore.getChapters(projectId);
    
    // Get attached corpus analysis for comparison
    const attachedAnalyses = project.attachedCorpora.map(
        ac => corpusStore.getAnalysis(ac.corpusId)
    );
    
    return {
        timeline: checkTimelineConsistency(chapters),
        characters: checkCharacterConsistency(chapters, attachedAnalyses),
        plotHoles: detectPlotHoles(chapters, attachedAnalyses),
    };
}
```

### 6.2 UI State Management

```javascript
// src/pages/Studio/WritingStudio/stores/writingStore.js

export const writingStore = createStore({
    state: {
        project: null,
        chapters: [],
        attachedCorpora: [],
        references: [],
        continuityIssues: [],
        exportSettings: DEFAULT_SETTINGS.docx,
    },
    
    actions: {
        async loadProject(projectId) {
            this.project = await projectStore.get(projectId);
            this.chapters = await projectStore.getChapters(projectId);
            this.attachedCorpora = this.project.attachedCorpora;
        },
        
        async attachCorpus(corpusId) {
            attachCorpusToProject(this.project.id, corpusId);
            this.attachedCorpora.push(corpusId);
        },
        
        async insertReference(chapterId, reference) {
            insertReference(this.project.id, chapterId, reference);
            this.references.push(reference);
        },
        
        async runContinuityCheck() {
            this.continuityIssues = await getContinuityIssues(this.project.id);
        },
        
        async exportProject(format, options) {
            return await exportService.exportProject(this.project, {
                ...options,
                format,
            });
        },
    },
});
```

---

## 7. Database Schema Additions

```sql
-- Library events (saved from analysis)
CREATE TABLE library_events (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    corpus_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    description TEXT NOT NULL,
    chapter INTEGER,
    severity TEXT,
    rarity TEXT,
    tags TEXT,  -- JSON array
    canon_or_fanon TEXT,
    emotional_intensity INTEGER,
    insertability INTEGER,
    excerpt TEXT,
    annotation TEXT,
    custom_tags TEXT,  -- JSON array
    starred INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Attached corpora to projects
CREATE TABLE project_corpora (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    corpus_id TEXT NOT NULL,
    attached_at INTEGER DEFAULT (strftime('%s', 'now')),
    auto_update INTEGER DEFAULT 1,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (corpus_id) REFERENCES corpuses(id)
);

-- Continuity issues (for tracking)
CREATE TABLE continuity_issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chapter_id TEXT,
    type TEXT NOT NULL,  -- 'timeline', 'character', 'plot'
    severity TEXT,
    message TEXT,
    ignored INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Reference insertions (for analytics)
CREATE TABLE reference_insertions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    library_event_id TEXT NOT NULL,
    inserted_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (library_event_id) REFERENCES library_events(id)
);

-- Export history
CREATE TABLE exports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    format TEXT NOT NULL,
    options TEXT,  -- JSON
    file_path TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

---

## 8. Checklist

### Reference Mode
- [ ] Attach/detach corpus to project
- [ ] View corpus analysis summary
- [ ] AI query interface (sidebar)
- [ ] Query types: event suggestion, emotional arc, trope search
- [ ] Reference card component
- [ ] Insert reference into editor
- [ ] Format as blockquote with metadata

### Continue Mode
- [ ] Quick analysis panel
- [ ] Timeline consistency checker
- [ ] Character consistency checker (OOC detection)
- [ ] Plot hole detector
- [ ] Emotional arc suggestions
- [ ] Genre analysis (primary/secondary)
- [ ] Content rating estimation

### Library Integration
- [ ] Browse saved events
- [ ] Search by query, tags, severity, starred
- [ ] Filter tabs (All, Starred, My Projects)
- [ ] Drag & drop to editor
- [ ] Track usage count
- [ ] Edit/delete saved events

### Export
- [ ] Export modal with format selection
- [ ] Export to DOCX
- [ ] Export to EPUB
- [ ] Export to PDF
- [ ] Export to TXT
- [ ] Export to HTML
- [ ] Format-specific options (font, margins, etc.)
- [ ] Preview before export
- [ ] Include/exclude references
- [ ] Auto-generate table of contents

### Database
- [ ] library_events table
- [ ] project_corpora table
- [ ] continuity_issues table
- [ ] reference_insertions table
- [ ] exports table

### Integration
- [ ] Connect to project store
- [ ] Connect to corpus store
- [ ] State management
- [ ] Notification on analysis updates
