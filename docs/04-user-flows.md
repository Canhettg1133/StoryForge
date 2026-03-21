# 04 – User Flows & Màn hình

## 5 luồng sử dụng chính

### Flow 1: Tạo truyện mới
```
Tạo project → Chọn thể loại → Chọn tone/audience → Chọn chế độ AI (viết tay / AI vừa / AI mạnh)
→ App sinh bộ khung: project, story bible, outline board, character tab, lore tab, timeline tab
```

### Flow 2: Xây truyện từ ý tưởng
```
Nhập premise + thể loại + điểm hấp dẫn + độ dài dự kiến
→ Brainstorm 5-10 hướng → Chọn 1 → Sinh core conflict
→ Sinh main cast → Sinh arcs → Sinh chapter skeleton
```

### Flow 3: Viết một cảnh
```
Mở chapter → Chọn scene → Xem scene contract
→ AI được nạp: scene goal, outline, canon, state nhân vật, style pack, genre pack
→ Generate first draft → Continuity check → Rewrite nếu cần → Mark done
```

### Flow 4: Viết tiếp theo giọng đã học
```
Upload mẫu / chọn chương cũ → App tạo style pack
→ "Viết tiếp theo giọng này"
→ Dùng: style profile, exemplar snippets, voice constraints, scene contract, canon context
```

### Flow 5: Kiểm chương trước khi chốt
```
QA chapter → Chạy: continuity, pacing, POV, repetition, dialogue, chapter intent
→ Trả: vấn đề nghiêm trọng / vừa, gợi ý cải thiện, phần nên rewrite
```

---

## 9 màn hình chính

| # | Màn hình | Nội dung |
|---|----------|----------|
| 1 | **Dashboard** | Tên truyện, tiến độ, chapter gần đây, plot thread status, canon alerts, quick actions |
| 2 | **Story Bible** | Premise, theme, tone, genre, world rules, core conflicts, forbidden facts |
| 3 | **Outline Board** | Arc → chapter → scene cards, trạng thái, thread coverage, chapter purpose |
| 4 | **Character Hub** | Profile, goal, fear, secret, arc, voice, relationship map, current state |
| 5 | **World / Lore** | Location, faction, item, law, magic, social norms, history |
| 6 | **Editor / Scene** | Trái: chapter tree · Giữa: editor · Phải: scene contract, canon warnings, AI actions |
| 7 | **Timeline / Thread** | Timeline events, plot thread graph, relationship changes, reveal schedule |
| 8 | **Revision / QA** | Diff compare, QA report, rewrite presets, risk flags |
| 9 | **Style Lab** | Upload source, chọn mục đích học, kết quả phân tích Style DNA, nút hành động |

---

## Style Lab — Màn hình chi tiết

### Upload source
- Thả file txt/md/docx/epub/pdf hoặc paste text trực tiếp

### Chọn mục đích học
- Học văn phong câu chữ
- Học nhịp kể
- Học giọng nhân vật
- Học cách mở/kết chương
- Học toàn bộ

### Kết quả phân tích
App trả về Style DNA:
```
Văn phong: trữ tình vừa, nhịp trung bình, thiên nội tâm
Thoại: 28% · Miêu tả: 47% · Hành động: 25%
Mức cảm xúc: cao · Câu trung bình: 21 từ
Giọng kể: gần nhân vật, hơi u uất
Từ khóa phong cách: mềm, đằm, gợi, tiếc nuối
```

### Nút hành động
- Dùng làm giọng mặc định của truyện
- Dùng cho riêng nhân vật X
- Dùng cho arc Y
- Dùng để rewrite
- Dùng để viết cảnh mới

---

## AI Sidebar (Panel phải trong Editor)

### Tab AI — Tác vụ nhanh 1 click
| Tác vụ | Model |
|--------|-------|
| Viết tiếp đoạn | Flash |
| Viết lại đoạn đã chọn | Pro |
| Mở rộng đoạn văn | Flash |
| Gợi ý hướng plot (3 hướng) | Pro+ |
| Tạo outline chương | Flash |
| Trích xuất thuật ngữ | Flash |

- Kết quả hiện trong panel, có nút **"Áp dụng vào editor"**
- Ô nhập **prompt tự do** phía dưới: gõ yêu cầu cụ thể, chọn model, nhấn Gửi
- Ví dụ: *"viết cảnh gặp mặt Minh và Lệ, tone lãng mạn nhẹ, ~400 từ, Minh xưng ta, Lệ xưng cô"*

### Tab Codex — Context đang active
Hiển thị nhân vật và bối cảnh đang active trong cảnh hiện tại. Tự động cập nhật khi editor nhận diện tên nhân vật mới.

### Tab Keys — Quota
Thanh progress từng model, lượt còn lại hôm nay, giờ reset. Cảnh báo đỏ khi sắp hết.

---

## Streaming & UX

- **Streaming realtime** — văn bản AI xuất hiện từng chữ, không chờ xong mới hiện
- **Nút Dừng** — cancel response đang stream khi AI viết sai hướng (không phải chờ xong 1.000 từ rồi xóa)
- **Status bar** — đang streaming / đã lưu / model vừa dùng / thời gian phản hồi
