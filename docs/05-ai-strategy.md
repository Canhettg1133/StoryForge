# 05 – Chiến lược AI

## Nguyên tắc
- User bấm **tác vụ** → App **tự chọn model** phù hợp
- User chỉ chọn **mức chất lượng / tốc độ**
- Không để user phải biết model nào dùng lúc nào
- Không bơm nguyên cả truyện vào prompt
- Không generate cả chương dài mà không có contract/context filtering

---

## 3 chế độ cho user

| Chế độ | Mô tả | Use case |
|--------|--------|----------|
| **Fast** | Nhanh, rẻ | Brainstorm, summary, expand ngắn |
| **Balanced** | Mặc định | Flash nhẹ, Pro quan trọng |
| **Best Quality** | Model mạnh | Outline sâu, rewrite, continuity, style writing |

---

## Router tác vụ

| Flash (nhẹ) | Pro (nặng) |
|-------------|------------|
| Brainstorm, summarize, classify | Story bible sâu, outline dài |
| Scene metadata extraction | Plot logic, continuity reasoning |
| Style feature extraction sơ bộ | Rewrite chất lượng cao |
| Quick rewrite nhẹ | Style adherence mạnh |
| Outline sơ bộ | Chapter QA, canon conflict |

**Router cân nhắc:** loại tác vụ, độ dài context, scene quan trọng, mode user, quota model, fallback chain.

---

## API Resources

| Model | Quota/ngày | Tier |
|---|---|---|
| Gemini 2.5-Flash | 1.500 | Flash |
| Gemini 3-Flash | 1.500 | Flash |
| Gemini 2.5-Pro | 800 | Pro |
| Gemini 3-Pro | 900 | Pro+ |
| Gemini 3.1-Pro | 900 | Pro+ |
| **Tổng** | **5.600 lượt/ngày** | — |

6 API key × round-robin rotation.

---

## Phân tầng model cụ thể

| Task | Model | Lý do |
|---|---|---|
| Brainstorm, gợi ý plot | 2.5-Flash / 3-Flash | Nhanh, tiết kiệm, không cần tinh tế |
| Tạo outline chương | Flash | Cấu trúc đơn giản |
| Tóm tắt chương cũ (auto) | Flash | Gọi 1 lần khi chương hoàn thành |
| Trích xuất thuật ngữ | Flash | Task phân tích, không cần sáng tạo |
| Viết chương chính (~1.000 từ) | 3-Pro | Cần narrative depth |
| Mở rộng đoạn văn | 2.5-Pro | Chất lượng tốt, tiết kiệm hơn |
| Cảnh cao trào, emotional peak | 3.1-Pro | Model mạnh nhất, dùng chọn lọc |
| Rewrite / polish cảnh quan trọng | 3.1-Pro | Cần tinh tế cao nhất |
| Style — phân tích sơ bộ / chia cảnh | Flash | Ingest + preprocess |
| Style — rút DNA sâu / rewrite theo style | Pro / Pro+ | Generate + voice consistency |
| Continuity check đa chương | 3.1-Pro | Phân tích phức tạp, dài |

---

## Key Rotation System

### Chia nhóm
- **Flash group (3 key):** phục vụ 2.5-Flash và 3-Flash
- **Pro group (3 key):** phục vụ 2.5-Pro, 3-Pro, 3.1-Pro

### Logic failover
```
Request đến
  → Lấy key tiếp theo trong nhóm (index % 3)
  → Gọi API
  → Nếu 429: đánh dấu key + timestamp, thử key kế tiếp
  → Nếu tất cả key trong nhóm 429: hiện thông báo, queue request
  → Reset timestamp lúc 07:00 sáng (giờ reset quota Gemini)
```

### Quota UI Panel
- Thanh progress cho từng model
- Số lượt còn lại trong ngày
- Tổng lượt còn lại toàn hệ thống
- Cảnh báo đỏ khi model sắp hết quota

---

## Prompt Architecture – 8 tầng

```
┌─────────────────────────────────────┐
│ 1. System Identity                  │  Đồng biên tập, tuân canon, ưu tiên consistency
│ 2. Task Instruction                 │  Viết draft / rewrite / audit...
│ 3. Genre Constraints                │  Fantasy dark / trinh thám / ngôn tình...
│ 4. Story Canon Context              │  Chỉ inject canon liên quan
│ 5. Character State Context          │  Chỉ inject state nhân vật xuất hiện
│ 6. Scene Contract                   │  Cốt lõi task scene writing
│ 7. Style Pack                       │  Voice, traits, banned, exemplars
│ 8. Output Format                    │  Prose / JSON / audit report
└─────────────────────────────────────┘
```

---

## 6 Prompt Flows

### 1. Brainstorm
- **In:** premise, genre, tone, target length
- **Out:** 5 premise variants, 3 conflict/theme directions, 1 recommended combo

### 2. Outline
- **In:** premise, cast, genre pack, target chapters
- **Out:** arcs, chapter goals, scene suggestions, major reveals, thread seeds

### 3. Scene Draft
- **In:** scene contract, canon context, state context, style pack, previous scene summary
- **Out:** scene prose draft

### 4. Rewrite
- **In:** original text, objective, style pack, intensity
- **Out:** rewritten text + change notes (optional)

### 5. Continuity Audit
- **In:** chapter text, canon facts, timeline facts, character states
- **Out:** critical issues, likely issues, suggestions

### 6. Style Learn
- **In:** uploaded sample text, optional labels, learning mode (current project / reference / author sample)
- **Out:** style profile (Style DNA), narrative profile, character voice profiles, exemplar snippets, banned imitation zones
- **Model:** Flash cho parse + trích xuất nhanh, Pro cho DNA sâu + so sánh voice
