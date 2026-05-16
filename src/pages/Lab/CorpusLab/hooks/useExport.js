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
import { toVietnameseErrorMessage } from '../../../../utils/errorMessages';

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
      setExportError(toVietnameseErrorMessage(error, 'Không tạo được bản xem trước export.'));
      return null;
    }
  }, []);

  const handleExport = useCallback(async (events, format, options = {}) => {
    if (!events || !events.length) {
      setExportError('Chưa chọn sự kiện nào để export.');
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
        throw new Error(`Định dạng export chưa được hỗ trợ: ${format}`);
      }
    } catch (error) {
      const message = toVietnameseErrorMessage(error, 'Không export được dữ liệu.');
      setExportError(message);
      return { success: false, error: message };
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

