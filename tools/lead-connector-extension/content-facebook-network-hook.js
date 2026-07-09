// Runs in the Facebook page MAIN world.
// Captures only short text snippets around phone-like strings from responses
// that Facebook itself has already loaded in the logged-in page.
(function installTravelLeadFacebookNetworkHook() {
  if (window.__travelLeadFacebookNetworkHookInstalled) return;
  window.__travelLeadFacebookNetworkHookInstalled = true;

  const MESSAGE_SOURCE = 'TRAVEL_LEAD_FB_NETWORK_TEXT';
  const PHONE_HINT_REGEX = /(?:\+?84|0)(?:[\s.\-/,.]*\d){9}/g;
  const MAX_SNIPPETS_PER_RESPONSE = 40;
  const SNIPPET_RADIUS = 220;

  function isFacebookDataUrl(url) {
    const value = String(url || '').toLowerCase();
    return value.includes('/api/graphql') ||
      value.includes('/ajax/') ||
      value.includes('graphql') ||
      value.includes('comet') ||
      value.includes('ufi') ||
      value.includes('comment');
  }

  function collectPhoneSnippets(text) {
    const source = String(text || '');
    if (source.length < 10) return '';

    const snippets = [];
    PHONE_HINT_REGEX.lastIndex = 0;
    let match;

    while ((match = PHONE_HINT_REGEX.exec(source)) !== null && snippets.length < MAX_SNIPPETS_PER_RESPONSE) {
      const start = Math.max(0, match.index - SNIPPET_RADIUS);
      const end = Math.min(source.length, match.index + match[0].length + SNIPPET_RADIUS);
      snippets.push(source.slice(start, end));
    }

    return snippets.join('\n');
  }

  function emitNetworkText(url, text) {
    try {
      if (!isFacebookDataUrl(url)) return;
      const snippetText = collectPhoneSnippets(text);
      if (!snippetText) return;

      window.postMessage({
        source: MESSAGE_SOURCE,
        url: String(url || ''),
        text: snippetText,
      }, '*');
    } catch (error) {
      // Keep the hook passive; never break Facebook's own scripts.
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function travelLeadFetchHook(...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const request = args[0];
        const url = typeof request === 'string' ? request : (request && request.url) || '';
        if (isFacebookDataUrl(url) && response && typeof response.clone === 'function') {
          response.clone().text().then((text) => emitNetworkText(url, text)).catch(() => {});
        }
      } catch (error) {
        // ignore
      }
      return response;
    };
  }

  const Xhr = window.XMLHttpRequest;
  if (Xhr && Xhr.prototype) {
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;

    if (typeof originalOpen === 'function' && typeof originalSend === 'function') {
      Xhr.prototype.open = function travelLeadXhrOpen(method, url, ...rest) {
        this.__travelLeadUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };

      Xhr.prototype.send = function travelLeadXhrSend(...args) {
        try {
          this.addEventListener('loadend', () => {
            try {
              if (!isFacebookDataUrl(this.__travelLeadUrl)) return;
              if (this.responseType && this.responseType !== 'text') return;
              emitNetworkText(this.__travelLeadUrl, this.responseText || '');
            } catch (error) {
              // ignore
            }
          });
        } catch (error) {
          // ignore
        }

        return originalSend.apply(this, args);
      };
    }
  }
})();
