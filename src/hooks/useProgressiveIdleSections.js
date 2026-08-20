import { startTransition, useEffect, useState } from 'react';

export default function useProgressiveIdleSections(totalSections) {
  const [visibleSections, setVisibleSections] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let handle = null;
    let mountedSections = 0;
    const hasIdleCallback = typeof window.requestIdleCallback === 'function';

    setVisibleSections(0);
    const scheduleNext = () => {
      if (cancelled || mountedSections >= totalSections) return;
      const revealNext = () => {
        if (cancelled) return;
        mountedSections += 1;
        startTransition(() => setVisibleSections(mountedSections));
        scheduleNext();
      };
      handle = hasIdleCallback
        ? window.requestIdleCallback(revealNext, { timeout: 700 })
        : window.setTimeout(revealNext, 32);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (handle == null) return;
      if (hasIdleCallback) window.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, [totalSections]);

  return visibleSections;
}
