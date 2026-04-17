import React from 'react';
import './Translator.css';

const TRANSLATOR_URL = '/translator-runtime/index.html?v=5';

export default function Translator() {
  return (
    <div className="translator-page">
      <section className="translator-page__frame-wrap card animate-slide-up">
        <iframe
          className="translator-page__frame"
          src={TRANSLATOR_URL}
          title="StoryForge Translator"
          loading="lazy"
        />
      </section>
    </div>
  );
}
