// Armazenamento local em IndexedDB: o cofre cifrado ('kv') e os anexos cifrados ('files').
// Nada aqui é legível sem a senha mestra.

const DB_NAME = 'cofre';
const VERSION = 1;

export interface StoredFile {
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  get: <T>(key: string) => run<T | undefined>('kv', 'readonly', s => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run('kv', 'readwrite', s => s.put(value, key)),
  getFile: (id: string) => run<StoredFile | undefined>('files', 'readonly', s => s.get(id) as IDBRequest<StoredFile | undefined>),
  setFile: (id: string, f: StoredFile) => run('files', 'readwrite', s => s.put(f, id)),
  deleteFile: (id: string) => run('files', 'readwrite', s => s.delete(id)),
  fileIds: () => run<IDBValidKey[]>('files', 'readonly', s => s.getAllKeys()),
  clearFiles: () => run('files', 'readwrite', s => s.clear())
};
