# AI Studio Relay Connector

This folder contains the source template for the Google AI Studio connector app.

Current main connector app:

```text
https://ai.studio/apps/685f3deb-17d8-4197-9733-a8f144543129
```

Current App1 fix CLI app:

```text
https://ai.studio/apps/a9e5212b-a876-4d92-8e00-2ec744def595
```

This folder is also a small local Vite project. If VS Code or Antigravity shows red errors for `App.tsx`, run:

```bash
npm install
npm run lint
```

from this folder:

```text
D:\StoryForge\docs\ai-studio-relay-connector
```

What this app does:
- Runs inside the user's Google AI Studio session.
- Connects to the StoryForge relay room with `role=connector`.
- Receives `generate` requests from StoryForge.
- Calls Gemini through the AI Studio app environment.
- Streams text back through the relay.

What this app must not do:
- Do not ask users to paste Google cookies.
- Do not commit or log OAuth tokens.
- Do not send prompts anywhere except the configured relay URL.
- Do not commit OAuth Client Secret, API keys, refresh tokens, cookies, `.env.local`, or `.vercel`.

## How to create the AI Studio app

1. Open `https://ai.studio/`.
2. Open Build mode.
3. Create a new app.
4. Paste the code from `App.tsx` into the AI Studio file named `src/App.tsx`.
5. Ensure the project has `@google/genai` available. AI Studio Build normally adds it when Gemini API code is present.
6. Test in preview.
7. Share the app and copy its URL.
8. Paste that URL into StoryForge Settings as `Connector App URL`.

After changing `relay-worker/src/index.js` or `relay-worker/wrangler.toml`, redeploy Cloudflare Worker:

```powershell
cd D:\StoryForge\relay-worker
npx wrangler deploy
```

The Worker must allow both the StoryForge Vercel origin and the AI Studio origin. For the current production setup, keep `https://story-forge-virid.vercel.app` and `https://ai.studio` in `ALLOWED_ORIGINS`.

If the Code tab still shows TypeScript red errors, check `package.json`. The app should include React type packages:

```json
"devDependencies": {
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0"
}
```

The recommended `App.tsx` also starts with `// @ts-nocheck` to avoid AI Studio editor-only type noise. If your AI Studio file still has about 517 lines, the new code was not pasted over the old file. The current recommended file is longer.

Keep the shared app link controlled. Anyone with the link can open the connector UI, but they still need a room code to connect to a StoryForge session.

Current recommended file for AI Studio Build is `App.tsx`. Do not use an older `App.jsx` copy; that was a small spike version and has been removed to avoid confusion.

## What the connector UI shows

- Step-by-step Vietnamese instructions inside the app.
- `Tai model tu AI Studio` button to fetch models available to the current Google account.
- Default text/chat model list for cases where the model fetch fails.
- Custom model input for new model IDs not yet listed.
- Connection status, active request ID, active model, chunk count, output character count, and recent logs.
- Phone mode toggle. On mobile/tablet it uses HTTP polling so the relay can keep a short request queue while the connector tab is backgrounded.
- Wake Lock button to keep the screen lit while the connector tab is visible. Wake Lock does not prevent mobile browsers from suspending or killing background tabs.

This connector is for text/chat streaming only. Image, video, TTS, Live API, embedding, and tool-only models are intentionally not included in the main dropdown because StoryForge expects text chunks.
