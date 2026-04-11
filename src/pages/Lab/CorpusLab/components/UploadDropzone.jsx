import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

const ACCEPT = '.txt,.epub,.pdf,.docx';

export default function UploadDropzone({
  onFileSelect,
  uploadState,
  uploadProgress,
  uploadError,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const isBusy = uploadState === 'uploading' || uploadState === 'processing';

  const handleFiles = (fileList) => {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    onFileSelect?.(file);
  };

  return (
    <div className="corpus-upload-box">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="corpus-file-input"
        onChange={(event) => handleFiles(event.target.files)}
        disabled={isBusy}
      />

      <button
        type="button"
        className={`corpus-dropzone ${isDragging ? 'is-dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isBusy) {
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (isBusy) {
            return;
          }
          handleFiles(event.dataTransfer?.files);
        }}
        disabled={isBusy}
      >
        <UploadCloud size={28} />
        <span className="dropzone-title">Kéo thả file vào đây</span>
        <span className="dropzone-subtitle">hoặc bấm để chọn file</span>
        <span className="dropzone-types">Hỗ trợ: TXT, EPUB, PDF, DOCX</span>
      </button>

      {isBusy && (
        <div className="corpus-upload-progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${uploadProgress || 0}%` }} />
          </div>
          <span>
            {uploadState === 'uploading' ? 'Đang tải lên...' : 'Đang tách nội dung...'} {Math.round(uploadProgress || 0)}%
          </span>
        </div>
      )}

      {uploadError && <p className="corpus-error">{uploadError}</p>}
    </div>
  );
}
