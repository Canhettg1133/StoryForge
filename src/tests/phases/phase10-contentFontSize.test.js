import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadUIStore() {
  vi.resetModules();
  return import('../../stores/uiStore.js');
}

describe('phase10 content font size preference', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps the current CSS sizing by default', async () => {
    const { default: useUIStore } = await loadUIStore();

    expect(useUIStore.getState().contentFontSize).toBeNull();
    expect(localStorage.getItem('sf-content-font-size')).toBeNull();
  });

  it('clamps saved content font sizes to the supported range', async () => {
    const {
      CONTENT_FONT_SIZE_MAX,
      CONTENT_FONT_SIZE_MIN,
      default: useUIStore,
    } = await loadUIStore();

    useUIStore.getState().setContentFontSize(3);
    expect(useUIStore.getState().contentFontSize).toBe(CONTENT_FONT_SIZE_MIN);
    expect(localStorage.getItem('sf-content-font-size')).toBe(String(CONTENT_FONT_SIZE_MIN));

    useUIStore.getState().setContentFontSize(30);
    expect(useUIStore.getState().contentFontSize).toBe(CONTENT_FONT_SIZE_MAX);
    expect(localStorage.getItem('sf-content-font-size')).toBe(String(CONTENT_FONT_SIZE_MAX));
  });

  it('can reset to the current default app typography', async () => {
    const { default: useUIStore } = await loadUIStore();

    useUIStore.getState().setContentFontSize(14);
    useUIStore.getState().resetContentFontSize();

    expect(useUIStore.getState().contentFontSize).toBeNull();
    expect(localStorage.getItem('sf-content-font-size')).toBeNull();
  });
});
