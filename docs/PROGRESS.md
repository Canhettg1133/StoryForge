# 📊 StoryForge — Progress Tracker

> Cập nhật lần cuối: 2026-03-21

---

## Tổng quan

| Phase | Tên | Trạng thái | Ngày xong |
|-------|-----|-----------|-----------|
| 1 | Nền tảng | ✅ Xong | ~Tuần 1 |
| 2 | Editor & AI | ✅ Xong | ~Tuần 2 |
| 3 | Memory | ✅ Xong | ~Tuần 3 |
| 4 | Canon & Genre | ✅ Xong | ~Tuần 4 |
| 4.5 | Continuity & Intelligence | ✅ Xong | ~Tuần 5 |
| 5 | Pipeline & Style | 🔲 Chưa bắt đầu | — |
| 6 | Polish | 🔲 Chưa bắt đầu | — |

---

## Phase 1 — Nền tảng ✅

| Tính năng | Trạng thái | File chính |
|-----------|-----------|------------|
| Vite + React setup | ✅ | `vite.config.js`, `main.jsx` |
| Design System (dark theme, CSS tokens) | ✅ | `src/styles/` |
| App Layout (Sidebar + main) | ✅ | `components/common/AppLayout.jsx`, `Sidebar.jsx` |
| IndexedDB (Dexie) | ✅ | `services/db/database.js` |
| Project CRUD | ✅ | `stores/projectStore.js`, `pages/Dashboard/` |
| Chapter CRUD | ✅ | `stores/projectStore.js`, `components/common/ChapterList.jsx` |
| Scene CRUD | ✅ | `stores/projectStore.js`, `components/common/ChapterList.jsx` |
| Routing (10 pages) | ✅ | `App.jsx` |

---

## Phase 2 — Editor & AI ✅

| Tính năng | Trạng thái | File chính |
|-----------|-----------|------------|
| Tiptap editor (StarterKit, Placeholder, CharacterCount) | ✅ | `components/editor/StoryEditor.jsx` |
| Auto-save debounce 2s | ✅ | `components/editor/StoryEditor.jsx` |
| Word/character count | ✅ | `components/editor/StoryEditor.jsx`, `utils/constants.js` |
| AI Client — 3 providers (Proxy, Direct, Ollama) | ✅ | `services/ai/client.js` |
| Streaming — 3 parsers (SSE, Gemini SSE, NDJSON) | ✅ | `services/ai/client.js` |
| Key Manager (pool per provider, round-robin, rate limit) | ✅ | `services/ai/keyManager.js` |
| Model Router (quality modes, task→model, fallback) | ✅ | `services/ai/router.js` |
| Prompt Builder (system + user, context-aware) | ✅ | `services/ai/promptBuilder.js` |
| AI Sidebar (6 quick actions, free prompt, streaming) | ✅ | `components/ai/AISidebar.jsx` |
| AI Store (Zustand, 8 task shortcuts) | ✅ | `stores/aiStore.js` |
| Settings page (providers, keys, test connection) | ✅ | `pages/Settings/Settings.jsx` |

---

## Phase 3 — Memory ✅

### Core Codex ✅
| Tính năng | Trạng thái | File chính |
|-----------|-----------|------------|
| DB v2 (worldTerms, taboos, chapterMeta) | ✅ | `services/db/database.js` |
| Codex Store (CRUD nhân vật, địa danh, vật phẩm, thuật ngữ, cấm kỵ) | ✅ | `stores/codexStore.js` |
| Characters Page (grid, modal, CRUD đầy đủ) | ✅ | `pages/CharacterHub/CharacterHub.jsx` |
| Xưng hô theo thể loại (5 preset) | ✅ | `utils/constants.js`, `CharacterHub.jsx` |
| World Page — 3 tab (Locations, Objects, Terms) | ✅ | `pages/WorldLore/WorldLore.jsx` |
| Cấm kỵ theo chương (UI trong CharacterHub) | ✅ | `CharacterHub.jsx`, `codexStore.js` |

### AI Engine ✅
| Tính năng | Trạng thái | File chính |
|-----------|-----------|------------|
| Context Engine (auto-detect nhân vật/thuật ngữ trong scene) | ✅ | `services/ai/contextEngine.js` |
| Prompt 8 tầng (System, Task, Genre, Canon, Character, Contract*, Style*, Output) | ✅ | `services/ai/promptBuilder.js` |
| Vòng phản hồi (auto-extract codex khi xong chương) | ✅ | `stores/aiStore.js`, `ChapterList.jsx` |
| Tóm tắt chương tự động (Flash model) | ✅ | `stores/aiStore.js`, `codexStore.js` |

### AI Enhancement ✅
| Tính năng | Trạng thái | File chính |
|-----------|-----------|------------|
| AI Generate Button (reusable — Characters + World) | ✅ | `components/common/AIGenerateButton.jsx` |
| AI Wizard tạo project (3 bước: ý tưởng → AI sinh → review) | ✅ | `pages/Dashboard/ProjectWizard.jsx` |
| Genre Templates (8 thể loại pre-fill) | ✅ | `utils/genreTemplates.js` |
| Story Bible (auto wiki từ Codex) | ✅ | `pages/StoryBible/StoryBible.jsx` |
| NewProjectModal (chọn AI / Thủ công) | ✅ | `pages/Dashboard/NewProjectModal.jsx` |

### World Profile ✅
| Tính năng | Trạng thái | Ghi chú |
|-----------|-----------|--------|
| World Profile fields trong DB/projectStore | ✅ | Tên, loại, quy mô, thời đại, quy tắc, mô tả |
| World Profile card ở đầu trang World | ✅ | Hiện tổng quan trước danh sách entities |
| AI Wizard sinh World Profile | ✅ | Sinh tên thế giới, quy tắc, mô tả tổng |
| Context Engine inject World Profile | ✅ | Layer 4 biết "thế giới này là gì" |

### Bugs đã fix trong session này
- `createChapter()` crash khi gọi từ AI Wizard (dùng `currentProject.id` khi null) → fix dùng `pid`
- JSON parser AI response greedy regex → fix balanced brace counting (AIGenerateButton + ProjectWizard)
- API key nhập đơn không có → thêm input field + duplicate check
- API key bulk import xóa key cũ → fix `setKeys()` thành append
- CORS lỗi Gemini Proxy → thêm Vite proxy `/api/proxy`
- JSON parser greedy regex trong `aiStore.js:extractFromChapter` → fix balanced brace counting
- "Hoàn thành chương" tạo entity trùng (duplicate) → thêm name-matching trước khi create

### Phase 3 Enhancement ✅ (Session 2)

| Tính năng | Trạng thái | File | Mô tả |
|-----------|-----------|------|--------|
| Codex Panel trong Editor | ✅ | `components/editor/CodexPanel.jsx` | Real-time detect nhân vật/địa điểm/vật phẩm/thuật ngữ khi đang viết |
| Continuity Bar ("Chương trước...") | ✅ | `components/editor/ContinuityBar.jsx` | Bar ở top editor hiện tóm tắt chương trước |
| Batch Generation | ✅ | `components/common/BatchGenerate.jsx` | Tạo hàng loạt entity (3-8 cái) có context cốt truyện |
| Smart Duplicate Detection | ✅ | `components/common/ChapterList.jsx` | Check trùng tên trước khi insert entity mới |
| btn-accent + .spin global | ✅ | `styles/components.css` | UI utilities |
| codex-modal--lg | ✅ | `CharacterHub.css` | Modal lớn cho Batch Generate |

**Chi tiết:**

**Codex Panel** — Tích hợp trong AISidebar (top section). Khi tác giả viết text, panel tự scan entities đang xuất hiện trong scene. Hiện mini-cards với role, xưng hô, mô tả, mục tiêu. Cũng hiện cảnh báo Cấm kỵ (taboos) nếu có.

**Continuity Bar** — Hiện ở giữa scene title và editor content. Collapsible, hiện "Chương trước: [tên] — [summary]". Giúp tác giả recap mà không cần đọc lại chương cũ.

**Batch Generation** — Nút "✨ Tạo hàng loạt" ở CharacterHub + WorldLore. AI đọc outline + nhân vật/thế giới/thuật ngữ hiện có → sinh batch entity PHÙ HỢP cốt truyện (không random). Có: chọn số lượng, yêu cầu bổ sung, context preview, review & loại bỏ.

### Outline Board ✅ (Session 2)

| Tính năng | Trạng thái | File |
|-----------|-----------|------|
| 3-Act Lane View (Hồi 1/2/3) | ✅ | `pages/OutlineBoard/OutlineBoard.jsx` |
| Chapter Cards (title, purpose, summary, status) | ✅ | ↑ |
| Board/List toggle view | ✅ | ↑ |
| Chapter Detail Modal | ✅ | `pages/OutlineBoard/ChapterDetailModal.jsx` |
| Scene detail editing (goal, conflict, POV, location) | ✅ | ↑ |
| AI Outline generation (tạo/phân tích outline) | ✅ | ↑ |
| Sidebar badge SOON → removed | ✅ | `Sidebar.jsx` |

### Cần kiểm tra / hoàn thiện thêm (Phase 3)
- [ ] Test Outline Board: mở `/outline` → hiện board 3 hồi
- [ ] Test Chapter Detail Modal: click card → sửa purpose/summary → lưu
- [ ] Test AI Outline: bấm "AI Outline" → tạo 10 chương có purpose
- [ ] Test Scene Detail: sửa goal, conflict, POV, location cho scene
- [ ] Test AI tạo địa điểm/vật phẩm/thuật ngữ sau fix JSON parser
- [ ] Test Codex Panel: viết text có tên nhân vật → panel hiện card
- [ ] Test Continuity Bar: chương 2 → hiện summary chương 1
- [ ] Test Batch Generate: CharacterHub + WorldLore
- [ ] Test Smart Duplicate: hoàn thành chương 2 lần → không tạo trùng

*Tầng 6 (Scene Contract) và tầng 7 (Style Pack) là placeholder cho Phase 4-5.

---

## Phase 4 — Canon & Genre ✅

| Tính năng | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| Canon Engine (facts, secrets, validity range) | ✅ | CRUD trong StoryBible |
| Scene Contract | ✅ | Mục tiêu + ràng buộc trước khi viết |
| Tùy chỉnh Pronouns + POV + Genre Settings | ✅ | Xưng hô 10 preset, 5 Thể loại mới |
| Prompt Template Manager | ✅ | Tùy chỉnh prompt hệ thống cho từng task |
| Context Engine v2 | ✅ | Cải thiện regex + Entity detection |
| DB Version 3 + Đóng gói Backup | ✅ | Migrate fields, Export/Import project |
| Relationship Map (quan hệ nhân vật) | 🔲 | DB `relationships` sẵn schema |
| Genre Pack: Fantasy | 🔲 | World rules, magic system, power scaling |
| Genre Pack: Trinh thám | 🔲 | Clue map, suspects, knowledge asymmetry |
| Genre Pack: Ngôn tình | 🔲 | Chemistry arc, emotional beat |
| Genre Pack: Kinh dị | 🔲 | Dread build-up, tension curve |

---

## Phase 4.5 — Continuity & Intelligence ✅

| Tính năng | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| Changelog Timeline | ✅ | Ghi lại lịch sử thay đổi states của entity theo chương |
| Conflict Detection (AI QA) | ✅ | Nhận diện mâu thuẫn logic với Canon + Timeline |
| Tích hợp UI Sidebar | ✅ | Nút Check Mâu Thuẫn trực tiếp trên AI Sidebar |

---

## Phase 5 — Pipeline & Style 🔲

| Tính năng | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| Draft Pipeline 5 bước | 🔲 | Outline → Goals → Draft → Rewrite → Polish |
| Style Lab Lite (upload → analyze → profile) | 🔲 | |
| QA cơ bản (continuity, pacing, repetition, POV) | 🔲 | |

---

## Phase 6 — Polish 🔲

| Tính năng | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| Dashboard cải thiện | 🔲 | Stats, recent activity |
| Export EPUB | 🔲 | epub.js |
| Export DOCX | 🔲 | html-docx-js |
| Export PDF | 🔲 | jspdf |
| Quota UI Panel | 🔲 | Thanh progress từng model |
| UX Polish | 🔲 | Animations, transitions, responsive |

---

## Pages — Trạng thái implement

| Page | Route | Trạng thái |
|------|-------|-----------|
| Dashboard | `/` | ✅ Functional |
| Scene Editor | `/editor` | ✅ Functional + Codex Panel + Continuity Bar |
| Settings | `/settings` | ✅ Functional |
| Characters | `/characters` | ✅ Functional + Batch Generate |
| World Lore | `/world` | ✅ Functional + Batch Generate |
| Story Bible | `/story-bible` | ✅ Functional (Phase 3) |
| Outline Board | `/outline` | ✅ Functional + AI Outline + 3-Act View |
| Timeline | `/timeline` | ⏳ Placeholder (Phase 6) |
| Revision & QA | `/revision` | ⏳ Placeholder (Phase 5) |
| Style Lab | `/style-lab` | ⏳ Placeholder (Phase 5) |

---

## Phase 6B/6C Update (2026-04-05)

- [x] Incident-only 1M flow scaffolded (Pass A/B/C job + prompts).
- [x] Unit/integration/e2e maintenance tests added (`src/tests/phases/phase6c-maintenance.test.js`).
- [x] Backup automation added (`npm run backup:corpus`).
- [x] Backfill automation added (`npm run backfill:incident-first`).
- [x] One-command maintenance runner added (`npm run phase6:maintenance`).
