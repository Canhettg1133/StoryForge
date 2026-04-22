export function createSceneAutosaveController({
  delayMs = 2000,
  onSave,
}) {
  let timerId = null;
  let pending = null;

  const clearTimer = () => {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const runSave = async (snapshot) => {
    if (!snapshot?.sceneId || typeof onSave !== 'function') {
      return;
    }
    await onSave(snapshot.sceneId, snapshot.html);
  };

  const flush = async () => {
    const snapshot = pending;
    pending = null;
    clearTimer();
    if (!snapshot) return;
    await runSave(snapshot);
  };

  return {
    schedule(snapshot) {
      pending = snapshot ? { ...snapshot } : null;
      clearTimer();
      if (!pending) return;
      timerId = setTimeout(() => {
        const next = pending;
        pending = null;
        timerId = null;
        void runSave(next);
      }, delayMs);
    },

    async flush() {
      await flush();
    },

    cancel() {
      pending = null;
      clearTimer();
    },

    dispose({ flushPending = false } = {}) {
      if (flushPending) {
        void flush();
        return;
      }
      this.cancel();
    },
  };
}
