import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_FEATURES,
  ACCESS_REASONS,
  createAuthenticatedAccessFallbackSnapshot,
  createUnauthenticatedAccessSnapshot,
  getCachedAccessToken,
  setCachedAccessSnapshot,
} from '../../services/access/accessClient.js';

describe('access client fallback snapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the Supabase session identity when the access API is unavailable', () => {
    const snapshot = createAuthenticatedAccessFallbackSnapshot({
      user: {
        id: 'user-1',
        email: 'canhettg119@gmail.com',
        user_metadata: {
          full_name: 'StoryForge User',
        },
      },
    });

    expect(snapshot.authenticated).toBe(true);
    expect(snapshot.user).toMatchObject({
      id: 'user-1',
      email: 'canhettg119@gmail.com',
      displayName: 'StoryForge User',
      systemRole: 'user',
      status: 'active',
    });
    expect(snapshot.plan).toBeNull();
    expect(snapshot.features[ACCESS_FEATURES.TRANSLATOR_ACCESS]).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
    });
    expect(snapshot.features[ACCESS_FEATURES.GEMINI_DIRECT]).toMatchObject({
      allowed: false,
      reason: ACCESS_REASONS.AUTH_REQUIRED,
    });
  });

  it('does not expose the bearer token on window globals', () => {
    vi.stubGlobal('window', { __STORYFORGE_ACCESS_TOKEN__: 'old-token' });
    const snapshot = createUnauthenticatedAccessSnapshot();

    setCachedAccessSnapshot(snapshot, 'secret-token');

    expect(getCachedAccessToken()).toBe('secret-token');
    expect(window.__STORYFORGE_ACCESS_SNAPSHOT__).toBe(snapshot);
    expect(window.__STORYFORGE_ACCESS_TOKEN__).toBeUndefined();
  });
});
