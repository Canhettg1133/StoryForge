import React, { useEffect, useRef } from 'react';
import './PersistentTranslatorHost.css';
import { getCachedAccessToken, getStoryForgeAccessToken } from '../../services/access/accessClient.js';

const TRANSLATOR_URL = '/translator-runtime/index.html?v=11';

export default function PersistentTranslatorHost({ active = false, access = null }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!active || !iframeRef.current?.contentWindow) return undefined;
    let cancelled = false;

    async function postAccessContext() {
      const token = getCachedAccessToken() || await getStoryForgeAccessToken();
      if (cancelled || !iframeRef.current?.contentWindow) return;
      iframeRef.current.contentWindow.postMessage({
        type: 'STORYFORGE_ACCESS_CONTEXT',
        token,
        access,
      }, window.location.origin);
    }

    postAccessContext();
    const intervalId = window.setInterval(postAccessContext, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active, access]);

  return (
    <section
      className={`persistent-translator-host ${active ? 'is-active' : 'is-background'}`}
      aria-hidden={!active}
    >
      <iframe
        ref={iframeRef}
        className="persistent-translator-host__frame"
        src={TRANSLATOR_URL}
        title="StoryForge Translator"
        onLoad={() => {
          const token = getCachedAccessToken();
          iframeRef.current?.contentWindow?.postMessage({
            type: 'STORYFORGE_ACCESS_CONTEXT',
            token,
            access,
          }, window.location.origin);
        }}
      />
    </section>
  );
}
