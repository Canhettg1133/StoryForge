import { describe, expect, it } from 'vitest';
import {
  consumeCloudAuthReturnPath,
  getSafeCloudRedirectUrl,
  normalizeCloudRedirectUrl,
  rememberCloudAuthReturnPath,
  resolveCloudRedirectUrl,
} from '../../services/cloud/cloudAuthService.js';

describe('phase10 cloud auth redirect', () => {
  it('normalizes relative callback paths against the current origin', () => {
    expect(normalizeCloudRedirectUrl('/cloud-sync', 'https://story-forge-virid.vercel.app'))
      .toBe('https://story-forge-virid.vercel.app/cloud-sync');
    expect(normalizeCloudRedirectUrl('cloud-sync', 'https://story-forge-virid.vercel.app/'))
      .toBe('https://story-forge-virid.vercel.app/cloud-sync');
  });

  it('keeps absolute callback URLs unchanged', () => {
    expect(normalizeCloudRedirectUrl('https://example.com/cloud-sync', 'https://ignored.test'))
      .toBe('https://example.com/cloud-sync');
  });

  it('uses the current origin by default to match root-domain Supabase allow-lists', () => {
    window.history.replaceState({}, '', '/project/12/cloud-sync');

    expect(getSafeCloudRedirectUrl()).toBe(window.location.origin);
  });

  it('does not allow a localhost redirect override on a deployed origin', () => {
    expect(resolveCloudRedirectUrl(
      'http://localhost:5173',
      'https://story-forge-virid.vercel.app',
    )).toBe('https://story-forge-virid.vercel.app');
  });

  it('keeps localhost redirects when the app itself is running locally', () => {
    expect(resolveCloudRedirectUrl(
      'http://localhost:5173',
      'http://localhost:5173',
    )).toBe('http://localhost:5173');
  });

  it('remembers the cloud sync route separately from the OAuth redirect URL', () => {
    rememberCloudAuthReturnPath('/project/12/cloud-sync');

    expect(consumeCloudAuthReturnPath()).toBe('/project/12/cloud-sync');
    expect(consumeCloudAuthReturnPath()).toBe('/cloud-sync');
  });
});
