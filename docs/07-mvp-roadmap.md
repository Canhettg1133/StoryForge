# 07 – MVP & Roadmap

## MVP – 7 cụm chính

| # | Cụm | Chi tiết |
|---|-----|----------|
| 1 | **Project + Chapter + Scene** | Lõi quản lý tác phẩm |
| 2 | **Character + Lore + Timeline cơ bản** | Đủ lưu thế giới truyện |
| 3 | **Scene Contract** | AI viết có kỷ luật |
| 4 | **AI Brainstorm / Outline / Draft / Rewrite** | Bộ AI cơ bản |
| 5 | **Canon Lite** | Facts, secrets, ai biết gì, basic conflict check |
| 6 | **Style Lab Lite** | Upload text → style profile cơ bản |
| 7 | **QA cơ bản** | Continuity, pacing nhẹ, repetition, POV |

---

## Chưa cần ở MVP

- Collaboration realtime
- Beta reader portal
- Trope manager đầy đủ
- Timeline simulator chi tiết
- Relationship heatmap nâng cao
- Marketplace prompt/style packs
- Mobile app native
- Publish platform riêng
- Community discovery

---

## Build Timeline — 6 tuần (BẢN CHÍNH THỨC)

> ⚠️ Đây là bảng roadmap duy nhất. Mọi thay đổi cập nhật ở đây.

| Phase | Tuần | Nội dung | Trạng thái |
|-------|------|----------|-----------|
| **1 — Nền tảng** | Tuần 1 | Vite+React, Design System (dark theme), Layout, IndexedDB, Project/Chapter/Scene CRUD | ✅ Xong |
| **2 — Editor & AI** | Tuần 2 | Tiptap editor, AI proxy client (streaming), Key rotation, Model router, AI sidebar | ✅ Xong |
| **3 — Memory** | Tuần 3 | Codex nhân vật + thế giới, Context Engine, Prompt 8 tầng, Cấm kỵ, Feedback Loop, **AI Wizard tạo project, AI Generate (Characters/World), Genre Templates (8 thể loại), Story Bible auto-wiki, World Profile tổng quan** | ✅ Xong |
| **4 — Canon & Genre** | Tuần 4 | Canon Engine, Scene Contract, Phân cấp địa điểm (tree view), 4+ Genre Packs (Fantasy/Trinh thám/Ngôn tình/Kinh dị) | ✅ Xong |
| **4.5 — Continuity & QA** | Tuần 4-5 | Changelog Timeline, Conflict Detection (AI tự phát hiện mâu thuẫn) | 🔲 Chưa |
| **5 — Pipeline & Style** | Tuần 5 | Draft Pipeline 5 bước, Style Lab Lite, QA cấu trúc/ngôn từ | 🔲 Chưa |
| **6 — Polish** | Tuần 6 | Dashboard nâng cao, Export (EPUB/DOCX/PDF), Quota UI, UX polish | 🔲 Chưa |

---

## Tầm nhìn sau MVP (không thuộc 6 tuần)

| Phase | Mục tiêu | Tính năng chính |
|-------|----------|----------------|
| **Post-MVP 1 — Writer Workflow** | Workflow viết chuyên nghiệp | Plot threads, State engine, Revision lab mạnh, QA sâu, Secret visibility |
| **Post-MVP 2 — Story Intelligence** | Trí tuệ truyện | Canon engine mạnh, Timeline simulator, Relationship graph, Trope tracking |
| **Post-MVP 3 — Team / Publish** | Cộng tác & xuất bản | Collab, Shared editing, Beta readers, Export pipeline, Version branches |

---

## Rủi ro & Cách tránh

| Rủi ro | Cách tránh |
|--------|-----------|
| App thành chatbot đội lốt novel app | Focus project structure, không phải chat |
| Bơm context quá nhiều → tốn quota, chậm | Retrieval thông minh, chỉ lấy phần liên quan |
| AI viết dài nhưng loãng | Ép qua scene contract |
| Style learning bắt chước quá sát | Dùng style traits, không clone nguyên giọng |
| Canon quá phức tạp → UX nặng | Auto extract, gợi ý fact, approve/reject |
| Ôm quá nhiều tính năng sớm | MVP cực kỷ luật |
