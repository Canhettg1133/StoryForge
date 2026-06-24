export const CHAT_SCROLL_BOTTOM_THRESHOLD = 96;
export const CHAT_QUESTION_TOP_PADDING = 12;

export function isChatScrollNearBottom(container, threshold = CHAT_SCROLL_BOTTOM_THRESHOLD) {
  if (!container) return true;
  const distance = Number(container.scrollHeight || 0)
    - Number(container.scrollTop || 0)
    - Number(container.clientHeight || 0);
  return distance <= threshold;
}

function scrollContainerTo(container, top, behavior) {
  const nextTop = Math.max(0, Number(top) || 0);
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: nextTop, behavior });
    return;
  }
  container.scrollTop = nextTop;
}

export function scrollChatToBottom(container, { behavior = 'smooth' } = {}) {
  if (!container) return;
  scrollContainerTo(container, Number(container.scrollHeight || 0), behavior);
}

export function scrollChatMessageToTop(
  container,
  messageNode,
  { padding = CHAT_QUESTION_TOP_PADDING, behavior = 'smooth' } = {},
) {
  if (!container || !messageNode) return;
  const containerRect = container.getBoundingClientRect?.() || { top: 0 };
  const messageRect = messageNode.getBoundingClientRect?.() || { top: 0 };
  const fallbackTop = Number(messageNode.offsetTop || 0);
  const rectTop = Number(messageRect.top || 0) - Number(containerRect.top || 0) + Number(container.scrollTop || 0);
  const hasUsableRect = Number(containerRect.top || 0) !== 0 || Number(messageRect.top || 0) !== 0;
  const targetTop = Number.isFinite(rectTop) && hasUsableRect
    ? rectTop
    : fallbackTop;
  scrollContainerTo(container, targetTop - padding, behavior);
}

export function createRafTextBatcher(
  onFlush,
  {
    requestFrame = (callback) => window.requestAnimationFrame(callback),
    cancelFrame = (frameId) => window.cancelAnimationFrame(frameId),
  } = {},
) {
  let frameId = null;
  let latestText = '';

  const flushNow = () => {
    frameId = null;
    onFlush(latestText);
  };

  return {
    push(text) {
      latestText = String(text || '');
      if (frameId !== null) return;
      frameId = requestFrame(flushNow);
    },
    flush() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      onFlush(latestText);
    },
    cancel() {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
    },
    getLatestText() {
      return latestText;
    },
  };
}
