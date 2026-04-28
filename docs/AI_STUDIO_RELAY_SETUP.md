# Setup AI Studio Relay cho StoryForge

Huong dan nay di tung buoc nho de dua AI Studio Relay vao chay that.

Ban can tu lam cac buoc co dang nhap tai khoan:

- Dang nhap Cloudflare de deploy relay.
- Dang nhap Google AI Studio de tao va share connector app.
- Dan URL that vao StoryForge Settings.

Relay hien tai da deploy cho tai khoan nay:

```text
https://storyforge-ai-studio-relay.canhettg113.workers.dev
```

Connector chinh dang dung:

```text
https://ai.studio/apps/685f3deb-17d8-4197-9733-a8f144543129
```

App1 fix CLI dang dung:

```text
https://ai.studio/apps/a9e5212b-a876-4d92-8e00-2ec744def595
```

## 0. Ban can co gi

- Mot tai khoan Cloudflare.
- Mot tai khoan Google co truy cap `https://ai.studio/`.
- May dang mo repo `D:\StoryForge`.
- Node.js va npm da cai.

Kiem tra nhanh tren PowerShell:

```powershell
cd D:\StoryForge
node -v
npm -v
```

Neu hai lenh nay in ra version thi tiep tuc duoc.

## 1. Deploy relay-worker len Cloudflare

Relay la server WebSocket trung gian:

```text
StoryForge Web <-> Cloudflare Relay <-> AI Studio Connector
```

Relay khong goi Gemini va khong luu prompt/output.

### 1.1 Dang nhap Cloudflare bang Wrangler

Mo PowerShell tai repo:

```powershell
cd D:\StoryForge\relay-worker
npx wrangler login
```

Trinh duyet se mo trang Cloudflare.

Lam tren trinh duyet:

1. Dang nhap Cloudflare.
2. Cho phep Wrangler truy cap tai khoan.
3. Quay lai PowerShell.

Kiem tra da dang nhap:

```powershell
npx wrangler whoami
```

Neu thay email/tai khoan Cloudflare la OK.

### 1.2 Cau hinh domain StoryForge duoc phep dung relay

Mo file:

```text
D:\StoryForge\relay-worker\wrangler.toml
```

Tim phan:

```toml
[vars]
ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:5174,https://story-forge-virid.vercel.app,https://ai.studio,https://aistudio.google.com,https://*.googleusercontent.com,https://*.usercontent.goog"
```

Neu StoryForge dang chay local khi test, giu `http://localhost:5173`. Khi deploy public, sua hoac them domain web that cua ban, vi du:

```toml
[vars]
ALLOWED_ORIGINS = "https://storyforge.example.com"
```

Neu co nhieu domain:

```toml
[vars]
ALLOWED_ORIGINS = "http://localhost:5173,https://storyforge.example.com,https://ai.studio,https://aistudio.google.com,https://*.googleusercontent.com,https://*.usercontent.goog"
```

Luu y: dung dung origin, khong them slash cuoi.

Dung:

```text
https://storyforge.example.com
```

Khong dung:

```text
https://storyforge.example.com/
```

### 1.3 Deploy Worker

Chay:

```powershell
cd D:\StoryForge\relay-worker
npx wrangler deploy
```

Neu thanh cong, Wrangler se in ra URL dang nhu:

```text
https://storyforge-ai-studio-relay.<ten-account>.workers.dev
```

Copy URL nay. Day la `Relay URL`.

### 1.4 Test relay da song

Chay lenh nay, thay `RELAY_URL` bang URL cua ban:

```powershell
$relay="https://storyforge-ai-studio-relay.<ten-account>.workers.dev"
Invoke-RestMethod "$relay/health"
```

Ket qua dung:

```text
ok service
-- -------
True ai-studio-relay
```

Test tao room:

```powershell
Invoke-RestMethod -Method Post "$relay/rooms"
```

Ket qua dung se co code dang:

```text
ABC-123
```

## 2. Tao AI Studio Connector App

Connector la app chay trong Google AI Studio cua user.

No lam viec nay:

```text
Nhan request tu relay -> goi Gemini trong AI Studio -> stream text ve relay
```

### 2.1 Mo Google AI Studio

Mo:

```text
https://ai.studio/
```

Dang nhap Google.

### 2.2 Mo Build mode

Trong AI Studio:

1. Tim muc `Build`.
2. Tao app moi.
3. Neu co o prompt, co the nhap:

```text
Create a minimal React app. I will replace the code manually.
```

Cho AI Studio tao app xong.

### 2.3 Dan source connector

Mo file trong repo:

```text
D:\StoryForge\docs\ai-studio-relay-connector\App.tsx
```

Copy toan bo noi dung file.

Trong AI Studio:

1. Mo tab Code.
2. Tim file React chinh, thuong la `App.tsx`, `src/App.tsx`, `App.jsx` hoac `src/App.jsx`.
3. Xoa noi dung cu.
4. Paste noi dung vua copy.
5. Luu/chay preview.

Neu AI Studio bao thieu package `@google/genai`, hay them package do theo UI cua AI Studio neu co. Neu AI Studio tu quan ly package, chi can chay preview lai.

Sau khi preview hien giao dien connector, user se thay huong dan ngay trong app:

```text
1. Trong StoryForge, vao Settings, chon provider AI Studio Relay.
2. Bam Tao room, roi copy ma dang ABC-123.
3. Dan ma do vao o Ma phong trong connector.
4. Neu dung dien thoai, de `Che do dien thoai` bat va bam `Bat giu man hinh sang` neu trinh duyet ho tro.
5. Bam Ket noi.
6. Quay lai StoryForge va gui prompt. Neu request khong chay vi mobile pause tab nen, mo lai tab connector de no nhan request dang cho.
```

Nut `Tai model tu AI Studio` se hoi tai khoan AI Studio hien tai xem model nao co the goi `generateContent`.
Neu nut nay loi, connector van co danh sach model mac dinh va o `Model tuy chinh`.

Danh sach mac dinh chi gom model text/chat. Khong dua model image/video/TTS/Live vao luong nay vi StoryForge dang can stream text ve editor/chat.

### 2.4 Share connector app

Trong AI Studio:

1. Bam `Share`.
2. Chon quyen share phu hop.
3. De test rieng, de private/chi minh ban.
4. De user dung, chon kieu `anyone with link` neu AI Studio cho phep.
5. Copy link app.

Link nay la `Connector App URL`.

Luu y quan trong:

- Code cua app share co the bi nguoi khac xem.
- Khong paste API key, OAuth Client Secret, cookie, refresh token hoac `.env.local` vao code.
- Connector source khong duoc hard-code secret. Neu can OAuth Client Secret, nhap luc chay trong UI.
- Khi user chay shared app trong AI Studio, AI Studio se dung key/session cua user do.

## 3. Dan URL vao StoryForge

Mo StoryForge.

Vao:

```text
Settings -> AI Provider / AI Studio Relay
```

Nhap:

```text
Relay URL: URL workers.dev vua deploy
Connector App URL: URL AI Studio app vua share
Model: gemini-2.5-flash
```

Bam `Luu`.

Sau do:

1. Bam `Tao room`.
2. StoryForge se hien room code, vi du `ABC-123`.
3. Bam `Mo connector`.
4. Trong AI Studio Connector, nhap:
   - Relay URL
   - Room Code
5. Bam `Connect`.
6. Quay lai StoryForge.

Luu y tren dien thoai: khong co API web nao dam bao tab nen luon song. `Wake Lock` chi giu man hinh sang khi tab connector dang hien. `Che do dien thoai` dung HTTP polling de relay giu request cho vai phut, nhung viec goi Gemini van chi chay khi trinh duyet cho tab connector thuc.

## 4. Manual test flow

Lam theo dung thu tu:

1. StoryForge Settings: chon provider `AI Studio Relay`.
2. Bam `Tao room`.
3. Copy room code.
4. Bam `Mo connector`.
5. AI Studio Connector: nhap Relay URL.
6. AI Studio Connector: nhap Room Code.
7. AI Studio Connector: bam `Connect`.
8. Quay lai StoryForge Project Chat.
9. Gui prompt ngan:

```text
Hay tra loi ngan gon: 1+1 bang may?
```

Ket qua dung:

- Connector status: `Connected`, sau do `Running`, sau do `Connected`.
- StoryForge nhan text stream ve.

## 5. Neu loi thi xem gi

### Loi: Chua cau hinh Relay URL

Ban chua dan Relay URL vao Settings.

### Loi: AI Studio Connector is not connected

Room da tao nhung connector chua connect.

Lam lai:

1. Mo connector.
2. Nhap dung room code.
3. Bam Connect.

### Loi: Room expired

Room het han.

Lam lai:

1. StoryForge bam `Tao room`.
2. Connector nhap room moi.
3. Connect lai.

### Loi: Origin not allowed

`ALLOWED_ORIGINS` trong `relay-worker/wrangler.toml` khong dung domain StoryForge hoac thieu origin AI Studio `https://ai.studio`.

Sua lai roi deploy lai:

```powershell
cd D:\StoryForge\relay-worker
npx wrangler deploy
```

### Loi WebSocket/khong connect duoc

Kiem tra:

- Relay URL co dung `https://...workers.dev` khong.
- Room code co dung dang `ABC-123` khong.
- Connector tab con mo khong.
- StoryForge va connector co cung room khong.

### Loi quota/auth Gemini

Day la loi tu tai khoan AI Studio/Gemini cua user.

Cach xu ly:

- Dang nhap lai Google trong AI Studio.
- Thu model `gemini-2.5-flash`.
- Tao room moi.
- Neu van loi, dung provider Gemini Direct/BYOK.

## 6. Deploy lai khi sua relay

Moi lan sua file trong `relay-worker`, deploy lai:

```powershell
cd D:\StoryForge\relay-worker
npx wrangler deploy
```

Sau do test lai:

```powershell
$relay="https://storyforge-ai-studio-relay.<ten-account>.workers.dev"
Invoke-RestMethod "$relay/health"
Invoke-RestMethod -Method Post "$relay/rooms"
```

Neu chi sua web app tren Vercel thi khong can deploy lai Cloudflare. Neu sua `relay-worker/src/index.js` hoac `relay-worker/wrangler.toml`, phai chay `npx wrangler deploy` de Worker nhan origin/CORS moi.
