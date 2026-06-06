import { describe, expect, it, vi } from 'vitest';
import {
  canNavigateBackInApp,
  getLocationReturnTo,
  navigateBackOr,
  normalizeInternalPath,
} from '../../utils/navigation.js';

describe('phase10 safe back navigation', () => {
  it('only treats React Router history idx as in-app back history', () => {
    expect(canNavigateBackInApp({ idx: 1 })).toBe(true);
    expect(canNavigateBackInApp({ idx: 0 })).toBe(false);
    expect(canNavigateBackInApp({})).toBe(false);
  });

  it('uses a safe internal returnTo before browser back', () => {
    const navigate = vi.fn();

    navigateBackOr(navigate, '/', {
      location: {
        pathname: '/translator',
        search: '',
        hash: '',
        state: { returnTo: '/project/1/editor' },
      },
    });

    expect(navigate).toHaveBeenCalledWith('/project/1/editor', { replace: true });
  });

  it('falls back with replace when there is no in-app history', () => {
    const navigate = vi.fn();

    navigateBackOr(navigate, '/settings#gemini-guides', {
      location: {
        pathname: '/guide/proxy',
        search: '',
        hash: '',
        state: null,
      },
    });

    expect(navigate).toHaveBeenCalledWith('/settings#gemini-guides', { replace: true });
  });

  it('rejects unsafe return paths', () => {
    expect(normalizeInternalPath('https://example.com', '/')).toBe('/');
    expect(normalizeInternalPath('//example.com', '/')).toBe('/');
    expect(normalizeInternalPath('/\\evil', '/')).toBe('/');
    expect(getLocationReturnTo({
      pathname: '/settings',
      search: '',
      hash: '',
      state: { returnTo: '/settings' },
    })).toBe('');
  });
});
