/**
 * useExport - Hook for exporting events
 */

import { useCallback, useState } from 'react';
import {
  exportEvents,
  downloadFile,
  copyToClipboard,
  getExportFilename,
} from '../../../../services/viewer/exportService.js';

export default function useExport() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportPreview, setExportPreview] = useState(null);

  const generatePreview = useCallback(async (events, format, options = {}) => {
    try {
      const preview = await exportEvents(events, { ...options, format });
      setExportPreview(preview);
      return preview;
    } catch (error) {
      setExportError(error.message);
      return null;
    }
  }, []);

  const handleExport = useCallback(async (events, format, options = {}) => {
    if (!events || !events.length) {
      setExportError('No events selected for export.');
      return null;
    }

    setExporting(true);
    setExportError(null);

    try {
      const content = await exportEvents(events, { ...options, format });

      switch (format) {
        case 'clipboard':
          await copyToClipboard(content);
          return { success: true, action: 'clipboard' };

        case 'json':
        case 'markdown':
        case 'csv':
        case 'html': {
          const mimeTypes = {
            json: 'application/json',
            markdown: 'text/markdown',
            md: 'text/markdown',
            csv: 'text/csv',
            html: 'text/html',
          };
          const filename = getExportFilename(format);
          downloadFile(content, filename, mimeTypes[format] || 'text/plain');
          return { success: true, action: 'download', filename };
        }

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      setExportError(error.message);
      return { success: false, error: error.message };
    } finally {
      setExporting(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setExportError(null);
  }, []);

  const clearPreview = useCallback(() => {
    setExportPreview(null);
  }, []);

  return {
    exporting,
    exportError,
    exportPreview,
    generatePreview,
    handleExport,
    clearError,
    clearPreview,
  };
}

