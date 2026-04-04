import { useMemo, useState } from 'react';
import useCorpusStore from '../../../../stores/corpusStore';

const DEFAULT_METADATA = {
  title: '',
  author: '',
  fandom: '',
  isCanonFanfic: '',
  rating: 'general',
  language: 'vi',
};

function inferTitle(fileName = '') {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export default function useCorpusUpload() {
  const [file, setFile] = useState(null);
  const [metadata, setMetadata] = useState(DEFAULT_METADATA);

  const uploadState = useCorpusStore((state) => state.uploadState);
  const uploadProgress = useCorpusStore((state) => state.uploadProgress);
  const uploadError = useCorpusStore((state) => state.uploadError);
  const chunkSize = useCorpusStore((state) => state.chunkSize);

  const uploadCorpus = useCorpusStore((state) => state.uploadCorpus);
  const resetUpload = useCorpusStore((state) => state.resetUpload);

  const isUploading = useMemo(
    () => uploadState === 'uploading' || uploadState === 'processing',
    [uploadState],
  );

  const selectFile = (nextFile) => {
    if (!nextFile) {
      return;
    }

    setFile(nextFile);
    setMetadata((prev) => ({
      ...prev,
      title: prev.title || inferTitle(nextFile.name),
    }));
    resetUpload();
  };

  const updateMetadata = (key, value) => {
    setMetadata((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const submitUpload = async () => {
    if (!file) {
      throw new Error('Vui lòng chọn file trước khi upload.');
    }

    const payload = {
      ...metadata,
      chunkSize,
    };

    const result = await uploadCorpus(file, payload);
    return result;
  };

  const reset = () => {
    setFile(null);
    setMetadata(DEFAULT_METADATA);
    resetUpload();
  };

  return {
    file,
    metadata,
    uploadState,
    uploadProgress,
    uploadError,
    isUploading,
    selectFile,
    updateMetadata,
    submitUpload,
    reset,
  };
}


