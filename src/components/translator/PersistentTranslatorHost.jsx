import React from 'react';
import './PersistentTranslatorHost.css';

const TRANSLATOR_URL = '/translator-runtime/index.html?v=5';

export default function PersistentTranslatorHost({ active = false }) {
  return (
    <section
      className={`persistent-translator-host ${active ? 'is-active' : 'is-background'}`}
      aria-hidden={!active}
    >
      <iframe
        className="persistent-translator-host__frame"
        src={TRANSLATOR_URL}
        title="StoryForge Translator"
      />
    </section>
  );
}
