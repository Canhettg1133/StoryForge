# StoryForge Lab Lite / Canon Engine Plan

## MVP Phase 0-3 Locked Scope

Ngay trong dot trien khai dau, ten tinh nang chot la `Lab Lite`.

Route/page se them:

```text
/project/:projectId/lab-lite
src/pages/Lab/LabLite/LabLite.jsx
src/pages/Lab/LabLite/LabLite.css
```

Navigation:

```text
Sidebar label: Lab Lite
Gate: PRODUCT_SURFACE.showLabLite
Default local/dev: bat, tru khi VITE_SHOW_LAB_LITE=false
Vi tri: gan Narrative Lab va Corpus Lab
```

Pham vi da chot cho Phase 0-3:

- Phase 0: docs/source of truth, ten goi, route, thong diep san pham.
- Phase 1: browser-only import TXT/MD/DOCX neu mammoth browser chay duoc, tach chuong, preview, rename, split thu cong, luu IndexedDB rieng.
- Phase 2: AI Chapter Scout bang sample dau/giua/cuoi chuong, queue concurrency 1-4, pause/cancel/retry, filter theo signal.
- Phase 3: Arc Mapper tu scout results compact, khong doc lai full chapter, luu arc local.

Ranh gioi trong MVP nay:

- Khong dung `corpusApi`.
- Khong can jobs server.
- Khong sua schema `StoryForgeDB`; Lab Lite dung `StoryForgeLabLiteDB` rieng.
- Khong ghi vao Story Bible.
- Khong thay Corpus Lab backend hay Narrative Pipeline V3.
- Khong hua AI dam bao canon 100%; chi noi AI goi y phat hien lech canon.

Thuat ngu UI da chot:

```text
Lab Lite
AI Canon Review
Kiem tra lech canon
Canon Pack
Nap lieu
Dong nhan / viet lai theo canon
```

## Muc Tieu

Xay dung mot tuyen Lab Lite chay tren trinh duyet, deploy tot tren Vercel, khong bat buoc jobs server/backend, tan dung API key cua nguoi dung va Gemini Proxy/Gemini Direct/Ollama hien co.

Tinh nang trung tam:

```text
Upload truyen
-> Tach chuong
-> AI quet nhanh bang nhieu luot goi model
-> Goi y chuong/arc dang nap sau
-> AI phan tich sau
-> Tao Canon Pack nhieu tang
-> Dung cho viet dong nhan / viet lai / viet tiep / dich theo ngu canh
```

Nguyen tac san pham:

- Khong hua "AI dam bao khong pha canon 100%".
- Chi goi la "AI Canon Review" hoac "Kiem tra lech canon".
- Khong dung keyword cung de tim chuong quan trong. Truyen qua da dang, keyword de sot va sai ngu canh.
- Dung AI lam Chapter Scout, Arc Mapper va Deep Analyzer.
- Dung Gemini 1M input de doc nhieu chuong va tao bo nho ban dau, khong dung 1M input de nhet ca truyen vao moi lan viet.
- Giu Corpus Lab backend hien tai. Lab Lite la tuyen song song, browser-only, khong thay the ngay Narrative Pipeline V3.

## Nen Tan Dung Tu Code Hien Tai

Project hien tai da co nhieu nen tang phu hop:

- `src/services/ai/client.js`: da co Gemini Proxy, Gemini Direct, Ollama, key cua nguoi dung, streaming, fallback, NSFW mode.
- `src/services/ai/contextEngine.js`: da co retrieval packet, Story Bible context, Canon Facts, entity state, arcs, macro arcs, pacing.
- `src/services/db/database.js`: Dexie local, da co project/chapter/scene/characters/locations/objects/worldTerms/canonFacts/relationships/timeline.
- `src/features/projectContentMode/projectContentMode.js`: da co che do Thuong / 18+ / ENI.
- `src/stores/projectStore.js`: da co createProject, createChapter, updateChapter, runChapterCompletion, canon projection.
- `src/pages/Lab/CorpusLab`: da co UI upload/tach chuong/xem chuong/export/analysis, nhung hien tai dang phu thuoc `corpusApi` va jobs server.
- `src/services/viewer/viewerDbService.js`: da co logic materialize ket qua analysis vao project local.

Ket luan kien truc: khong nen viet lai tat ca. Nen them mot tuyen `Lab Lite` dung lai AI client, Dexie, parser/export neu phu hop, va sau do noi vao Story Bible/Canon/Context Engine.

## Kien Truc De Xuat

```text
Vercel
  - host React/Vite app
  - khong can jobs server cho Lab Lite

Browser
  - doc file bang File API
  - tach chuong
  - luu corpus/canon pack vao IndexedDB
  - goi AI bang key/proxy cua nguoi dung
  - chay queue phan tich co cancel/resume co ban

AI Provider
  - Gemini Proxy: uu tien cho nhieu luot goi, quet rong
  - Gemini Direct: dung key rieng
  - Ollama: optional, phu hop local

Backend/jobs server
  - giu lai cho Corpus Lab Deep/Narrative Pipeline V3
  - khong bat buoc trong Lab Lite
```

## Du Lieu Loi: Canon Pack Nhieu Tang

Canon Pack khong duoc la mot cuc text khong lo. Phai chia tang de Context Engine lay dung phan can.

```text
Global Canon
- tom tat toan truyen
- theme
- xung dot lon
- luat the gioi
- nhan vat chinh
- timeline lon
- diem neo canon lon
- dieu cam pha canon lon

Arc Canon
- danh sach arc
- pham vi chuong
- bien co chinh
- trang thai nhan vat trong arc
- plot hook va xung dot dang mo

Character Canon
- ho so nhan vat
- vai tro, phe, trang thai song/chet/mat tich
- tinh cach, muc tieu, noi so, diem yeu
- nang luc, gioi han, bi mat
- giong thoai
- thay doi qua cac giai doan

Relationship Canon
- quan he nhan vat
- moc thay doi quan he
- ai biet bi mat gi
- rang buoc nhay cam neu user bat 18+

Chapter Canon
- tom tat chuong
- su kien chinh
- nhan vat xuat hien
- du kien moi
- trang thai thay doi
- evidence/source chapter

Style Canon
- van phong goc
- nhip ke
- tone
- ty le thoai/mieu ta/noi tam/hanh dong
- cach mo va ket chuong

Adult Canon neu user bat
- muc truong thanh
- quan he nhay cam
- tone canh than mat
- gioi han/cam ky do user kiem soat
- canh bao noi dung can duyet lai

Canon Restrictions
- nhung dieu khong duoc pha
- nhung su kien da xay ra
- nhung vat pham da mat/bi huy
- nhung bi mat chua bi lo o thoi diem X

Creative Gaps
- khoang trong co the sang tao
- qua khu chua ke
- khoang thoi gian trong giua cac arc
- nhan vat phu co the khai thac
- vung dat/thiet lap chi moi duoc nhac den

Canon Index
- chuong nao co nhan vat nao
- chuong nao co reveal nao
- chuong nao co thay doi quan he
- chuong nao co worldbuilding
- chuong nao nen nap sau
```

## Phase 0: Chot Pham Vi Va Ten Goi

Muc tieu: chot khung san pham truoc khi code.

Chi nen lam trong phase nay:

- Chot ten tinh nang: `Lab Lite`, `Canon Import`, `Fanfic Forge`, hoac `StoryForge Canon Engine`.
- Chot flow onboarding bang cau hoi tu nhien:

```text
Ban muon lam gi?
- Toi muon viet truyen moi
- Toi co truyen/tai lieu muon dua vao StoryForge
- Toi muon viet tiep / viet lai / viet dong nhan
- Toi muon dich truyen
```

- Chot thuat ngu UI:

```text
AI Canon Review
Kiem tra lech canon
Canon Pack
Nap lieu
Dong nhan / viet lai theo canon
```

- Chot thong diep: "AI goi y phat hien lech canon", khong ghi "dam bao khong pha canon".

Khong lam trong phase nay:

- Khong code UI lon.
- Khong sua database.
- Khong thay Corpus Lab backend hien tai.
- Khong them mode dong nhan vao editor.

Ket qua bat buoc:

- Mot file docs chot ten, flow, pham vi MVP.
- Danh sach route/page se them.

## Phase 1: Browser Corpus Import MVP

Muc tieu: tai file len va tach chuong hoan toan tren browser.

Chi nen lam trong phase nay:

- Tao service doc file local:

```text
src/services/labLite/fileReader.js
src/services/labLite/chapterParser.js
src/services/labLite/tokenEstimator.js
```

- Ho tro file ban dau:

```text
.txt
.md
.docx neu co the dung mammoth trong browser
```

- PDF va EPUB de sau neu parser phuc tap.
- Tao store local:

```text
src/stores/labLiteStore.js
```

- Luu vao Dexie/localStorage cac thong tin:

```text
corpusId
title
sourceFileName
chapters[]
chapter index/title/content/wordCount/estimatedTokens
createdAt/updatedAt
```

- Tao UI rieng:

```text
src/pages/Lab/LabLite/LabLite.jsx
```

- UI can co:

```text
UploadDropzone
Danh sach chuong
Preview chuong
Sua ten/tach lai chuong thu cong
Thong ke word/token
```

Khong lam trong phase nay:

- Khong goi AI.
- Khong tao Canon Pack.
- Khong fanfic.
- Khong save vao Story Bible.
- Khong dung `corpusApi`.

Ly do bat buoc gioi han: neu upload/tach chuong chua on dinh, cac phase AI phia sau se rac.

Ket qua bat buoc:

- Upload file va tach chuong chay offline tren browser.
- Reload page van giu corpus local.
- Co test cho parser chuong.

## Phase 2: AI Chapter Scout

Muc tieu: dung AI quet nhanh tung chuong bang sample, khong dung keyword cung.

Chi nen lam trong phase nay:

- Tao prompt/service:

```text
src/services/labLite/chapterScout.js
src/services/labLite/prompts/chapterScoutPrompt.js
```

- Moi chuong gui mot goi nho:

```text
title
chapterIndex
totalChapters
wordCount
doan dau
mot hoac vai doan giua
doan cuoi
```

- AI tra ve JSON:

```json
{
  "chapterIndex": 42,
  "priority": "low|medium|high|critical",
  "recommendation": "skip|light_load|deep_load",
  "detectedSignals": [
    "new_character",
    "relationship_shift",
    "worldbuilding",
    "reveal",
    "state_change",
    "adult_sensitive",
    "ending_hook"
  ],
  "reason": "Ly do ngan, dua tren noi dung da doc.",
  "confidence": 0.0
}
```

- Co queue xu ly nhieu chuong:

```text
parallel nho 2-4 request
co pause/cancel
co retry
co progress
cho phep chay tiep tu chuong dang do
```

- Cho user chon muc tieu scout:

```text
Viet dong nhan
Viet tiep sau ending
Nap lieu 18+/truong thanh
Dich truyen
Tao Story Bible
```

- Neu user bat 18+/ENI trong project/content mode, scout duoc phep danh dau `adult_sensitive`. Neu khong bat, chi goi la `sensitive_or_relationship_heavy`.

Khong lam trong phase nay:

- Khong phan tich sau.
- Khong gom arc.
- Khong tao Canon Pack.
- Khong sua Story Bible.
- Khong viet dong nhan.

Ly do bat buoc gioi han: Chapter Scout la lop chon loc. No phai nhanh, re, va de user tin vi co ly do ro.

Ket qua bat buoc:

- Sau khi quet, UI hien danh sach chuong voi muc uu tien va ly do.
- User co the filter:

```text
Nen nap sau
Co reveal
Co thay doi quan he
Co worldbuilding
Co noi dung truong thanh neu bat
```

## Phase 3: Arc Mapper

Muc tieu: gom cac ket qua Chapter Scout thanh arc/mach truyen de user khong phai nhin 1000 chuong roi tu chon.

Chi nen lam trong phase nay:

- Tao service:

```text
src/services/labLite/arcMapper.js
src/services/labLite/prompts/arcMapperPrompt.js
```

- Input la danh sach scout results, khong can full text.
- AI tra ve:

```json
{
  "arcs": [
    {
      "id": "arc_001",
      "title": "Ten arc",
      "chapterStart": 1,
      "chapterEnd": 38,
      "summary": "Tom tat ngan",
      "importance": "low|medium|high|critical",
      "whyLoad": "Ly do nen nap sau",
      "recommendedDeepChapters": [1, 7, 18, 36]
    }
  ]
}
```

- UI hien:

```text
Arc timeline
Arc nao nen nap sau
Chuong dai dien cua tung arc
Nut chon ca arc / chon tung chuong
```

Khong lam trong phase nay:

- Khong doc lai full chapter.
- Khong tao Canon Pack.
- Khong fanfic.
- Khong Canon Review.

Ly do bat buoc gioi han: Arc Mapper chi la lop dieu huong. Neu no bi tron voi deep analysis, UX se cham va kho debug.

Ket qua bat buoc:

- User nhin duoc ban do arc va duoc AI goi y chuong/arc nen phan tich sau.

## Phase 4: Deep Analysis Theo Chuong/Arc

Muc tieu: phan tich sau nhung chuong/arc da chon de tao du lieu thuc cho Canon Pack.

Chi nen lam trong phase nay:

- Tao service:

```text
src/services/labLite/deepAnalyzer.js
src/services/labLite/prompts/deepAnalysisPrompt.js
```

- Nguon chon:

```text
AI de xuat tu Scout/Arc Mapper
User chon chuong thu cong
User chon arc
User chon "phan tich toan bo" neu token phu hop
```

- Tan dung Gemini 1M input theo cach:

```text
Neu arc/chapter set nam trong gioi han -> gui mot lan lon.
Neu qua lon -> chia batch theo arc/chapter.
```

- Output moi batch:

```text
chapterCanon[]
characterUpdates[]
relationshipUpdates[]
worldUpdates[]
timelineEvents[]
styleObservations[]
adultCanonNotes[] neu bat
canonRestrictions[]
creativeGaps[]
uncertainties[]
sourceEvidence[]
```

- Co progress, cancel, retry, partial save.

Khong lam trong phase nay:

- Khong materialize vao Story Bible.
- Khong viet fanfic.
- Khong Canon Review.
- Khong thay doi Context Engine.

Ly do bat buoc gioi han: Deep Analysis phai tao artifact sach truoc, chua nen ghi vao project ngay de tranh lam ban Story Bible.

Ket qua bat buoc:

- Co ket qua deep analysis luu local theo corpus.
- UI cho user xem va duyet ket qua.

## Phase 5: Canon Pack Builder

Muc tieu: hop nhat ket qua Scout, Arc Mapper, Deep Analysis thanh Canon Pack nhieu tang.

Chi nen lam trong phase nay:

- Tao service:

```text
src/services/labLite/canonPackBuilder.js
src/services/labLite/canonPackSchema.js
src/services/labLite/canonPackRepository.js
```

- Schema bat buoc:

```text
globalCanon
arcCanon[]
characterCanon[]
relationshipCanon[]
chapterCanon[]
styleCanon
adultCanon neu bat
canonRestrictions[]
creativeGaps[]
canonIndex
uncertainties[]
metadata
```

- Tao UI:

```text
Canon Pack Preview
Duyet/sua/xoa item
Danh dau "tin cay" / "can xac nhan"
```

- Co nut export JSON.

Khong lam trong phase nay:

- Khong dua vao Story Bible tu dong.
- Khong viet dong nhan.
- Khong Canon Review tren chuong moi.

Ly do bat buoc gioi han: Canon Pack la san pham chinh cua Lab Lite. Phai inspect duoc truoc khi dung cho viet.

Ket qua bat buoc:

- Canon Pack duoc luu local.
- User co the mo lai, doc, sua, export.

## Phase 6: Materialize Canon Pack Vao Project

Muc tieu: dua Canon Pack vao he thong co san cua StoryForge.

Chi nen lam trong phase nay:

- Tao service:

```text
src/services/labLite/materializeCanonPack.js
```

- Map sang bang hien co:

```text
characters -> db.characters
locations -> db.locations
objects -> db.objects
terms -> db.worldTerms
relationships -> db.relationships
timeline -> db.timelineEvents hoac story_events neu phu hop
canonRestrictions -> db.canonFacts / taboos
styleCanon -> stylePacks / prompt_templates neu phu hop
chapterCanon -> chapterMeta / chapters summary neu co project chuong tuong ung
```

- Phai co man hinh duyet truoc khi ghi:

```text
Them moi
Cap nhat record co san
Bo qua
Can xac nhan
```

- Co co che dedupe dua tren normalized_name/identity_key dang co trong DB.

Khong lam trong phase nay:

- Khong tao Fanfic Mode.
- Khong sua editor.
- Khong Canon Review.
- Khong deep analysis them.

Ly do bat buoc gioi han: day la phase co nguy co ghi sai du lieu vao project, nen can review/dedupe rieng.

Ket qua bat buoc:

- Sau khi materialize, Story Bible hien nhan vat/dia diem/vat pham/thuat ngu/canon facts tu Canon Pack.
- Context Engine co the lay du lieu moi nhu du lieu StoryForge binh thuong.

## Phase 7: Fanfic / Rewrite Project Mode

Muc tieu: cho user tao du an dong nhan/viet lai dua tren Canon Pack.

Chi nen lam trong phase nay:

- Them project mode moi o muc project:

```text
original
fanfic
rewrite
translation_context
```

- Khi tao project moi, onboarding hoi:

```text
Ban muon viet tiep / viet lai / dong nhan tu truyen co san?
Ban da co Canon Pack chua?
```

- Neu chua co Canon Pack -> dua user sang Lab Lite import.
- Neu co -> chon Canon Pack.
- Tao Fanfic Setup:

```text
Kieu dong nhan:
- Viet lai tu dau
- Viet tiep sau ending
- Re nhanh tu chuong/su kien
- Doi POV
- Them OC
- Khai thac nhan vat phu

Muc bam canon:
- Bam canon chat
- Lech nhe
- Re nhanh tu do
- Chi giu nhan vat/the gioi
```

- Tao premise + outline tu Canon Pack.
- Luu lien ket project -> canonPackId.

Khong lam trong phase nay:

- Khong viet editor rieng tu dau.
- Khong tao auto-generation nhieu chuong.
- Khong Canon Review sau khi viet.

Ly do bat buoc gioi han: phase nay chi tao project mode va setup fanfic, chua bien editor thanh he thong moi.

Ket qua bat buoc:

- Tao duoc project fanfic/rewrite lien ket Canon Pack.
- Co outline ban dau duoc AI tao dua tren Canon Pack.

## Phase 8: Fanfic Writer Mode Tren Editor Hien Co

Muc tieu: dung lai editor hien tai nhung them panel/context rieng cho fanfic.

Chi nen lam trong phase nay:

- Dung lai SceneEditor/AI sidebar hien tai.
- Them panel rieng khi project mode la fanfic/rewrite:

```text
Canon Pack dang dung
Muc bam canon
Diem re nhanh
Nhan vat lien quan
Dieu cam pha canon
Creative gaps co the khai thac
```

- Cap nhat Context Engine de lay:

```text
globalCanon rut gon
arcCanon lien quan
characterCanon lien quan
relationshipCanon lien quan
styleCanon
canonRestrictions
creativeGaps
```

- Khong nhet het Canon Pack vao prompt. Chi trich dung phan lien quan.

Khong lam trong phase nay:

- Khong Canon Review.
- Khong phan tich file moi.
- Khong tao editor moi.
- Khong batch auto write.

Ly do bat buoc gioi han: phai chung minh Context Engine co the dung Canon Pack de viet tot truoc khi them review.

Ket qua bat buoc:

- AI viet tiep/viet lai trong editor co dung Canon Pack.
- Prompt debug/thong tin context cho thay Canon Pack dang duoc nap dung.

## Phase 9: AI Canon Review

Muc tieu: gop y phat hien lech canon, khong hua dam bao tuyet doi.

Chi nen lam trong phase nay:

- Tao task/prompt:

```text
CANON_REVIEW
```

- Tao service:

```text
src/services/labLite/canonReview.js
```

- Review 3 muc:

```text
Nhanh: Canon Pack rut gon + doan moi
Chuan: Canon Pack lien quan + doan moi + chuong hien tai
Sau: Canon Pack lien quan + chuong/arc goc lien quan + doan moi
```

- Output:

```json
{
  "verdict": "no_obvious_issue|possible_drift|strong_conflict|needs_user_confirmation",
  "issues": [
    {
      "type": "timeline|character_voice|relationship|world_rule|state|restriction|style",
      "severity": "low|medium|high",
      "quote": "Doan co van de",
      "canonReference": "Nguon canon lien quan",
      "explanation": "Giai thich ngan",
      "suggestedFix": "Goi y sua"
    }
  ]
}
```

- UI hien nhu review queue, co nut:

```text
Bo qua
Sua theo goi y
Danh dau can xem lai
Them vao Canon Fact moi neu day la re nhanh co chu dich
```

Khong lam trong phase nay:

- Khong chan user viet.
- Khong tu dong sua text neu user chua dong y.
- Khong goi la "dam bao khong pha canon".

Ly do bat buoc gioi han: day la feature de ho tro tac gia, khong phai bo loc tuyet doi.

Ket qua bat buoc:

- Review duoc mot chuong/doan moi va tra ve issue co ly do.
- User co quyen chap nhan/bo qua.

## Phase 10: Dich Theo Canon Pack

Muc tieu: dung Canon Pack de dich truyen dai nhat quan hon.

Chi nen lam trong phase nay:

- Them mode trong Translator:

```text
Dich voi Canon Pack
```

- Dung Canon Pack de nap:

```text
glossary
danh xung
ten nhan vat/dia diem/phe phai
tone/van phong
quan he xung ho
quy tac dich thuat
```

- Khong phan tich lai ca corpus trong luc dich.

Khong lam trong phase nay:

- Khong them tinh nang fanfic moi.
- Khong sua Canon Pack Builder.
- Khong backend.

Ket qua bat buoc:

- Dich mot doan/chapter co su dung glossary va styleCanon.

## Phase 11: Long Context Optimization

Muc tieu: toi uu Gemini 1M input cho corpus lon ma khong lam UX cham/vo.

Chi nen lam trong phase nay:

- Them token estimator chinh xac hon.
- Them chien luoc:

```text
small corpus -> full long-context analysis
medium corpus -> arc batches
large corpus -> scout first, deep selected arcs
huge corpus -> user-guided selected chapters/arcs
```

- Them model routing:

```text
Scout -> model nhanh
Arc Mapper -> model nhanh/balanced
Deep Analysis -> model long-context manh
Canon Review -> tuy muc nhanh/chuan/sau
```

- Them cache ket qua theo hash chapter content de khong phan tich lai chuong khong doi.

Khong lam trong phase nay:

- Khong doi UX chinh.
- Khong them feature fanfic moi.
- Khong thay DB schema lon neu chua can.

Ket qua bat buoc:

- Truyen rat dai van co duong chay ro: scout truoc, deep sau.
- User thay duoc token/chi phi uoc tinh truoc khi bam chay.

## Thu Tu Trien Khai Khuyen Nghi

Lam theo thu tu nay de co MVP nhanh ma khong vo kien truc:

```text
Phase 0: Chot pham vi
Phase 1: Browser import + tach chuong
Phase 2: AI Chapter Scout
Phase 3: Arc Mapper
Phase 4: Deep Analysis
Phase 5: Canon Pack Builder
Phase 6: Materialize vao Project
Phase 7: Fanfic/Rewrite Project Mode
Phase 8: Fanfic Writer Mode
Phase 9: AI Canon Review
Phase 10: Dich theo Canon Pack
Phase 11: Long Context Optimization
```

MVP dang lam dau tien nen cat xuong:

```text
Phase 1 + Phase 2 + Phase 5 ban toi thieu
```

MVP day du dau tien:

```text
Upload truyen
-> Tach chuong
-> AI Scout
-> Chon chuong
-> Deep Analysis
-> Tao Canon Pack
-> Xem/export Canon Pack
```

Chua can fanfic ngay trong MVP dau. Neu them fanfic qua som, rui ro UX va prompt se tang manh.

## Cac Ranh Gioi Can Giu Nghiem Tuc

- Lab Lite khong phu thuoc `corpusApi`.
- Lab Lite khong can jobs server.
- Lab Lite khong ghi vao Story Bible neu user chua duyet.
- Scout khong dung keyword cung lam nguon chinh.
- Canon Review khong duoc viet la dam bao tuyet doi.
- Fanfic Mode khong tao editor moi tu dau, chi them mode/context vao editor hien co.
- Backend Corpus Lab V3 van giu cho phan tich sau, graph, review queue nang.
- Gemini 1M input la loi the cho nap lieu/pham vi lon, khong phai ly do de gui ca truyen moi lan viet.

## Rui Ro Va Cach Giam

### Rui ro 1: File qua lon lam browser lag

Giam bang:

- doc file bat dong bo
- chia chuong truoc khi render
- virtualize danh sach chuong neu can
- khong dua full content vao React state neu qua lon, luu IndexedDB

### Rui ro 2: AI Scout nhan dinh sai chuong quan trong

Giam bang:

- output phai co ly do
- user co the chon them chuong thu cong
- cho rerun scout voi muc tieu khac
- khong tu dong bo qua vinh vien chuong bi scout danh thap

### Rui ro 3: Canon Pack qua lon

Giam bang:

- chia tang Global/Arc/Character/Chapter/Index
- Context Engine truy xuat phan lien quan
- co compact summary rieng cho prompt
- cache va hash tung chapter

### Rui ro 4: NSFW/truong thanh bi lam lo lieu qua trong UI

Giam bang:

- mac dinh an
- chi bat khi project content mode la 18+/ENI
- UI goi mem: "noi dung truong thanh/nhay cam"
- user kiem soat dieu gi duoc phan tich

### Rui ro 5: User khong hieu Nap lieu va Dong nhan khac nhau

Giam bang:

- onboarding hoi theo hanh dong
- neu muon viet dong nhan ma chua co Canon Pack, app tu dan sang upload/phan tich
- khong bat user hieu thuat ngu truoc khi dung

## Dinh Nghia Thanh Cong

Tinh nang duoc xem la thanh cong neu user lam duoc flow nay:

```text
1. Tai mot truyen len.
2. Web tach chuong dung chap nhan duoc.
3. AI quet va chi ra chuong/arc dang nap sau co ly do.
4. User chon chuong/arc.
5. AI tao Canon Pack.
6. User xem va sua Canon Pack.
7. Canon Pack duoc dua vao Story Bible/Context Engine.
8. Khi viet dong nhan hoac viet lai, AI bam nhan vat, timeline, style, va dieu cam pha canon tot hon chatbot thong thuong.
```
