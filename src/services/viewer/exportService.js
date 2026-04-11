/**
 * Export Service - Export events to various formats
 * JSON, Markdown, CSV, clipboard
 */

/**
 * Export selected events to specified format
 */
export async function exportEvents(selectedEvents, options = {}) {
  const {
    format = 'markdown',
    includeAnnotations = true,
    includeCharacterInfo = true,
    includeChapterRefs = true,
    includeFullDescriptions = false,
    includeIntensity = false,
    includeTags = true,
    includeRarity = true,
  } = options;

  switch (format) {
    case 'json':
      return exportAsJSON(selectedEvents, options);
    case 'markdown':
    case 'md':
      return exportAsMarkdown(selectedEvents, options);
    case 'csv':
      return exportAsCSV(selectedEvents, options);
    case 'clipboard':
      return exportAsClipboard(selectedEvents, options);
    case 'html':
      return exportAsHTML(selectedEvents, options);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Export as JSON
 */
export function exportAsJSON(events, options = {}) {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: events.length,
    events: events.map(e => ({
      id: e.id,
      description: e.description,
      severity: e.severity,
      chapter: e.chapter,
      chapterEnd: e.chapterEnd,
      location: e.locationLink || null,
      incidentId: e.incidentId || null,
      position: e.position,
      canonOrFanon: e.canonOrFanon,
      rarity: e.rarity,
      tags: e.tags,
      characters: options.includeCharacterInfo ? e.characters : undefined,
      ships: options.includeCharacterInfo ? e.ships : undefined,
      emotionalIntensity: options.includeIntensity ? e.emotionalIntensity : undefined,
      insertability: options.includeIntensity ? e.insertability : undefined,
      annotation: options.includeAnnotations ? e.annotation : undefined,
      subevents: e.subevents,
      _type: e._type,
    })),
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Export as Markdown
 */
export function exportAsMarkdown(events, options = {}) {
  const {
    includeAnnotations = true,
    includeCharacterInfo = true,
    includeChapterRefs = true,
    includeIntensity = false,
    includeTags = true,
    includeRarity = true,
  } = options;

  let md = `# Exported Events\n\n`;
  md += `**Generated:** ${new Date().toLocaleString('vi-VN')}\n\n`;
  md += `**Total:** ${events.length} events\n\n`;
  md += `---\n\n`;

  const severityEmoji = {
    crucial: '🔴',
    major: '🟠',
    moderate: '🟡',
    minor: '⚪',
  };

  const canonEmoji = {
    canon: '🔵',
    fanon: '🟣',
  };

  for (const event of events) {
    const sevEmoji = severityEmoji[event.severity] || '⚪';
    const canonType = event.canonOrFanon?.type || 'canon';
    const canonEmojiStr = canonEmoji[canonType] || '🔵';

    md += `## ${sevEmoji} ${event.description}\n\n`;

    if (includeChapterRefs && event.chapter) {
      const chLabel = event.chapterEnd && event.chapterEnd !== event.chapter
        ? `Ch. ${event.chapter}-${event.chapterEnd}`
        : `Ch. ${event.chapter}`;
      md += `**${chLabel}**  ·  `;
    }
    if (event.locationLink?.locationName) {
      md += `**Địa điểm:** ${event.locationLink.locationName}  ·  `;
    }

    md += `**Severity:** ${capitalize(event.severity)}  ·  `;
    md += `${canonEmojiStr} ${capitalize(canonType)}`;

    if (includeRarity && event.rarity) {
      const rareStar = event.rarity.score === 'rare' ? '⭐ ' : '';
      md += `  ·  ${rareStar}${capitalize(event.rarity.label || event.rarity.score)}`;
    }

    if (includeIntensity && event.emotionalIntensity) {
      md += `  ·  🔥 Intensity: ${event.emotionalIntensity}/10`;
    }

    md += `\n\n`;

    if (includeCharacterInfo && event.characters?.length) {
      md += `**Characters:** ${event.characters.join(', ')}\n\n`;
    }

    if (includeCharacterInfo && event.ships?.length) {
      md += `**Ships:** ${event.ships.join(', ')}\n\n`;
    }

    if (includeTags && event.tags?.length) {
      const tagList = event.tags.map(t => `\`${t}\``).join(' ');
      md += `**Tags:** ${tagList}\n\n`;
    }

    if (includeAnnotations && event.annotation?.note) {
      md += `> 📝 *${event.annotation.note}*\n\n`;
    }

    md += `---\n\n`;
  }

  return md;
}

/**
 * Export as CSV
 */
export function exportAsCSV(events, options = {}) {
  const {
    includeAnnotations = true,
    includeCharacterInfo = true,
    includeChapterRefs = true,
    includeIntensity = true,
    includeTags = true,
    includeRarity = true,
  } = options;

  const headers = ['ID', 'Description', 'Severity', 'Chapter', 'Canon/Fanon', 'Rarity', 'Location', 'Incident'];

  if (includeChapterRefs) headers.push('Chapter', 'Chapter End', 'Position');
  if (includeCharacterInfo) headers.push('Characters', 'Ships');
  if (includeTags) headers.push('Tags');
  if (includeIntensity) headers.push('Emotional Intensity', 'Insertability');
  if (includeAnnotations) headers.push('Annotation', 'Starred', 'Custom Tags', 'Linked Projects');

  const rows = [headers.join(',')];

  for (const event of events) {
    const row = [
      csvEscape(event.id || ''),
      csvEscape(event.description || ''),
      csvEscape(event.severity || ''),
      csvEscape(String(event.chapter || '')),
      csvEscape(event.canonOrFanon?.type || 'canon'),
      csvEscape(event.rarity?.score || ''),
      csvEscape(event.locationLink?.locationName || event.primaryLocationName || ''),
      csvEscape(event.incidentId || ''),
    ];

    if (includeChapterRefs) {
      row.push(csvEscape(String(event.chapter || '')));
      row.push(csvEscape(String(event.chapterEnd || '')));
      row.push(csvEscape(event.position || ''));
    }

    if (includeCharacterInfo) {
      row.push(csvEscape((event.characters || []).join('; ')));
      row.push(csvEscape((event.ships || []).join('; ')));
    }

    if (includeTags) {
      row.push(csvEscape((event.tags || []).join('; ')));
    }

    if (includeIntensity) {
      row.push(csvEscape(String(event.emotionalIntensity || '')));
      row.push(csvEscape(String(event.insertability || '')));
    }

    if (includeAnnotations) {
      row.push(csvEscape(event.annotation?.note || ''));
      row.push(event.annotation?.starred ? 'Yes' : 'No');
      row.push(csvEscape((event.annotation?.customTags || []).join('; ')));
      row.push(csvEscape((event.annotation?.linkedProjectIds || []).join('; ')));
    }

    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * Copy to clipboard (returns text for clipboard API)
 */
export async function exportAsClipboard(events, options = {}) {
  const format = options.clipboardFormat || 'markdown';
  const text = await exportEvents(events, { ...options, format });
  return text;
}

/**
 * Export as HTML (for rich-text copy)
 */
export function exportAsHTML(events, options = {}) {
  const {
    includeAnnotations = true,
    includeCharacterInfo = true,
    includeChapterRefs = true,
    includeIntensity = false,
    includeTags = true,
  } = options;

  let html = `<div class="storyforge-export">\n`;
  html += `<h1>Exported Events</h1>\n`;
  html += `<p><em>Generated: ${new Date().toLocaleString('vi-VN')}</em></p>\n`;
  html += `<p><strong>Total: ${events.length} events</strong></p>\n`;
  html += `<hr/>\n`;

  for (const event of events) {
    html += `<div class="event">\n`;
    html += `<h2>${escapeHtml(event.description || '')}</h2>\n`;

    const meta = [];
    if (event.chapter) meta.push(`Ch. ${event.chapter}`);
    meta.push(capitalize(event.severity || ''));
    meta.push(`${event.canonOrFanon?.type === 'fanon' ? 'Fanon' : 'Canon'}`);
    if (event.rarity?.score === 'rare') meta.push('⭐ Rare');

    html += `<p class="meta">${meta.join(' · ')}</p>\n`;

    if (includeCharacterInfo && event.characters?.length) {
      html += `<p><strong>Characters:</strong> ${escapeHtml(event.characters.join(', '))}</p>\n`;
    }

    if (includeTags && event.tags?.length) {
      const tagHtml = event.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
      html += `<p><strong>Tags:</strong> ${tagHtml}</p>\n`;
    }

    if (includeIntensity && event.emotionalIntensity) {
      html += `<p><strong>Intensity:</strong> ${event.emotionalIntensity}/10</p>\n`;
    }

    if (includeAnnotations && event.annotation?.note) {
      html += `<blockquote>📝 ${escapeHtml(event.annotation.note)}</blockquote>\n`;
    }

    html += `</div>\n`;
  }

  html += `</div>\n`;

  return html;
}

/**
 * Trigger file download in browser
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard using Clipboard API
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Get filename for export
 */
export function getExportFilename(format, prefix = 'events') {
  const timestamp = new Date().toISOString().slice(0, 10);
  const ext = {
    json: 'json',
    markdown: 'md',
    md: 'md',
    csv: 'csv',
    html: 'html',
  }[format] || 'txt';

  return `${prefix}-${timestamp}.${ext}`;
}

// Helpers
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function csvEscape(str) {
  const s = String(str || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


