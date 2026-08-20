export function createSceneAutosaveController({
  delayMs = 2000,
  retryDelayMs = 500,
  onSave,
  onStatusChange,
}) {
  let timerId = null;
  let drainPromise = null;
  let inFlight = null;
  let status = { state: 'idle', sceneId: null, error: null };
  const pendingByScene = new Map();
  const pendingOrder = [];
  const failedByScene = new Map();

  const clearTimer = () => {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const setStatus = (state, snapshot = null, error = null) => {
    status = {
      state,
      sceneId: snapshot ? (snapshot.sceneId ?? null) : (status.sceneId ?? null),
      error,
    };
    onStatusChange?.({ ...status });
  };

  const wait = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

  const enqueue = (snapshot) => {
    if (!snapshot?.sceneId) return;
    if (!pendingByScene.has(snapshot.sceneId)) {
      pendingOrder.push(snapshot.sceneId);
    }
    pendingByScene.set(snapshot.sceneId, { ...snapshot });
  };

  const takeNext = () => {
    while (pendingOrder.length > 0) {
      const sceneId = pendingOrder.shift();
      const snapshot = pendingByScene.get(sceneId);
      if (!snapshot) continue;
      pendingByScene.delete(sceneId);
      return snapshot;
    }
    return null;
  };

  const runSave = async (snapshot) => {
    if (!snapshot?.sceneId || typeof onSave !== 'function') return false;

    inFlight = snapshot;
    setStatus('saving', snapshot);
    try {
      await onSave(snapshot.sceneId, snapshot.html);
    } catch (firstError) {
      await wait(retryDelayMs);
      try {
        await onSave(snapshot.sceneId, snapshot.html);
      } catch (error) {
        const failure = { snapshot, error: error || firstError };
        failedByScene.set(snapshot.sceneId, failure);
        setStatus('error', snapshot, failure.error);
        return false;
      }
    } finally {
      inFlight = null;
    }

    failedByScene.delete(snapshot.sceneId);
    if (failedByScene.size > 0) {
      const [failure] = failedByScene.values();
      setStatus('error', failure.snapshot, failure.error);
    } else {
      setStatus(pendingByScene.size > 0 ? 'dirty' : 'saved', snapshot);
    }
    return true;
  };

  const drain = async () => {
    clearTimer();
    if (drainPromise) {
      await drainPromise;
      if (pendingByScene.size > 0) await drain();
      return;
    }

    drainPromise = (async () => {
      let snapshot = takeNext();
      while (snapshot) {
        await runSave(snapshot);
        snapshot = takeNext();
      }
    })();

    try {
      await drainPromise;
    } finally {
      drainPromise = null;
      if (pendingByScene.size > 0) await drain();
    }
  };

  const cancel = () => {
    pendingByScene.clear();
    pendingOrder.length = 0;
    failedByScene.clear();
    clearTimer();
    setStatus('idle', { sceneId: null });
  };

  return {
    schedule(snapshot) {
      if (!snapshot?.sceneId) return;
      failedByScene.delete(snapshot.sceneId);
      enqueue(snapshot);
      clearTimer();
      setStatus('dirty', snapshot);
      timerId = setTimeout(() => {
        timerId = null;
        void drain();
      }, delayMs);
    },

    async flush() {
      await drain();
    },

    async retry() {
      failedByScene.forEach(({ snapshot }) => enqueue(snapshot));
      failedByScene.clear();
      if (pendingByScene.size > 0) {
        const nextSceneId = pendingOrder.find((sceneId) => pendingByScene.has(sceneId));
        setStatus('dirty', pendingByScene.get(nextSceneId));
      }
      await drain();
    },

    getStatus() {
      return { ...status };
    },

    hasPending() {
      return Boolean(pendingByScene.size || failedByScene.size || inFlight || drainPromise);
    },

    hasPendingForScene(sceneId) {
      return Boolean(
        pendingByScene.has(sceneId)
        || failedByScene.has(sceneId)
        || inFlight?.sceneId === sceneId,
      );
    },

    cancel,

    dispose({ flushPending = false } = {}) {
      if (flushPending) return drain();
      cancel();
      return Promise.resolve();
    },
  };
}
