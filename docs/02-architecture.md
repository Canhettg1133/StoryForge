# 02 – Kiến trúc lõi (8 khối)

## Tổng quan

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Story Project│  Genre Pack  │   AI Modes   │    Memory    │
├──────────────┼──────────────┼──────────────┼──────────────┤
│Draft Pipeline│ Canon Engine │  Style Lab   │ Revision+QA  │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

---

## Khối 1: Story Project
Lõi tổ chức tác phẩm.

**Thành phần:** Project → Arc → Chapter → Scene → Character → Location → Item → Timeline → Lore/World Notes → Ghi chú riêng

**Mục tiêu:** Tách truyện thành đơn vị nhỏ → dễ viết, quản lý, tham chiếu, AI hiểu đúng context.

---

## Khối 2: Genre Pack
Mỗi thể loại có workflow riêng. Genre Pack không thay đổi giao diện hay cấu trúc dữ liệu — nó chỉ thay đổi *cách AI tư duy* khi viết. Về mặt kỹ thuật, mỗi Genre Pack là một tập file config/JSON.

**Mỗi pack gồm:** template story bible, prompt preset, checklist, scene contract mẫu, QA rules, trope library

| Thể loại | Thành phần đặc trưng | Cách AI tư duy |
|-----------|---------------------|------------------|
| **Fantasy** | World rules, magic system, faction, prophecy, artifact, power scaling | AI luôn hỏi: *"phép này có quy tắc gì? Có hậu quả gì không?"* trước khi viết cảnh dùng phép. Checklist: nhất quán hệ thống sức mạnh, không để nhân vật đột ngột mạnh vô lý |
| **Trinh thám** | Suspects, clue map, red herring, reveal chain, knowledge asymmetry | Clue management: danh sách manh mối, ai biết manh mối nào, còn ẩn không. Suspect board: mỗi nghi phạm có động cơ, cơ hội, alibi. AI giúp tính xem hint đã đủ để reveal chưa |
| **Ngôn tình** | Chemistry arc, emotional beat, misunderstanding control, tension/release | Chemistry tracking: đường cong cảm xúc cặp đôi, cột mốc quan hệ. Mỗi cảnh có mục tiêu cảm xúc rõ. Checklist: nhịp tình cảm không quá nhanh/chậm, tension duy trì đủ lâu |
| **Kinh dị** | Dread build-up, sensory distortion, reveal pacing, fear source, sanity pressure | Tension curve tăng dần, không "xì hơi". Phân biệt kinh dị tâm lý vs gore. Setup phải có payoff, không loose end. Checklist: không giải thích quá nhiều, không hành động phi lý |
| **Sci-fi** | Technology assumptions, world logic, political structure, system consequences | Giữ logic công nghệ nhất quán, hệ quả xã hội của công nghệ |

**Mở rộng:** Genre Pack thiết kế dạng plugin. Sau 4–5 thể loại đầu, có thể thêm: xuyên không, đô thị, võ hiệp, BL/GL, trọng sinh...

---

## Khối 3: AI Modes

| Mode | Chức năng |
|------|-----------|
| **Brainstorm** | Ý tưởng premise, biến thể cốt truyện, gợi ý twist/conflict |
| **Outline** | Xây arc, chia chương/scene, mốc cảm xúc/plot |
| **Scene Writing** | Viết cảnh theo contract, viết tiếp, expand, đối thoại, opening/ending |
| **Rewrite** | Giữ plot đổi prose: cảm xúc hơn, bớt sến, sắc, ngắn, tự nhiên, tối, thơ, điện ảnh |
| **Continuity Check** | Kiểm canon, knowledge leak, timeline, state nhân vật, mâu thuẫn logic |
| **Summary** | Tóm tắt chương/arc/state hiện tại |
| **QA / Editor** | Pacing, POV, đoạn phẳng, info-dump, thoại cứng, lặp |

---

## Khối 4: Memory

> Không có memory, app chỉ là "AI sinh chữ".

Memory là hệ thống lưu trữ "những gì AI phải nhớ" xuyên suốt toàn bộ tác phẩm. Không phải lưu để hiển thị cho tác giả đọc — mà lưu để inject vào prompt mỗi khi AI được gọi.

**Phải nhớ được:** nhân vật, quan hệ, vật phẩm, địa điểm, bí mật, tình tiết, tuyến truyện, giọng văn

### Bốn loại memory

| Loại | Nội dung |
|------|----------|
| **Nhân vật & Quan hệ** | Không chỉ thông tin nhân vật mà còn *trạng thái quan hệ tại từng thời điểm*. Minh và Lệ ở chương 1 là người lạ, chương 5 là đồng minh miễn cưỡng, chương 10 là tin tưởng nhau. AI phải biết đang viết chương nào để xử lý quan hệ đúng. |
| **Vật phẩm & Địa danh** | Thanh kiếm của Minh tả là màu bạc ở chương 2 — AI phải nhớ mãi. Tòa thành Nguyệt Kinh có 4 tháp canh — AI không được tả 3 hay 5. |
| **Giọng truyện (Voice Fingerprint)** | Tổng hợp của: độ dài câu trung bình, tỷ lệ thoại/mô tả, mức nội tâm, cách tả thiên nhiên, từ ngữ đặc trưng. Memory phân tích các chương đã hoàn thành để trích xuất fingerprint giọng văn, rồi inject vào prompt dưới dạng hướng dẫn phong cách. |
| **Cấm kỵ theo chương** | Xem chi tiết bên dưới ↓ |

### Tầng retrieval

| Tầng | Nội dung |
|------|----------|
| **Structural** | Project, chapter, scene, tags, entities |
| **Canon** | Facts, luật thế giới, bí mật, trạng thái, mối quan hệ |
| **Narrative** | Phong cách kể, nhịp, khoảng cách trần thuật, motif |
| **Retrieval** | Khi AI chạy task → chỉ lấy đúng phần cần (cảnh trước, canon, state, style, genre rules, contract) |

### Context Engine — não của Memory

Trước mỗi lần gọi AI, engine tự động ghép:

1. **Tóm tắt chương trước** (3–5 câu) — tạo bằng Flash khi chương đánh dấu hoàn thành, lưu vào metadata
2. **Nhân vật xuất hiện** — nhận diện tên trong đoạn đang viết → pull từ Codex: ngoại hình, tính cách, xưng hô, quan hệ
3. **Thuật ngữ liên quan** — lọc từ điển, inject từ liên quan đến cảnh
4. **Bối cảnh thế giới** — chọn mục phù hợp từ World Bible nếu cảnh nhắc đến địa danh/phép thuật/tổ chức
5. **Yêu cầu người dùng** — prompt thực tế

> Dùng tóm tắt thay vì toàn bộ chương → tiết kiệm token, tránh vượt context window.

### Cấm kỵ theo chương ⭐

Đây là tính năng độc đáo nhất. Tác giả đặt ra các ràng buộc cụ thể:

> *"Nhân vật Minh không được biết cha mình còn sống trước chương 15"*  
> *"Lệ chưa được phép dùng hình thái thứ hai trước chương 20"*  
> *"Không ai biết danh tính thật của Ẩn Nhân trước chương cuối"*

Hệ thống đọc số chương hiện tại, lọc ra danh sách cấm kỵ còn hiệu lực, và inject vào system prompt dưới dạng lệnh âm:

> *"Tuyệt đối không để Minh phát hiện hoặc suy ra rằng cha anh còn sống trong cảnh này."*

### Vòng phản hồi (Feedback Loop) ⭐

Khi Draft Pipeline hoàn thành một chương, Memory phải được cập nhật tự động:
- Nhân vật mới xuất hiện → thêm vào danh sách
- Địa danh mới được nhắc → thêm vào
- Chi tiết mới được thiết lập (màu mắt, vũ khí, trang phục) → lưu lại
- Quan hệ thay đổi → cập nhật trạng thái
- Bí mật được hé lộ → đánh dấu cấm kỵ đã vô hiệu

> **Không có vòng phản hồi này, Memory sẽ stale dần sau mỗi chương và mất tác dụng.**

### Xưng hô tiếng Việt 🇻🇳

Đây là điểm **app nước ngoài không xử lý được**.

Ví dụ: nhân vật Minh xưng "ta" với kẻ dưới, "tiền bối" với người trên. Nếu không inject vào prompt, AI sẽ tự chọn đại ("tôi", "anh") → mất tone nhân vật.

**Giải pháp:** Lưu trường **"Cách xưng hô"** trong Codex nhân vật, inject mỗi lần nhân vật xuất hiện.

---

## Khối 5: Draft Pipeline

Đường ra của sản phẩm. Đưa tác giả đi từ ý tưởng mơ hồ → file có thể đọc được.

```
Outline → Scene Goals → First Draft → Rewrite → Polish
```

> Có pipeline → AI trở thành công cụ tăng tốc quy trình, không làm lười tổ chức.

### Bước 1 — Outline
- **Đầu vào:** ý tưởng chương (có thể chỉ 1–2 câu)
- **Xử lý:** AI hỏi một loạt câu hỏi dựa trên Genre Pack: cảnh xảy ra ở đâu, ai xuất hiện, xung đột là gì, cảnh kết thúc thế nào, điều gì thay đổi
- **Đầu ra:** outline 5–8 điểm cho chương
- **Exit criteria:** tác giả approve outline

### Bước 2 — Scene Goals
- **Đầu vào:** outline đã approve
- **Xử lý:** AI viết scene goal cho từng cảnh: *"Cảnh này cần: (1) Minh lần đầu nghi ngờ Lệ, (2) người đọc biết trước Minh rằng Lệ đang che giấu điều gì, (3) căng thẳng tăng nhưng chưa vỡ"*
- **Đầu ra:** danh sách scene goals cụ thể
- **Exit criteria:** tác giả xác nhận goals đúng ý định

### Bước 3 — First Draft
- **Đầu vào:** scene goals + full context từ Memory
- **Xử lý:** AI viết bản thảo đầu, không cần hoàn hảo, cần đủ nội dung. Tác giả có thể dừng giữa chừng, chỉnh trực tiếp, yêu cầu viết lại đoạn cụ thể
- **Đầu ra:** bản thảo đủ số từ mục tiêu
- **Exit criteria:** đạt ~80% số từ mục tiêu, tất cả scene goals được đề cập

### Bước 4 — Rewrite
- **Đầu vào:** first draft có thể còn thô, thiếu cảm xúc, chưa đúng giọng văn
- **Xử lý:** AI đọc lại toàn bộ, đề xuất các đoạn cần rewrite kèm lý do. Tác giả chọn áp dụng hoặc bỏ qua từng đề xuất
- **Đầu ra:** bản thảo được cải thiện
- **Exit criteria:** tác giả không còn đoạn nào muốn rewrite

### Bước 5 — Polish
- **Đầu vào:** bản thảo đã rewrite
- **Xử lý:** AI chạy checklist cuối: lỗi liên tục (continuity), câu quá dài/ngắn, từ lặp, lỗi logic, cách xưng hô sai. Ra danh sách flag cụ thể với số dòng
- **Đầu ra:** chương hoàn chỉnh, sẵn sàng export
- **Exit criteria:** không còn flag nào chưa xử lý

### Output format
EPUB · DOCX · PDF · Markdown · Plain text (Wattpad, AO3, các nền tảng Việt)

---

## Khối 6: Canon Engine ⭐

Bộ luật trung tâm của truyện – lưu tất cả "fact có hiệu lực".

**Một fact gồm:** loại, nội dung, nguồn scene, hiệu lực từ–đến, độ chắc chắn, ai biết, public/secret, có thay đổi sau không

**Loại fact:** `world` · `character` · `knowledge` · `relationship` · `object` · `state` · `event` · `limitation/rule`

**Ví dụ:**
- An bị thương tay trái từ scene 12
- Lan chưa biết Minh là phản diện trước ch.14
- Ma pháp lửa không dùng được dưới nước

**Khi AI viết:** lấy canon → kiểm mâu thuẫn → cảnh báo lộ bí mật sai / hành động sai state / phá world rule

> **Lý do người dùng ở lại:** app không chỉ viết, mà giữ truyện cho họ.

---

## Khối 7: Style Lab ⭐

> Không fine-tune model. Dùng style traits + exemplar snippets.

### Tổng quan

Upload file (txt/md/docx/epub/pdf) hoặc dùng chương đã viết → phân tích → trích đặc điểm → tạo style profile → dùng để viết tiếp/rewrite.

### 3 chế độ học

| Chế độ | Mô tả | Ưu tiên |
|---------|--------|----------|
| **A. Từ tác phẩm hiện tại** | Đã viết 20 chương → học để viết tiếp chương 21–22 cho đúng giọng | ⭐ Quan trọng nhất |
| **B. Từ mẫu văn phong** | Tải 3 file truyện yêu thích → tạo reference style pack | Hữu ích |
| **C. Từ bài tự viết** | Tải 5 đoạn do chính mình viết → làm chuẩn khi rewrite | Cực hữu ích |

### 4 lớp Style

| Lớp | Mô tả |
|-----|-------|
| Story Voice | Giọng chung tác phẩm |
| POV Voice | Giọng theo nhân vật nhìn |
| Character Speech | Giọng thoại riêng từng nhân vật |
| Genre Modifier | Điều chỉnh theo thể loại/arc |

### Style DNA — phân tích được gì

**Văn phong câu chữ:**
- Độ dài câu trung bình, câu ngắn hay dài
- Tỷ lệ thoại / miêu tả / hành động
- Nhiều nội tâm hay nhiều hành động
- Từ ngữ đơn giản hay cầu kỳ
- Mức cảm xúc: mạnh / lạnh
- Mức hài hước / đen tối / trữ tình
- Kiểu mở đầu đoạn, kết đoạn
- Mức "show, don't tell"
- Motif, ẩn dụ đặc trưng

**Cách kể chuyện (Narrative Profile):**
- Cách mở chương
- Cách vào cảnh
- Cách build tension
- Cách chuyển cảnh
- Cách nhả thông tin
- Cách gài twist
- Cách kết chương (cliffhanger hay lắng)

**Giọng nhân vật:**
- Nhân vật A nói ngắn, lạnh, cộc
- Nhân vật B nói vòng, mềm, có ẩn ý
- Nhân vật C hay châm biếm
- Narrator của truyện có giọng gì

**Ví dụ output Style DNA:**
```
văn phong ngắn, sắc, nhịp nhanh
thoại chiếm 40%
nội tâm kín, ít nói thẳng cảm xúc
hay dùng ẩn dụ về ánh sáng/mưa
kết đoạn thường có dư âm nhẹ
```

### Pipeline xử lý Style

```
1. Parse file → tách chương/cảnh/thoại/miêu tả/narrator
2. Trích xuất style features → tạo profiles
3. Chọn exemplar → lấy vài đoạn mẫu tiêu biểu nhất
4. Prompt bằng profile + exemplar → khi AI viết
```

### 3 tính năng chính

| Tính năng | Mô tả |
|-----------|-------|
| **Upload to Learn** | Tải file lên để học văn phong |
| **Rewrite in Style** | Chọn đoạn đang viết → viết lại theo văn phong đã học. Giữ plot, giữ ý, đổi prose |
| **Continue in Style** | Viết tiếp chương mới giữ cùng giọng đã học |

### Style Strength

Khi dùng style đã học, người dùng chọn mức độ:

| Mức | Hiệu quả |
|------|----------|
| 0% | Không dùng |
| 25% | Gợi nhẹ |
| 50% | Khá rõ |
| 75% | Bám sát |
| 90% | Rất sát |

### Style Mixer

Trộn nhiều đặc điểm phong cách:

```
60% giọng truyện hiện tại
25% nhịp nhanh hơn
15% thoại tự nhiên hơn
```

Hoặc:

```
giữ giọng gốc
+ tăng chất điện ảnh
+ bớt sến 20%
+ tăng subtext thoại
```

### Model phân công cho Style

| Flash | Pro |
|-------|-----|
| Phân tích sơ bộ file | Rút style DNA sâu |
| Tóm tắt style | Phân tích giọng nhân vật |
| Chia cảnh/chương | Rewrite theo style |
| Trích đặc điểm nhanh | Viết tiếp giữ voice |
| Gợi ý style profile | So sánh độ giống với style mẫu |

### Nguyên tắc đạo đức

- ✅ Học đặc điểm phong cách tổng quát
- ✅ Học từ chính tác phẩm của người dùng
- ✅ Dùng để giữ consistency
- ❌ Không sao chép nguyên văn
- ❌ Không tái tạo quá sát một tác giả cụ thể

> *"Inspired by style traits, không phải clone giọng người khác."*

---

## Khối 8: Revision + QA ⭐

**Revision Lab:**
- Diff so sánh cũ/mới theo câu/đoạn
- Rewrite mức nhẹ/vừa/mạnh
- Phát hiện: lặp, prose AI rõ, kể nhiều hơn diễn
- Tăng subtext, tension, rút gọn, tự nhiên hơn

**QA Bot:**
- Pacing · POV consistency · Dialogue similarity · Emotional flatness
- Exposition overload · Unresolved setup · Weak payoff
- Info leak too early · Deus ex machina · Trope imbalance · Chapter intent missing
