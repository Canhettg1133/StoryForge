import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SetupGuideButtons from '../../features/setupGuides/SetupGuideButtons.jsx';

describe('setup guide buttons UI', () => {
  it('uses SPA links internally and hardened new-tab links externally', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SetupGuideButtons />
      </MemoryRouter>,
    );

    expect(html).toContain('href="/guide"');
    expect(html).toContain('href="/guide/proxy"');
    expect(html).toContain('Hướng dẫn setup để viết truyện');
    expect(html).toContain('Hướng dẫn dịch truyện');
    expect(html.match(/target="_blank"/gu)).toHaveLength(3);
    expect(html.match(/rel="noopener noreferrer"/gu)).toHaveLength(3);
    expect(html).not.toContain('/guide/translator');
    expect(html).toContain('setup-guide-button btn-primary');
  });
});


