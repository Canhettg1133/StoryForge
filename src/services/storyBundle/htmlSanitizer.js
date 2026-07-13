const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'strong', 'em', 's', 'strike', 'br', 'hr',
]);

const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form',
  'input', 'button', 'textarea', 'select', 'option', 'link', 'meta',
]);

function sanitizeNode(node, ownerDocument) {
  if (node.nodeType === Node.TEXT_NODE) return ownerDocument.createTextNode(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = String(node.tagName || '').toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return null;

  const children = [...node.childNodes]
    .map((child) => sanitizeNode(child, ownerDocument))
    .filter(Boolean);
  if (!ALLOWED_TAGS.has(tag)) {
    const fragment = ownerDocument.createDocumentFragment();
    children.forEach((child) => fragment.appendChild(child));
    return fragment;
  }

  const clean = ownerDocument.createElement(tag === 'strike' ? 's' : tag);
  children.forEach((child) => clean.appendChild(child));
  return clean;
}

export function sanitizeStoryHtml(value) {
  const html = String(value || '');
  if (!html || !/[<>]/u.test(html)) return html;
  if (typeof DOMParser === 'undefined' || typeof Node === 'undefined') {
    return html
      .replace(/<(script|style|iframe|object|embed|svg|math|form)\b[^>]*>[\s\S]*?<\/\1>/giu, '')
      .replace(/<[^>]+>/gu, '');
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const output = parsed.createElement('div');
  [...parsed.body.childNodes]
    .map((node) => sanitizeNode(node, parsed))
    .filter(Boolean)
    .forEach((node) => output.appendChild(node));
  return output.innerHTML;
}

export function sanitizeSnapshotHtml(snapshot) {
  return {
    ...snapshot,
    scenes: (snapshot.scenes || []).map((scene) => ({
      ...scene,
      content: sanitizeStoryHtml(scene.content),
      content_html: scene.content_html == null ? scene.content_html : sanitizeStoryHtml(scene.content_html),
    })),
  };
}
