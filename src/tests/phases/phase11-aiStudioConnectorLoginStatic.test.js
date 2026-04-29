import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appPath = path.resolve(process.cwd(), 'docs/ai-studio-relay-connector/App.tsx');
const app1Path = path.resolve(process.cwd(), 'docs/ai-studio-relay-connector/App1.tsx');

describe('AI Studio connector login source', () => {
  it('does not require an OAuth client secret in the shared connector UI', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).not.toContain('OAuth Client Secret');
    expect(source).not.toContain('client_secret');
    expect(source).not.toContain('authorization_code');
  });

  it('keeps the App1 helper on the same relay OAuth flow', () => {
    const source = fs.readFileSync(app1Path, 'utf8');

    expect(source).not.toContain('oauthClientSecret');
    expect(source).not.toContain('client_secret');
    expect(source).not.toContain('authorization_code');
    expect(source).not.toContain('https://oauth2.googleapis.com/token');
    expect(source).toContain("toRelayOAuthUrl(relayUrl, 'exchange')");
  });

  it('exchanges OAuth codes through the relay instead of keeping a secret in the connector', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('response_type=code');
    expect(source).toContain('/oauth/${action}');
    expect(source).toContain("toRelayOAuthUrl(relayUrl, 'exchange')");
    expect(source).toContain("toRelayOAuthUrl(relayUrl, 'refresh')");
  });
});
