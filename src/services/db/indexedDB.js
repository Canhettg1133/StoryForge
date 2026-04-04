const DB_NAME = 'storyforge-jobs';
const DB_VERSION = 1;
const STORE_NAME = 'jobs';

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openJobsDatabase() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openJobsDatabase();
  if (!db) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    const request = callback(store);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveJobToIndexedDB(job) {
  if (!job?.id) {
    return null;
  }

  return withStore('readwrite', (store) => store.put(job));
}

export async function getJobFromIndexedDB(jobId) {
  if (!jobId) {
    return null;
  }

  return withStore('readonly', (store) => store.get(jobId));
}

export async function getAllJobsFromIndexedDB() {
  return (await withStore('readonly', (store) => store.getAll())) || [];
}

export async function deleteJobFromIndexedDB(jobId) {
  if (!jobId) {
    return null;
  }

  return withStore('readwrite', (store) => store.delete(jobId));
}

