import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('translator proxy key controls', () => {
  it('uses the same polished key layout for AG and Custom Proxy', () => {
    const html = read('public/translator-runtime/index.html');
    const proxyApi = read('public/translator-runtime/js/proxy/proxy-api.js');
    const styles = read('public/translator-runtime/style.css');

    expect(html).toContain('id="proxyKeysList" class="proxy-key-list"');
    expect(html).toContain('id="customProxyKeysList" class="proxy-key-list"');
    expect(html.match(/class="proxy-key-entry"/g)).toHaveLength(2);
    expect(html.match(/class="proxy-key-actions"/g)).toHaveLength(2);

    expect(proxyApi.match(/api-key-item proxy-key-item/g)).toHaveLength(2);
    expect(proxyApi).toContain('AG${index + 1}');
    expect(proxyApi).toContain('C${index + 1}');
    expect(proxyApi).toContain('aria-label="Xóa key Gemini Proxy AG số ${index + 1}"');
    expect(proxyApi).toContain('aria-label="Xóa key Custom Proxy số ${index + 1}"');

    expect(styles).toContain('grid-template-columns: 40px minmax(0, 1fr) 44px;');
    expect(styles).toContain('.proxy-key-item .remove-btn:focus-visible');
  });
});
