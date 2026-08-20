import { describe, expect, it, vi } from 'vitest';
import {
  createSharedModuleLoader,
  getRouteIdFromPath,
  shouldPrefetchRoutes,
} from '../../routes/routeModules.js';

describe('route module registry', () => {
  it('shares the exact in-flight promise between lazy rendering and intent prefetch', async () => {
    let resolveModule;
    const importer = vi.fn(() => new Promise((resolve) => {
      resolveModule = resolve;
    }));
    const load = createSharedModuleLoader(importer);

    const first = load();
    const second = load();

    expect(second).toBe(first);
    expect(importer).toHaveBeenCalledTimes(1);

    resolveModule({ default: () => null });
    await first;
    expect(load()).toBe(first);
  });

  it('skips speculative route work for data saver and 2G connections', () => {
    expect(shouldPrefetchRoutes({ saveData: true, effectiveType: '4g' })).toBe(false);
    expect(shouldPrefetchRoutes({ saveData: false, effectiveType: '2g' })).toBe(false);
    expect(shouldPrefetchRoutes({ saveData: false, effectiveType: 'slow-2g' })).toBe(false);
    expect(shouldPrefetchRoutes({ saveData: false, effectiveType: '4g' })).toBe(true);
    expect(shouldPrefetchRoutes(undefined)).toBe(true);
  });

  it('maps project routes without preloading unrelated page modules', () => {
    expect(getRouteIdFromPath('/project/42/editor')).toBe('sceneEditor');
    expect(getRouteIdFromPath('/project/42/world?tab=locations')).toBe('worldLore');
    expect(getRouteIdFromPath('/project/42/corpus-lab/viewer')).toBe('analysisViewer');
    expect(getRouteIdFromPath('/translator')).toBeNull();
  });
});
