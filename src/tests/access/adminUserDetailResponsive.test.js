import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const baseCss = fs.readFileSync(path.join(projectRoot, 'apps/admin/src/styles/base.css'), 'utf8');
const responsiveCss = fs.readFileSync(path.join(projectRoot, 'apps/admin/src/styles/responsive.css'), 'utf8');

function getRule(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

describe('admin user detail responsive layout', () => {
  it('does not create a horizontal scroll area inside the user detail panel', () => {
    const scrollRule = getRule(baseCss, '.user-detail-scroll');

    expect(scrollRule).toMatch(/overflow-y:\s*auto/);
    expect(scrollRule).toMatch(/overflow-x:\s*(?:hidden|clip)/);
  });

  it('lets the VIP extension controls shrink within the 360px detail column', () => {
    const formRule = getRule(baseCss, '.vip-extension-form');

    expect(formRule).toMatch(/min-width:\s*0/);
    expect(formRule).toMatch(/grid-template-columns:\s*minmax\(0,/);
    expect(formRule).not.toMatch(/minmax\((?:90|120|130)px/);
  });

  it('stacks quick actions and VIP extension controls on phone widths', () => {
    expect(responsiveCss).toMatch(
      /\.quick-actions,\s*\.inline-actions,\s*\.vip-extension-form,[^{}]*\{\s*grid-template-columns:\s*1fr;/s,
    );
  });
});
