(function clearTranslatorRuntimeCaches() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => registration.scope.includes('/translator-runtime/'))
          .map((registration) => registration.unregister()),
      );

      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys
            .filter((key) => key.startsWith('novel-translator-'))
            .map((key) => caches.delete(key)),
        );
      }
    } catch (error) {
      console.warn('[translator-runtime] Failed to clear old caches', error);
    }
  });
}());
