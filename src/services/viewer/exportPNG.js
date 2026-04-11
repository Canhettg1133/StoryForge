/**
 * ExportPNG - Utility to export SVG/Canvas elements as PNG images
 * Used for MindMap and CharacterGraph export
 */

/**
 * Export any DOM element (SVG, div with canvas) as PNG
 */
export async function exportElementAsPNG(element, options = {}) {
  const {
    filename = 'export.png',
    scale = 2, // Higher scale = better quality
    backgroundColor = '#1e293b', // Match dark theme
    padding = 40,
    format = 'image/png',
    quality = 0.95,
  } = options;

  if (!element) {
    throw new Error('No element provided for export');
  }

  try {
    // Get element dimensions
    const rect = element.getBoundingClientRect();
    const width = rect.width + padding * 2;
    const height = rect.height + padding * 2;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');

    // Scale context
    ctx.scale(scale, scale);

    // Fill background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Handle SVG elements
    if (element.tagName === 'svg' || element.querySelector('svg')) {
      await exportSVG(element, ctx, width, height, padding);
    } else {
      // For div/canvas elements, try html2canvas-like approach
      await exportDOMElement(element, ctx, width, height, padding);
    }

    // Convert to blob and download
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create image blob'));
            return;
          }

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          resolve({ success: true, filename });
        },
        format,
        quality
      );
    });
  } catch (err) {
    console.error('Export PNG failed:', err);
    throw err;
  }
}

/**
 * Export SVG element as PNG using serialization
 */
async function exportSVG(svgElement, ctx, width, height, padding) {
  // Clone SVG to avoid modifying original
  const clone = svgElement.cloneNode(true);

  // Get computed styles
  const computedStyle = window.getComputedStyle(svgElement);
  const bgColor = computedStyle.backgroundColor || '#1e293b';

  // Fill background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  // Serialize SVG
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(clone);

  // Add XML declaration and namespace if missing
  if (!svgString.includes('xmlns')) {
    svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Add background rect to SVG
  const bgRect = `<rect width="100%" height="100%" fill="${bgColor}"/>`;
  if (svgString.includes('<rect')) {
    svgString = svgString.replace('<rect', bgRect + '<rect');
  } else {
    svgString = svgString.replace('<svg', '<svg>' + bgRect);
    svgString = svgString.replace('</svg>', '</svg>');
  }

  // Encode as data URL
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      ctx.drawImage(img, padding, padding, width - padding * 2, height - padding * 2);
      URL.revokeObjectURL(svgUrl);
      resolve();
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Failed to load SVG as image'));
    };

    img.src = svgUrl;
  });
}

/**
 * Export generic DOM element as PNG using foreignObject or canvas
 */
async function exportDOMElement(element, ctx, width, height, padding) {
  // For complex HTML, we try SVG foreignObject approach
  // Fallback to simple canvas rendering

  try {
    // Try SVG foreignObject approach
    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="
            width: ${width}px;
            height: ${height}px;
            background: #1e293b;
            color: #e2e8f0;
            font-family: system-ui, sans-serif;
            overflow: hidden;
          ">
            ${element.outerHTML}
          </div>
        </foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(svgUrl);
        resolve();
      };

      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        // Fallback: just draw text
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '16px system-ui';
        ctx.fillText('Export preview not available', padding, padding + 30);
        resolve();
      };

      img.src = svgUrl;
    });
  } catch {
    // Final fallback
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '16px system-ui';
    ctx.fillText('Visualization export', padding, padding + 30);
  }
}

/**
 * Export SVG directly as SVG file (vector, no quality loss)
 */
export function exportSVGFile(element, options = {}) {
  const {
    filename = 'export.svg',
  } = options;

  if (!element) {
    throw new Error('No element provided for export');
  }

  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(element);

  // Add XML declaration
  svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { success: true, filename: a.download };
}

/**
 * Capture component as data URL (for sharing/previews)
 */
export async function captureAsDataURL(element, options = {}) {
  const {
    scale = 2,
    backgroundColor = '#1e293b',
    padding = 20,
  } = options;

  const rect = element.getBoundingClientRect();
  const width = rect.width + padding * 2;
  const height = rect.height + padding * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  if (element.tagName === 'svg' || element.querySelector('svg')) {
    await exportSVG(element, ctx, width, height, padding);
  } else {
    await exportDOMElement(element, ctx, width, height, padding);
  }

  return canvas.toDataURL('image/png', 0.95);
}
