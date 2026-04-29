import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appPath = path.resolve(process.cwd(), 'docs/ai-studio-relay-connector/App.tsx');
const app1Path = path.resolve(process.cwd(), 'docs/ai-studio-relay-connector/App1.tsx');

describe('AI Studio connector login source', () => {
  it('keeps the App connector on the public Gemini CLI direct OAuth sample flow', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('VITE_GOOGLE_OAUTH_CLIENT_ID');
    expect(source).toContain('VITE_GOOGLE_OAUTH_CLIENT_SECRET');
    expect(source).toContain('const OAUTH_CLIENT_SECRET =');
    expect(source).toContain('https://oauth2.googleapis.com/token');
    expect(source).toContain('authorization_code');
    expect(source).toContain('refresh_token');
    expect(source).toContain('client_secret');
    expect(source).not.toContain('apps.googleusercontent.com');
  });

  it('keeps the App1 helper on the same relay OAuth flow', () => {
    const source = fs.readFileSync(app1Path, 'utf8');

    expect(source).not.toContain('oauthClientSecret');
    expect(source).not.toContain('client_secret');
    expect(source).not.toContain('authorization_code');
    expect(source).not.toContain('https://oauth2.googleapis.com/token');
    expect(source).toContain("toRelayOAuthUrl(relayUrl, 'exchange')");
  });

  it('exchanges and refreshes OAuth tokens directly with Google in App connector', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('response_type=code');
    expect(source).toContain("window.open(url, '_blank')");
    expect(source).toContain('exchangeGoogleOAuthCode');
    expect(source).toContain("grant_type: 'authorization_code'");
    expect(source).toContain("grant_type: 'refresh_token'");
    expect(source).not.toContain('/oauth/${action}');
    expect(source).not.toContain("toRelayOAuthUrl(relayUrl, 'exchange')");
    expect(source).not.toContain("toRelayOAuthUrl(relayUrl, 'refresh')");
  });

  it('stores connector OAuth credentials in the current tab session unless the user opts in', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('CREDENTIALS_REMEMBER_KEY');
    expect(source).toContain('sessionStorage.setItem(CREDENTIALS_STORAGE_KEY');
    expect(source).toContain('localStorage.removeItem(CREDENTIALS_STORAGE_KEY)');
    expect(source).toContain('rememberCredentials');
  });
});
