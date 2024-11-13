import { openDB } from 'idb';

const DB_NAME = 'MediaDatabase';
const STORE_NAME = 'mediaFiles';

const initDB = async () => {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('fileName', 'fileName', { unique: false });
      }
    },
  });
};

export const calculateIndexedDBSize = async () => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  let totalSize = 0;

  await store.openCursor().then(function cursorIterate(cursor) {
    if (!cursor) return;
    const fileData = cursor.value;
    if (fileData.data && fileData.data.size) {
      totalSize += fileData.data.size;
    }
    return cursor.continue().then(cursorIterate);
  });

  await tx.done;
  return totalSize;
};

export const addFile = async (file) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const fileData = {
    fileName: file.name,
    fileType: file.type,
    size: file.size, // Include the file size
    data: file,
  };

  const id = await store.add(fileData);
  await tx.done;
  return id;
};

export const getFile = async (id) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const fileData = await store.get(id);
  await tx.done;
  return fileData;
};

export const getAllFiles = async () => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const allFiles = await store.getAll();
  await tx.done;
  return allFiles;
};

export const deleteFile = async (id) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await store.delete(id);
  await tx.done;
};
