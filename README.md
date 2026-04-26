# StoryForge AI

StoryForge AI là workspace viết truyện dài dành cho tác giả muốn dùng AI nhưng vẫn giữ được canon, mạch truyện, giọng văn và trạng thái nhân vật qua nhiều chương. Dự án không chỉ là một editor có thêm khung chat, mà là một hệ thống quản lý truyện: từ lên ý tưởng, dựng Story Bible, quản lý nhân vật, lập outline, viết chương, kiểm tra canon, phân tích bản thảo, dịch truyện và đồng bộ dữ liệu.

Điểm khác biệt của StoryForge nằm ở cách app đặt AI vào trong cấu trúc truyện có sẵn. AI không được "generate mù"; mỗi tác vụ đều được nạp đúng bối cảnh dự án, hồ sơ nhân vật, outline chương, live canon, giới hạn thể loại, style guide và những điều chưa được phép xảy ra.

## StoryForge giải quyết vấn đề gì?

Khi viết truyện dài bằng AI, các lỗi thường gặp là:

- AI quên nhân vật đang ở trạng thái nào.
- Nhân vật đổi tính cách, đổi cách xưng hô hoặc tự nhiên biết thông tin chưa từng biết.
- Chương mới lệch khỏi đại cục, reveal quá sớm hoặc bỏ quên plot thread.
- Lore, địa danh, vật phẩm, phe phái bị dùng sai.
- Văn phong bị máy móc, sáo, lặp cụm từ và mất nhịp.
- Tác giả phải tự copy quá nhiều context vào prompt.

StoryForge xử lý các vấn đề đó bằng một workflow canon-first: mọi thứ xoay quanh dự án truyện, Story Bible, outline, chapter state, canon projection và prompt builder nhiều lớp.

## Tính năng nổi bật

### Dashboard và Project Wizard

- Tạo, mở và quản lý nhiều dự án truyện.
- Wizard tạo truyện mới với premise, thể loại, tone, content mode, số chương mục tiêu và cấu hình ban đầu.
- Hỗ trợ nhiều kiểu dự án như truyện gốc, fanfic, rewrite hoặc translation context.
- Có thể tạo project từ Canon Pack sau khi phân tích một bộ truyện nguồn.

### Story Bible

Story Bible là trung tâm định nghĩa tác phẩm:

- Tổng quan truyện, premise, chủ đề, thể loại và định hướng sáng tác.
- Macro Arc và milestone lớn cho toàn bộ truyện.
- Quản lý nhân vật, địa điểm, vật phẩm, thuật ngữ thế giới.
- Draft card để duyệt entity AI đề xuất trước khi đưa vào canon.
- Chapter Anchor Editor để neo bắt buộc nhân vật, địa điểm, vật phẩm, thuật ngữ hoặc beat quan trọng vào từng chương.
- Canon Inspector để kiểm tra những gì đang được xem là sự thật trong dự án.

### Character Hub

Nơi quản lý dàn nhân vật như một hệ thống sống:

- Hồ sơ nhân vật, vai trò, trạng thái hiện tại, mô tả, quan hệ và ghi chú.
- Hỗ trợ tạo nhiều nhân vật bằng AI, duyệt từng draft và chỉnh trước khi lưu.
- Theo dõi trạng thái như sống/chết/mất tích, vị trí, bí mật, mục tiêu, quan hệ và đặc điểm giọng nói.
- Hạn chế lỗi nhân vật bị viết sai vai, sai trạng thái hoặc nói/biết điều không khớp canon.

### World Lore

Không gian quản lý thế giới truyện:

- Địa điểm, phe phái, vật phẩm, khái niệm và thuật ngữ riêng.
- Dùng làm nguồn context cho prompt viết chương.
- Giúp AI không bịa lại tên, nguồn gốc, công dụng hoặc quy tắc thế giới.

### Outline Board và Arc Generation

StoryForge có hệ thống lập kế hoạch theo arc/chương:

- Tạo outline theo arc, số chương, mục tiêu và đại cục.
- Sinh dàn ý hàng loạt cho nhiều chương.
- Sinh draft chương hàng loạt từ outline đã duyệt.
- Commit outline hoặc draft trực tiếp vào project.
- Kiểm tra outline so với Macro Arc Contract và Chapter Anchors.
- Lưu metadata quan trọng như featured characters, primary location, key events, required factions/objects/terms và state delta.
- Khi viết chương từ outline, AI được nạp đúng context của chương đó thay vì fallback nhầm sang chương khác.

### Scene Editor

Editor là trung tâm viết truyện:

- Tiptap editor với đếm chữ và trải nghiệm soạn thảo hiện đại.
- Quản lý chương/cảnh, draft text, final text và trạng thái hoàn thành.
- AI Sidebar hỗ trợ continue, expand, rewrite, scene draft, summarize, continuity check và free prompt.
- Prose buffer và bridge memory giúp đoạn mới nối mượt với đoạn trước.
- Khi hoàn thành chương, app có thể chạy canonicalization để cập nhật canon và phát hiện vấn đề.

### Canon Truth và Live Canon

Canon Truth là lớp kiểm soát sự thật của truyện:

- Canon hóa nội dung chương sau khi viết.
- Trích xuất thay đổi trạng thái nhân vật, sự kiện, entity mới và mâu thuẫn tiềm năng.
- Kiểm tra nhân vật đã chết/mất tích nhưng vẫn xuất hiện chủ động.
- Cảnh báo khi trạng thái hiện tại của nhân vật bị bỏ qua.
- Hỗ trợ AI adjudication để giảm false positive.
- Có cơ chế rebuild/purge canon state khi nội dung chương thay đổi.

### Prompt Manager và Story Creation Settings

StoryForge cho phép kiểm soát cách AI viết:

- Cấu hình prompt theo dự án.
- Quản lý system prompt, style rule, task instruction và các lớp prompt bảo vệ JSON contract.
- Genre-aware prompt: fantasy, romance, mystery, fanfic, rewrite và các content mode tùy dự án.
- Anti-AI prose discipline: hạn chế văn sáo, ép hành động cụ thể, giữ nhịp đoạn và voice nhân vật.
- Custom prompt vẫn được bảo vệ bằng các output contract bắt buộc cho task quan trọng.

### Model Router và AI Provider

App có router AI theo tác vụ:

- Hỗ trợ nhiều provider/model.
- Có chế độ chất lượng: fast, balanced, best.
- Cho phép chọn provider mặc định trong Settings.
- Task quan trọng như viết chương, canon repair, arc outline hoặc audit có thể được route sang model phù hợp hơn.

README public chỉ mô tả khả năng ở mức sản phẩm. Chi tiết cấu hình provider, key, endpoint và môi trường runtime nên nằm trong tài liệu nội bộ hoặc file cấu hình local, không đưa lên README public.

### Project Chat

Chat theo dự án, không phải chat rời rạc:

- Kế thừa cấu hình provider/model của project.
- Hỏi đáp với ngữ cảnh truyện.
- Giữ thread/payload route để không bị đổi provider ngoài ý muốn.
- Phù hợp để brainstorm, hỏi canon, kiểm tra ý tưởng hoặc nhờ AI phân tích nhanh.

### Translator

Module dịch truyện riêng:

- Có route translator độc lập.
- Persistent translator host giúp giữ trạng thái khi điều hướng trong app.
- Có trang hướng dẫn cấu hình dịch.
- Phù hợp để dịch hoặc xử lý văn bản nguồn trước khi đưa vào Lab/Project.

### Lab Lite

Lab Lite là luồng phân tích truyện nguồn và tạo Canon Pack:

- Import các định dạng văn bản phổ biến.
- Tách chương, lưu metadata theo hướng local-first.
- Scout chapter để tạo digest, phát hiện nhân vật, sự kiện, arc và lore.
- Deep analysis theo preset hoặc chọn chương thủ công.
- Arc Mapper để nhận diện cấu trúc truyện.
- Canon Pack Builder để gom sự thật từ truyện nguồn.
- Readiness check trước khi materialize vào project.
- Tạo fanfic project hoặc link Canon Pack vào project hiện tại.

### Corpus Lab và Analysis Viewer

Corpus Lab là phòng phân tích bản thảo/corpus nâng cao:

- Upload và parse corpus lớn.
- Chia chunk, preview chương, rechunk và clean export.
- Incident-first analysis để phát hiện sự kiện, cụm incident, rủi ro continuity.
- Knowledge view, timeline view, mind map, story graph và character graph.
- Review queue cho các vấn đề cần tác giả duyệt.
- Search, filter, compare mode, annotation và export kết quả.
- Backend jobs hỗ trợ các phân tích dài qua queue.

### Cloud Sync

StoryForge có lớp đồng bộ/backup tùy chọn:

- Đồng bộ dữ liệu dự án khi được cấu hình.
- Auto sync agent trong layout.
- Backup/snapshot project.
- Dữ liệu viết vẫn ưu tiên local-first; sync là lớp bổ sung.

README public không liệt kê chi tiết dịch vụ, endpoint, token hoặc biến môi trường nhạy cảm.

### Local-first storage và backend jobs

- Lưu dữ liệu soạn thảo theo hướng local-first.
- Có backend jobs cho parsing, analysis và các tác vụ dài.
- Tách phần viết chính và phần phân tích nặng để app mượt hơn.

### Mobile-aware UI

- Layout desktop với sidebar đầy đủ.
- Mobile project shell cho màn hình nhỏ.
- Translator và Settings có flow quay lại riêng trên mobile.
- Editor/project route giữ trạng thái khi chuyển tab trong app.

## Kiến trúc AI

StoryForge dùng prompt builder nhiều lớp thay vì prompt đơn:

1. System identity: AI là đồng biên tập, ưu tiên canon và continuity.
2. Task instruction: mỗi tác vụ có luật riêng.
3. Genre constraints: luật theo thể loại và content mode.
4. Story canon context: chỉ nạp sự thật liên quan.
5. Character context gate: chỉ nạp nhân vật cần thiết, hoặc nạp toàn bộ khi task lập dàn ý cần biết tình trạng cast.
6. Chapter/scene blueprint: purpose, summary, anchors, required entities và state delta.
7. Style/prose discipline: giọng văn, nhịp đoạn, blacklist, voice nhân vật.
8. Output contract: JSON schema hoặc prose format bắt buộc.

Nhờ vậy AI có thể viết theo task mà vẫn bám project, không tự ý biến nhân vật thành vai trò mới hoặc phá canon chỉ vì prompt trước mắt thiếu ngữ cảnh.

## Công nghệ sử dụng

- React
- Vite
- React Router
- Zustand
- IndexedDB/local-first storage
- Tiptap editor
- Express backend jobs
- PostgreSQL cho các flow phân tích dài
- Supabase/cloud sync tùy chọn
- Vitest

## Cài đặt

Yêu cầu:

- Node.js 18+
- npm

Clone repository:

```bash
git clone https://github.com/Canhettg1133/StoryForge.git
cd StoryForge
```

Cài dependencies:

```bash
npm install
```

Chạy frontend:

```bash
npm run dev
```

Build production:

```bash
npm run build
```

Preview build:

```bash
npm run preview
```

## Cấu hình local

Repo public không commit file cấu hình cá nhân. Khi chạy local, tạo file cấu hình riêng từ mẫu có sẵn trong repo và tự nhập provider/model/cloud/database theo môi trường của bạn.

Các nguyên tắc an toàn:

- Không commit file cấu hình local.
- Không commit API key, token, URL nội bộ hoặc thông tin database thật.
- Không đưa endpoint riêng hoặc quota/provider cá nhân vào README public.
- Nếu cần tài liệu cấu hình chi tiết, đặt ở tài liệu private hoặc ghi chú local.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm test
npm run db:start
npm run db:stop
npm run backend:start
npm run jobs:server
```

## Kiểm thử

Chạy toàn bộ test:

```bash
npm test
```

Một số test integration cần database local. Nếu chưa chạy database, các test liên quan job/analysis có thể fail vì không kết nối được môi trường local.

Build production:

```bash
npm run build
```

## Trạng thái dự án

StoryForge đang là sản phẩm đang phát triển mạnh, đã có nhiều module production-like nhưng vẫn còn các surface thử nghiệm được kiểm soát bằng feature flag:

- Core writing flow: Dashboard, Story Bible, Character Hub, World Lore, Outline Board, Scene Editor, Canon Truth, Settings.
- AI flow: Prompt Manager, Model Router, Project Chat, Arc Generation, batch outline/draft.
- Advanced lab flow: Lab Lite, Corpus Lab, Analysis Viewer, backend jobs.
- Sync flow: Cloud Sync tùy chọn.

## Tầm nhìn

StoryForge hướng tới việc trở thành Story OS cho tác giả truyện dài: nơi tác giả có thể đi từ ý tưởng ban đầu đến outline, Story Bible, bản thảo chương, kiểm tra canon, phân tích bản nháp, dịch/chuyển thể và hoàn thiện tác phẩm mà không đánh mất giọng văn hay logic truyện.

Lõi của sản phẩm không phải là "AI viết thay". Lõi là một hệ thống truyện đủ chặt để AI trở thành trợ lý viết, biên tập viên, kiểm tra continuity và người giữ nhịp cho tác phẩm dài hơi.
