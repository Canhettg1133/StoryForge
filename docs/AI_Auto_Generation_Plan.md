# Kế Hoạch Triển Khai: AI Auto Generation (Tạo Chương Tự Động)

> **Mục đích file này:** Được viết chi tiết để BẤT KỲ AI model nào (Claude, GPT, Gemini, hay developer) đều có thể đọc hiểu và triển khai code mà không cần hỏi thêm ngữ cảnh.
>
> **Tài liệu ý tưởng gốc:** `docs/AI_Auto_Generation_Idea.md`

---

## Tổng Quan Dự Án Hiện Tại (Context cho AI)

### Tech Stack
- **Framework:** React 19 + Vite 6
- **State Management:** Zustand 5
- **Database:** Dexie 4 (IndexedDB wrapper) — lưu trữ hoàn toàn local trên trình duyệt
- **Editor:** Tiptap
- **UI Icons:** Lucide React
- **Routing:** React Router DOM 7

### Cấu Trúc Thư Mục Quan Trọng
```
e:\StoryForge\src\
├── services\
│   ├── ai\
│   │   ├── client.js          # Gọi API AI (streaming), hàm chính: streamChat()
│   │   ├── contextEngine.js   # Thu thập ngữ cảnh từ Codex, hàm chính: gatherContext()
│   │   ├── promptBuilder.js   # Xây dựng prompt 8 lớp, hàm chính: buildPrompt()
│   │   ├── router.js          # Chọn model AI theo task, class: ModelRouter, enum: TASK_TYPES
│   │   └── keyManager.js      # Quản lý API keys
│   └── db\
│       └── database.js        # Dexie schema (hiện tại version 5, 20+ bảng)
├── stores\
│   ├── projectStore.js        # State: projects, chapters, scenes. CRUD cho Project/Chapter/Scene
│   ├── aiStore.js             # State: AI tasks (streaming, output). Actions: runTask(), continueWriting(), brainstorm(), etc.
│   ├── codexStore.js          # State: characters, locations, objects, worldTerms, taboos, canonFacts, chapterMeta
│   ├── plotStore.js           # State: plotThreads, threadBeats. CRUD cho Plot Thread / Beats
│   ├── suggestionStore.js     # Suggestion inbox
│   ├── timelineStore.js       # Timeline events
│   └── uiStore.js             # UI state (sidebar, modals)
├── pages\
│   ├── Dashboard\             # Trang chủ: danh sách dự án + tạo mới
│   │   ├── Dashboard.jsx
│   │   ├── NewProjectModal.jsx
│   │   └── ProjectWizard.jsx  # Wizard tạo dự án bằng AI
│   ├── OutlineBoard\          # Bảng dàn ý: quản lý chapters + scenes
│   │   ├── OutlineBoard.jsx
│   │   ├── ChapterDetailModal.jsx
│   │   └── PlotThreadModal.jsx
│   └── SceneEditor\           # Trình soạn thảo văn bản
└── components\
    ├── ai\                    # AI Sidebar, suggestion panels
    ├── common\                # Layout, navigation
    └── editor\                # TipTap editor components
```

### Cấu Trúc Dữ Liệu Hiện Tại (Dexie Tables — quan trọng)
```javascript
// Trong file: src/services/db/database.js (version 5 hiện tại)
projects:       '++id, title, genre_primary, status, created_at, updated_at'
chapters:       '++id, project_id, arc_id, order_index, title, status'
scenes:         '++id, project_id, chapter_id, order_index, title, pov_character_id, status'
characters:     '++id, project_id, name, role'
canonFacts:     '++id, project_id, fact_type, subject_type, subject_id, status'
plotThreads:    '++id, project_id, title, type, state'
threadBeats:    '++id, plot_thread_id, scene_id, beat_type'
taboos:         '++id, project_id, character_id, effective_before_chapter'
chapterMeta:    '++id, chapter_id, project_id'
```

### Project Object — Các field hiện có (trong createProject của projectStore.js)
```javascript
{
  title, description, genre_primary, genre_secondary, tone, audience, status,
  writing_mode, default_style_pack_id,
  world_name, world_type, world_scale, world_era, world_rules, world_description,
  ai_guidelines, ai_strictness,
  pov_mode, synopsis, story_structure, pronoun_style,
  created_at, updated_at
}
```

### TASK_TYPES Hiện Có (trong router.js)
```javascript
BRAINSTORM, OUTLINE, SCENE_DRAFT, CONTINUE, EXPAND, REWRITE, SUMMARIZE,
CONTINUITY_CHECK, EXTRACT_TERMS, PLOT_SUGGEST, STYLE_ANALYZE, STYLE_WRITE,
QA_CHECK, CHECK_CONFLICT, FREE_PROMPT, CHAPTER_SUMMARY, FEEDBACK_EXTRACT,
AI_GENERATE_ENTITY, PROJECT_WIZARD, SUGGEST_UPDATES
```

---

## Phân Chia Giai Đoạn Triển Khai

Tính năng được chia thành **4 Phase** nhỏ, mỗi Phase có thể deploy độc lập.

---

## PHASE 1: Mở Rộng Project Settings (Nền Tảng)

### Mục tiêu
Bổ sung 3 trường mới vào Project để hệ thống biết truyện dài bao nhiêu, mục tiêu cuối cùng là gì, và các cột mốc lớn.

### 1.1. Cập nhật Database Schema

**File:** `src/services/db/database.js`

**Hành động:** Thêm `db.version(6)` SAU block `db.version(5)` hiện tại (dòng 159).

```javascript
// Phase 5 — AI Auto Generation: new project fields
db.version(6).stores({
  // Copy TOÀN BỘ bảng từ version 5 (giữ nguyên, không thay đổi indexes)
  // ... (copy y hệt tất cả các dòng stores từ version 5)
}).upgrade(tx => {
  return tx.table('projects').toCollection().modify(project => {
    if (!project.target_length) project.target_length = 0;       // 0 = chưa xác định
    if (!project.target_length_type) project.target_length_type = 'unset'; // unset | short | medium | long | epic
    if (!project.ultimate_goal) project.ultimate_goal = '';      // Mục tiêu cuối cùng
    if (!project.milestones) project.milestones = '[]';          // JSON string: [{percent: 25, description: "..."}]
  });
});
```

**Giải thích:** Dexie không cần thêm index cho các field mới nếu không query theo chúng. Chỉ cần `upgrade()` để migrate dữ liệu cũ.

### 1.2. Cập nhật projectStore — createProject()

**File:** `src/stores/projectStore.js`

**Hành động:** Trong hàm `createProject(data)` (dòng 20-91), thêm 3 field mới vào object truyền cho `db.projects.add()`:

```javascript
// Thêm SAU dòng `pronoun_style: data.pronoun_style || '',` (khoảng dòng 46)

// Phase 5 — AI Auto Generation: Pacing Control
target_length: data.target_length || 0,
target_length_type: data.target_length_type || 'unset',
ultimate_goal: data.ultimate_goal || '',
milestones: data.milestones || '[]',
```

### 1.3. Cập nhật UI — Thêm Fields Vào Form Tạo/Sửa Project

**File cần sửa:** `src/pages/Dashboard/ProjectWizard.jsx` hoặc `src/pages/Settings/Settings.jsx`

**Hành động:** Thêm 3 input fields vào form:

1. **Dropdown "Độ dài dự kiến" (target_length_type)**
   - Options: `Chưa xác định` | `Truyện ngắn (30-50 chương)` | `Truyện vừa (100-200 chương)` | `Trường thiên (300-500 chương)` | `Sử thi (500+ chương)`
   - Khi chọn option, tự động fill giá trị `target_length` tương ứng (50, 150, 400, 800).

2. **Textarea "Đích đến tối thượng" (ultimate_goal)**
   - Placeholder: "VD: Main đạt cảnh giới Thần Tôn và thống nhất thiên hạ"

3. **Dynamic List "Cột mốc lớn" (milestones)**
   - Mỗi milestone gồm: `percent` (number 1-100) + `description` (text)
   - Nút (+) thêm milestone, nút (x) xóa milestone
   - Lưu dưới dạng JSON string: `'[{"percent":25,"description":"Main đạt Trúc Cơ"}]'`

### 1.4. Nhúng Thông Tin Pacing Vào Prompt

**File:** `src/services/ai/promptBuilder.js`

**Hành động:** Trong hàm `buildPrompt()` (dòng 144), thêm xử lý context mới. Cần thêm các tham số vào destructuring (dòng 145-172):

```javascript
// Thêm vào destructuring context:
targetLength = 0,
targetLengthType = 'unset',
ultimateGoal = '',
milestones = [],
currentChapterIndex = 0,
```

**Hành động:** Thêm một Layer mới (Layer 4.5 — Pacing Control) VÀO SAU phần Canon Context (khoảng dòng 290):

```javascript
// -- Layer 4.5: Pacing Control (AI Auto Generation) --
if (targetLength > 0 && ultimateGoal) {
  const progressPercent = Math.round((currentChapterIndex / targetLength) * 100);
  const pacingParts = [];
  pacingParts.push(`Truyen nay du kien dai ${targetLength} chuong. Hien tai dang o chuong ${currentChapterIndex + 1} (${progressPercent}% tien do).`);
  pacingParts.push(`Muc tieu cuoi cung cua toan bo truyen: "${ultimateGoal}".`);
  pacingParts.push(`TUYET DOI KHONG de nhan vat dat duoc muc tieu nay trong dot sinh nay.`);

  // Tìm milestone tiếp theo
  if (milestones.length > 0) {
    const nextMilestone = milestones.find(m => m.percent > progressPercent);
    if (nextMilestone) {
      pacingParts.push(`Cot moc ke tiep o ${nextMilestone.percent}%: "${nextMilestone.description}". Chua duoc phep vuot qua cot moc nay trong dot sinh nay.`);
    }
  }

  systemParts.push('\n[KIEM SOAT TIEN DO TRUYEN]\n' + pacingParts.join('\n'));
}
```

**File:** `src/services/ai/contextEngine.js`

**Hành động:** Trong hàm `gatherContext()`, cần bổ sung các field mới vào object trả về. Đọc thêm field từ project:

```javascript
// Thêm vào return object:
targetLength: project.target_length || 0,
targetLengthType: project.target_length_type || 'unset',
ultimateGoal: project.ultimate_goal || '',
milestones: JSON.parse(project.milestones || '[]'),
currentChapterIndex: chapterIndex,
```

---

## PHASE 2: Arc-Based Outline Generation (Sinh Dàn Ý Theo Quyển)

### Mục tiêu
Cho phép tác giả yêu cầu AI tạo dàn ý N chương thuộc về một Story Arc cụ thể.

### 2.1. Tạo TASK_TYPE Mới

**File:** `src/services/ai/router.js`

**Hành động:** Thêm 2 TASK_TYPE mới vào object `TASK_TYPES` (sau dòng 60):

```javascript
// Phase 5 — AI Auto Generation
ARC_OUTLINE: 'arc_outline',           // Sinh dàn ý N chương
ARC_CHAPTER_DRAFT: 'arc_chapter_draft', // Đắp thịt 1 chương từ dàn ý
```

**Hành động:** Thêm routing cho 2 task mới vào `PROXY_TASK_MAP` (sau dòng 146):

```javascript
arc_outline: {
  fast: 'gemini-2.5-flash-真流-[星星公益站-CLI渠道]',
  balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  best: 'gemini-3-pro-high-真流-[星星公益站-CLI渠道]',
},
arc_chapter_draft: {
  fast: 'gemini-3-flash-high-真流-[星星公益站-CLI渠道]',
  balanced: 'gemini-2.5-pro-真流-[星星公益站-CLI渠道]',
  best: 'gemini-3-pro-high-真流-[星星公益站-CLI渠道]',
},
```

### 2.2. Thêm Prompt Instructions

**File:** `src/services/ai/promptBuilder.js`

**Hành động:** Thêm 2 entry mới vào object `TASK_INSTRUCTIONS` (sau dòng 117):

```javascript
[TASK_TYPES.ARC_OUTLINE]: [
  'Tao dan y chi tiet cho mot dot chuong moi (Story Arc).',
  'Dua tren muc tieu cua Arc, tom tat chuong truoc, va cac tuyen truyen dang mo,',
  'tao ra danh sach cac chuong voi tieu de va tom tat ngan (2-3 cau).',
  '',
  'QUY TAC NGHIEM NGAT:',
  '- KHONG giai quyet bat ky tuyen truyen CHINH nao tru khi duoc chi dinh ro.',
  '- KHONG de nhan vat dat duoc muc tieu cuoi cung cua truyen.',
  '- Moi chuong phai co xung dot nho hoac kham pha moi de duy tri su hap dan.',
  '- Nhip do theo chi dinh cua tac gia (cham/trung binh/nhanh).',
  '- Tang dan do phuc tap va cang thang theo tien trinh Arc.',
  '',
  'Tra ve CHINH XAC JSON format:',
  '{',
  '  "arc_title": "Ten Arc/Quyen",',
  '  "chapters": [',
  '    {',
  '      "title": "Chuong X: Tieu de",',
  '      "summary": "Tom tat 2-3 cau ve noi dung chuong",',
  '      "key_events": ["Su kien 1", "Su kien 2"],',
  '      "pacing": "slow|medium|fast"',
  '    }',
  '  ]',
  '}',
  'Chi tra ve JSON, KHONG them gi khac.',
].join('\n'),

[TASK_TYPES.ARC_CHAPTER_DRAFT]: [
  'Viet noi dung chi tiet cho DUNG 1 chuong dua tren dan y da cho.',
  'Bam sat tom tat va su kien chinh cua chuong nay.',
  'Viet cuc ky chi tiet: hanh dong, tam ly, doi thoai, mieu ta canh vat.',
  'Muc tieu: 5000-7000 tu.',
  'KHONG tu y them su kien ngoai dan y.',
  'Chi tra ve noi dung chuong, KHONG them tieu de hay ghi chu.',
].join('\n'),
```

**Hành động:** Thêm xử lý user content cho 2 task mới vào khối `switch (taskType)` trong `buildPrompt()` (khoảng dòng 389-475):

```javascript
case TASK_TYPES.ARC_OUTLINE: {
  const arcParts = [];
  if (userPrompt) arcParts.push('Muc tieu Arc: ' + userPrompt);
  arcParts.push('So luong chuong can tao: ' + (context.chapterCount || 10));
  if (context.arcPacing) {
    const pacingDesc = { slow: 'Cham - xay dung, kham pha', medium: 'Trung binh', fast: 'Nhanh - hanh dong, cao trao' };
    arcParts.push('Nhip do: ' + (pacingDesc[context.arcPacing] || context.arcPacing));
  }
  if (previousSummary) arcParts.push('\nTom tat chuong truoc:\n' + previousSummary);
  userContent = arcParts.join('\n');
  break;
}

case TASK_TYPES.ARC_CHAPTER_DRAFT: {
  userContent = '[DAN Y CHUONG]\n';
  userContent += 'Tieu de: ' + (context.chapterOutlineTitle || '') + '\n';
  userContent += 'Tom tat: ' + (context.chapterOutlineSummary || '') + '\n';
  if (context.chapterOutlineEvents) {
    userContent += 'Su kien chinh:\n' + context.chapterOutlineEvents.map(e => '- ' + e).join('\n');
  }
  break;
}
```

### 2.3. Tạo Store Mới: arcGenerationStore.js

**File MỚI:** `src/stores/arcGenerationStore.js`

**Mục đích:** Quản lý toàn bộ luồng sinh chương tự động — từ thiết lập Arc → sinh dàn ý → duyệt → đắp thịt. Store này KHÔNG thay thế `aiStore.js` mà bổ sung song song.

```javascript
// Tạo file mới với nội dung:
import { create } from 'zustand';
import aiService from '../services/ai/client';
import contextEngine from '../services/ai/contextEngine';
import promptBuilder from '../services/ai/promptBuilder';
import modelRouter, { TASK_TYPES } from '../services/ai/router';
import db from '../services/db/database';

const useArcGenStore = create((set, get) => ({
  // --- State ---
  // Bước 1: Thiết lập
  arcGoal: '',              // Mục tiêu của Arc (VD: "Main đi vào Bí cảnh X")
  arcChapterCount: 10,      // Số chương muốn tạo
  arcPacing: 'medium',      // slow | medium | fast
  arcMode: 'guided',        // guided (bán tự động) | auto (đột phá)

  // Bước 2: Dàn ý đã sinh
  generatedOutline: null,   // { arc_title, chapters: [{title, summary, key_events, pacing}] }
  outlineStatus: 'idle',    // idle | generating | ready | error

  // Bước 3: Đắp thịt
  draftStatus: 'idle',      // idle | drafting | done | error
  draftProgress: { current: 0, total: 0 },
  draftResults: [],         // [{chapterIndex, title, content, wordCount, status: 'pending'|'done'|'error'|'flagged'}]

  // --- Actions ---

  // Đặt cấu hình Arc
  setArcConfig: (config) => set(config),

  // Reset trạng thái
  resetArc: () => set({
    arcGoal: '', arcChapterCount: 10, arcPacing: 'medium', arcMode: 'guided',
    generatedOutline: null, outlineStatus: 'idle',
    draftStatus: 'idle', draftProgress: { current: 0, total: 0 }, draftResults: [],
  }),

  // BƯỚC 2: Sinh Dàn Ý (Outline)
  generateOutline: async ({ projectId, chapterId, chapterIndex, genre }) => {
    set({ outlineStatus: 'generating' });
    try {
      const { arcGoal, arcChapterCount, arcPacing, arcMode } = get();

      // Thu thập ngữ cảnh
      const ctx = await contextEngine.gatherContext({
        projectId, chapterId, chapterIndex, sceneId: null, sceneText: '', genre,
      });

      // Nếu mode "auto" (đột phá), tự động chọn Plot Thread + Canon Fact
      let finalGoal = arcGoal;
      if (arcMode === 'auto') {
        // Weighted random: ưu tiên Plot Thread lâu chưa nhắc
        const plotThreads = await db.plotThreads.where('project_id').equals(projectId).toArray();
        const activeThreads = plotThreads.filter(pt => pt.state === 'active');
        const canonFacts = await db.canonFacts.where('project_id').equals(projectId).toArray();
        const activeFacts = canonFacts.filter(f => f.status === 'active');

        // Chọn ngẫu nhiên có trọng số (ưu tiên các thread chưa có beat gần đây)
        const chosenThread = activeThreads.length > 0 ? activeThreads[Math.floor(Math.random() * activeThreads.length)] : null;
        const chosenFact = activeFacts.length > 0 ? activeFacts[Math.floor(Math.random() * activeFacts.length)] : null;

        finalGoal = 'Tao 3 huong di bat ngo (plot twist) cho chuong tiep theo.';
        if (chosenThread) finalGoal += ' Tuyen truyen can phat trien: "' + chosenThread.title + '"';
        if (chosenThread?.description) finalGoal += ' (' + chosenThread.description + ')';
        if (chosenFact) finalGoal += '. Su that lien quan: "' + chosenFact.description + '"';
      }

      // Build prompt
      const messages = promptBuilder.buildPrompt(TASK_TYPES.ARC_OUTLINE, {
        ...ctx,
        userPrompt: finalGoal,
        chapterCount: arcChapterCount,
        arcPacing: arcPacing,
      });

      // Gọi AI
      const route = modelRouter.route(TASK_TYPES.ARC_OUTLINE);
      let fullText = '';
      await aiService.streamChat({
        messages,
        model: route.model,
        provider: route.provider,
        onToken: (chunk, text) => { fullText = text; },
        onComplete: (text) => {
          try {
            // Parse JSON từ AI response
            const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            set({ generatedOutline: parsed, outlineStatus: 'ready' });
          } catch (e) {
            console.error('Failed to parse outline JSON:', e);
            set({ outlineStatus: 'error' });
          }
        },
        onError: (err) => {
          console.error('Outline generation error:', err);
          set({ outlineStatus: 'error' });
        },
      });
    } catch (err) {
      console.error('generateOutline failed:', err);
      set({ outlineStatus: 'error' });
    }
  },

  // Tác giả chỉnh sửa dàn ý (trước khi đắp thịt)
  updateOutlineChapter: (index, updates) => {
    const { generatedOutline } = get();
    if (!generatedOutline) return;
    const newChapters = [...generatedOutline.chapters];
    newChapters[index] = { ...newChapters[index], ...updates };
    set({ generatedOutline: { ...generatedOutline, chapters: newChapters } });
  },

  removeOutlineChapter: (index) => {
    const { generatedOutline } = get();
    if (!generatedOutline) return;
    const newChapters = generatedOutline.chapters.filter((_, i) => i !== index);
    set({ generatedOutline: { ...generatedOutline, chapters: newChapters } });
  },

  // BƯỚC 4: Đắp thịt (Batch Generation) — chạy tuần tự từng chương
  startBatchDraft: async ({ projectId, genre, startingChapterIndex }) => {
    const { generatedOutline } = get();
    if (!generatedOutline || !generatedOutline.chapters) return;

    const chapters = generatedOutline.chapters;
    set({
      draftStatus: 'drafting',
      draftProgress: { current: 0, total: chapters.length },
      draftResults: chapters.map((ch, i) => ({
        chapterIndex: startingChapterIndex + i,
        title: ch.title,
        content: '',
        wordCount: 0,
        status: 'pending',
      })),
    });

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const chapterIdx = startingChapterIndex + i;

      try {
        // Thu thập ngữ cảnh cho chương này
        const ctx = await contextEngine.gatherContext({
          projectId, chapterId: null, chapterIndex: chapterIdx,
          sceneId: null, sceneText: '', genre,
        });

        const messages = promptBuilder.buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
          ...ctx,
          chapterOutlineTitle: ch.title,
          chapterOutlineSummary: ch.summary,
          chapterOutlineEvents: ch.key_events || [],
        });

        const route = modelRouter.route(TASK_TYPES.ARC_CHAPTER_DRAFT);
        let chapterContent = '';

        await aiService.streamChat({
          messages,
          model: route.model,
          provider: route.provider,
          onToken: (chunk, text) => { chapterContent = text; },
          onComplete: (text) => {
            chapterContent = text;
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            set(state => ({
              draftProgress: { ...state.draftProgress, current: i + 1 },
              draftResults: state.draftResults.map((r, idx) =>
                idx === i ? { ...r, content: text, wordCount, status: 'done' } : r
              ),
            }));
          },
          onError: (err) => {
            set(state => ({
              draftResults: state.draftResults.map((r, idx) =>
                idx === i ? { ...r, status: 'error' } : r
              ),
            }));
          },
        });
      } catch (err) {
        set(state => ({
          draftResults: state.draftResults.map((r, idx) =>
            idx === i ? { ...r, status: 'error' } : r
          ),
        }));
      }
    }

    set({ draftStatus: 'done' });
  },

  // Lưu các chương đã đắp thịt vào database
  commitDraftsToProject: async (projectId) => {
    const { draftResults, generatedOutline } = get();
    const useProjectStore = (await import('./projectStore')).default;
    const { chapters } = useProjectStore.getState();

    for (const draft of draftResults) {
      if (draft.status !== 'done' || !draft.content) continue;

      // Tạo chapter mới
      const chapterId = await db.chapters.add({
        project_id: projectId,
        arc_id: null,
        order_index: chapters.length + draftResults.indexOf(draft),
        title: draft.title,
        summary: generatedOutline.chapters[draftResults.indexOf(draft)]?.summary || '',
        purpose: '',
        status: 'draft',
        word_count_target: 7000,
        actual_word_count: draft.wordCount,
      });

      // Tạo 1 scene chứa toàn bộ nội dung
      await db.scenes.add({
        project_id: projectId,
        chapter_id: chapterId,
        order_index: 0,
        title: 'Cảnh 1',
        summary: '',
        pov_character_id: null,
        location_id: null,
        time_marker: '',
        goal: '',
        conflict: '',
        emotional_start: '',
        emotional_end: '',
        status: 'draft',
        draft_text: draft.content,
        final_text: '',
      });
    }

    // Reload project
    await useProjectStore.getState().loadProject(projectId);
  },

  // PHASE 3 Feature: Đánh dấu chương sai và re-generate
  flagChapter: (index, note) => {
    set(state => ({
      draftResults: state.draftResults.map((r, i) =>
        i === index ? { ...r, status: 'flagged', flagNote: note } : r
      ),
    }));
  },

  // Re-generate từ chương bị flag trở đi
  regenerateFromIndex: async ({ projectId, genre, fromIndex, startingChapterIndex }) => {
    const { generatedOutline, draftResults } = get();
    if (!generatedOutline) return;

    const chapters = generatedOutline.chapters;

    // Đặt lại status từ fromIndex trở đi
    set(state => ({
      draftStatus: 'drafting',
      draftProgress: { current: fromIndex, total: chapters.length },
      draftResults: state.draftResults.map((r, i) =>
        i >= fromIndex ? { ...r, content: '', wordCount: 0, status: 'pending' } : r
      ),
    }));

    // Re-run batch từ fromIndex
    for (let i = fromIndex; i < chapters.length; i++) {
      const ch = chapters[i];
      const chapterIdx = startingChapterIndex + i;

      // Lấy context, bao gồm nội dung các chương trước đó (đã ok)
      const previousContent = draftResults
        .filter((r, idx) => idx < i && r.status === 'done')
        .map(r => r.content)
        .join('\n\n');

      try {
        const ctx = await contextEngine.gatherContext({
          projectId, chapterId: null, chapterIndex: chapterIdx,
          sceneId: null, sceneText: previousContent.slice(-3000), genre,
        });

        // Nếu chương bị flag, thêm note sửa đổi vào context
        const flagNote = draftResults[i]?.flagNote || '';
        const messages = promptBuilder.buildPrompt(TASK_TYPES.ARC_CHAPTER_DRAFT, {
          ...ctx,
          chapterOutlineTitle: ch.title,
          chapterOutlineSummary: ch.summary + (flagNote ? '. GHI CHU SUA DOI: ' + flagNote : ''),
          chapterOutlineEvents: ch.key_events || [],
        });

        const route = modelRouter.route(TASK_TYPES.ARC_CHAPTER_DRAFT);

        await aiService.streamChat({
          messages,
          model: route.model,
          provider: route.provider,
          onToken: () => {},
          onComplete: (text) => {
            const wordCount = text.split(/\s+/).filter(Boolean).length;
            set(state => ({
              draftProgress: { ...state.draftProgress, current: i + 1 },
              draftResults: state.draftResults.map((r, idx) =>
                idx === i ? { ...r, content: text, wordCount, status: 'done', flagNote: '' } : r
              ),
            }));
          },
          onError: () => {
            set(state => ({
              draftResults: state.draftResults.map((r, idx) =>
                idx === i ? { ...r, status: 'error' } : r
              ),
            }));
          },
        });
      } catch {
        set(state => ({
          draftResults: state.draftResults.map((r, idx) =>
            idx === i ? { ...r, status: 'error' } : r
          ),
        }));
      }
    }

    set({ draftStatus: 'done' });
  },
}));

export default useArcGenStore;
```

### 2.4. Tạo UI Component: ArcGenerationModal

**File MỚI:** `src/pages/OutlineBoard/ArcGenerationModal.jsx`
**File MỚI:** `src/pages/OutlineBoard/ArcGenerationModal.css`

**Mô tả giao diện (cho AI code UI):**

Modal lớn (fullscreen hoặc 90% viewport), chia làm **4 bước (wizard steps)** hiển thị theo dạng stepper:

**Bước 1 — Thiết Lập Arc:**
- 2 Tab: "Bán Tự Động (Guided)" và "Đột Phá (Auto Brainstorm)"
- Tab Guided: Ô textarea nhập mục tiêu Arc + Dropdown nhịp độ (Chậm/Vừa/Nhanh) + Input số chương (5-50)
- Tab Auto: Chỉ cần chọn số chương + Nhấn nút "Tạo Bất Ngờ" (hệ thống tự bốc Plot Thread + Canon Fact)
- Nút "Tiếp theo" → chuyển sang Bước 2

**Bước 2 — Xem & Chỉnh Dàn Ý:**
- Danh sách N card, mỗi card hiển thị: Tên chương (editable) + Tóm tắt (editable textarea) + Badge nhịp độ
- Nút (x) để xóa chương khỏi dàn ý
- Nút "Quay lại" + Nút "Chốt & Bắt đầu viết"

**Bước 3 — Đắp Thịt (Progress View):**
- Progress bar tổng thể: "Đang viết 3/20 chương..."
- Danh sách cards hiển thị: Tên chương + trạng thái (Đang chờ ⏳ / Đang viết ✍️ / Xong ✅ / Lỗi ❌)
- Mỗi card xong hiển thị số từ (word count)
- Nút "Hủy" để dừng giữa chừng

**Bước 4 — Kết Quả & Feedback:**
- Danh sách cards với preview nội dung (200 từ đầu)
- Nút "👁️ Xem full" mở modal con hiển thị toàn bộ nội dung
- Nút "🚩 Đánh dấu sai" cho phép nhập ghi chú sửa đổi
- Nút "🔄 Tạo lại từ chương này" (gọi `regenerateFromIndex`)
- Nút "✅ Lưu tất cả vào dự án" (gọi `commitDraftsToProject`)

### 2.5. Tích Hợp Vào OutlineBoard

**File:** `src/pages/OutlineBoard/OutlineBoard.jsx`

**Hành động:** Thêm nút "🤖 Tạo Chương Tự Động" vào toolbar của OutlineBoard. Khi click, mở `ArcGenerationModal`.

```jsx
// Import ArcGenerationModal
import ArcGenerationModal from './ArcGenerationModal';

// Thêm state:
const [showArcGen, setShowArcGen] = useState(false);

// Thêm nút vào toolbar (gần các nút "Thêm chương", "Thêm tuyến truyện"):
<button onClick={() => setShowArcGen(true)} className="arc-gen-btn">
  🤖 Tạo Chương Tự Động
</button>

// Render modal:
{showArcGen && (
  <ArcGenerationModal
    projectId={currentProject.id}
    genre={currentProject.genre_primary}
    currentChapterCount={chapters.length}
    onClose={() => setShowArcGen(false)}
  />
)}
```

---

## PHASE 3: Feedback Loop (Cascade Re-generation)

Đã được tích hợp sẵn vào `arcGenerationStore.js` ở Phase 2 (Bước 4 UI + hàm `flagChapter` + `regenerateFromIndex`). Không cần file mới.

---

## PHASE 4: Weighted Random Selection (Cải Thiện Chế Độ Đột Phá)

### Mục tiêu
Thay thế logic random thuần bằng weighted random thông minh.

**File:** `src/stores/arcGenerationStore.js`

**Hành động:** Cải thiện phần chọn Plot Thread + Canon Fact trong hàm `generateOutline` (phần `arcMode === 'auto'`):

```javascript
// Thay thế logic random đơn giản bằng weighted random:

// 1. Tính trọng số cho Plot Thread: thread nào lâu chưa có beat → trọng số cao
const threadBeats = await db.threadBeats.where('plot_thread_id').anyOf(activeThreads.map(t => t.id)).toArray();
const threadWeights = activeThreads.map(thread => {
  const beats = threadBeats.filter(b => b.plot_thread_id === thread.id);
  const lastBeatSceneId = beats.length > 0 ? Math.max(...beats.map(b => b.scene_id)) : 0;
  // Trọng số = Khoảng cách từ beat cuối cùng. Càng xa càng cao.
  return { thread, weight: Math.max(1, 100 - lastBeatSceneId) };
});

// 2. Weighted random pick
function weightedPick(items) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1];
}

const chosenThread = threadWeights.length > 0 ? weightedPick(threadWeights).thread : null;

// 3. Chọn Canon Fact liên quan đến nhân vật trong thread (nếu có)
let chosenFact = null;
if (activeFacts.length > 0) {
  // Ưu tiên Canon Fact có subject liên quan
  const relevantFacts = activeFacts.filter(f => f.subject_type === 'character');
  chosenFact = relevantFacts.length > 0
    ? relevantFacts[Math.floor(Math.random() * relevantFacts.length)]
    : activeFacts[Math.floor(Math.random() * activeFacts.length)];
}
```

---

## Thứ Tự Triển Khai Được Khuyến Nghị

| Thứ tự | Phase | Độ phức tạp | Ước lượng thời gian |
|--------|-------|-------------|---------------------|
| 1      | Phase 1: Project Settings | Thấp | 1-2 giờ |
| 2      | Phase 2: Arc Generation (Core) | Cao | 4-6 giờ |
| 3      | Phase 3: Feedback Loop | Trung bình | (đã tích hợp Phase 2) |
| 4      | Phase 4: Weighted Random | Thấp | 30 phút |

---

## Kiểm Tra & Xác Minh (Verification Plan)

### Test thủ công (Manual Testing)

1. **Test Phase 1 — Project Settings:**
   - Mở app → Tạo dự án mới → Kiểm tra có hiển thị 3 field mới không (Target Length, Ultimate Goal, Milestones)
   - Nhập dữ liệu → Lưu → Đóng → Mở lại → Xác nhận dữ liệu còn nguyên
   - Mở Settings → Chỉnh sửa 3 field → Lưu → Xác nhận cập nhật

2. **Test Phase 2 — Arc Outline Generation:**
   - Mở OutlineBoard → Bấm "Tạo Chương Tự Động"
   - Chọn Tab "Bán tự động" → Nhập mục tiêu → Chọn 5 chương → Bấm Tạo
   - Chờ AI sinh dàn ý → Xác nhận hiển thị 5 card với tên chương + tóm tắt
   - Sửa tên 1 chương → Xóa 1 chương → Xác nhận dàn ý cập nhật
   - Bấm "Chốt & Bắt đầu viết" → Xác nhận progress bar chạy
   - Chờ hoàn thành → Xác nhận hiển thị nội dung + word count

3. **Test Phase 2 — Auto Brainstorm Mode:**
   - Tạo ít nhất 1 Plot Thread + 1 Canon Fact trong StoryBible trước
   - Mở ArcGenerationModal → Chọn Tab "Đột phá" → Bấm "Tạo Bất Ngờ"
   - Xác nhận AI tạo ra 3 hướng đi (hoặc dàn ý có liên quan đến Plot Thread đã tạo)

4. **Test Phase 3 — Feedback Loop:**
   - Sau khi đắp thịt xong (Bước 4) → Bấm "🚩 Đánh dấu sai" trên 1 chương
   - Nhập ghi chú sửa đổi → Bấm "🔄 Tạo lại từ chương này"
   - Xác nhận: chương trước chương bị flag vẫn giữ nguyên, từ chương flag trở đi được re-generate
   - Bấm "✅ Lưu tất cả" → Mở OutlineBoard → Xác nhận các chương mới xuất hiện trong cây thư mục

5. **Test Pacing Control (không bị End sớm):**
   - Tạo project với Target Length = 500, Ultimate Goal = "Thần Tôn"
   - Thêm Milestone: 25% = "Trúc Cơ", 50% = "Nguyên Anh"
   - Tạo Arc ở chương 10 (tức ~2%) → Xác nhận AI KHÔNG đề cập đến Nguyên Anh hay kết thúc truyện

---

*Kế hoạch này hoàn toàn tự chứa (self-contained). Bất kỳ AI model nào đọc file này đều có đủ thông tin để triển khai mà không cần hỏi thêm ngữ cảnh.*
*Được tạo: 2026-03-22*
