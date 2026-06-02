import React, { useCallback, useEffect, useRef } from 'react';
import { useUserAccess } from '../../hooks/useUserAccess.js';
import { getCachedAccessToken } from '../../services/access/accessClient.js';
import './PersistentTranslatorHost.css';

const TRANSLATOR_URL = '/translator-runtime/index.html?v=11';

export default function PersistentTranslatorHost({ active = false }) {
  const frameRef = useRef(null);
  const { access } = useUserAccess();

  const sendAccessContext = useCallback(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || typeof window === 'undefined') return;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_ACCESS_CONTEXT',
      token: getCachedAccessToken(),
      access,
    }, window.location.origin);
  }, [access]);

  useEffect(() => {
    sendAccessContext();
  }, [sendAccessContext]);

  return (
    <section
      className={`persistent-translator-host ${active ? 'is-active' : 'is-background'}`}
      aria-hidden={!active}
    >
      <iframe
        ref={frameRef}
        className="persistent-translator-host__frame"
        src={TRANSLATOR_URL}
        title="StoryForge Translator"
        onLoad={sendAccessContext}
      />
    </section>
  );
}
