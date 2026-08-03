import type { BufferAsset } from '../graph/types';

const DATABASE_NAME = 'visual-fm-2.buffers.v1';
const STORE_NAME = 'contents';
const DATABASE_VERSION = 1;
let databasePromise: Promise<IDBDatabase> | null = null;

interface StoredBufferContent {
  hash: string;
  data: ArrayBuffer;
}

export interface StoredBufferSnapshot {
  samples: Float32Array;
  sampleRate: number;
}

export async function storeBufferSnapshot(snapshot: StoredBufferSnapshot): Promise<BufferAsset> {
  const data = copyFloat32Bytes(snapshot.samples);
  const hash = await sha256Hex(data);
  const database = await openBufferDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ hash, data } satisfies StoredBufferContent);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save Buffer content.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Buffer save was aborted.'));
  });
  return { hash, sampleRate: snapshot.sampleRate, sampleCount: snapshot.samples.length };
}

function copyFloat32Bytes(samples: Float32Array): ArrayBuffer {
  const copy = new Uint8Array(samples.byteLength);
  copy.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  return copy.buffer;
}

export async function loadBufferSnapshot(asset: BufferAsset): Promise<StoredBufferSnapshot | null> {
  const database = await openBufferDatabase();
  const stored = await new Promise<StoredBufferContent | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(asset.hash);
    request.onsuccess = () => resolve(request.result as StoredBufferContent | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read Buffer content.'));
  });
  if (!stored?.data || stored.data.byteLength !== asset.sampleCount * Float32Array.BYTES_PER_ELEMENT) return null;
  return { samples: new Float32Array(stored.data), sampleRate: asset.sampleRate };
}

export async function storeBufferAssetData(asset: BufferAsset, data: ArrayBuffer): Promise<void> {
  if (data.byteLength !== asset.sampleCount * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Buffer ${asset.hash} has an unexpected size.`);
  }
  if (await sha256Hex(data) !== asset.hash) {
    throw new Error(`Buffer ${asset.hash} failed its integrity check.`);
  }
  const database = await openBufferDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ hash: asset.hash, data } satisfies StoredBufferContent);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not cache Buffer content.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Buffer cache was aborted.'));
  });
}

export async function removeUnreferencedBufferContents(referencedHashes: Iterable<string>): Promise<void> {
  const keep = new Set(referencedHashes);
  const database = await openBufferDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === 'string' && !keep.has(cursor.key)) store.delete(cursor.key);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clean Buffer storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Buffer cleanup was aborted.'));
  });
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function openBufferDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'hash' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Could not open Buffer storage.'));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('Buffer storage upgrade is blocked by another tab.'));
    };
  });
  return databasePromise;
}
