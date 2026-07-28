import type { BoardDocument, BoardShape } from '../types';

export const DATABASE_NAME = 'museboard.local';
export const DATABASE_VERSION = 2;
export const DOCUMENT_STORE = 'documents';
export const ASSET_STORE = 'assets';
const ACTIVE_DOCUMENT_ID = 'active';
const MAX_PREPARED_ASSETS = 64;

interface StoredDocument {
  id: string;
  document: BoardDocument;
  updatedAt: number;
}

interface StoredAsset {
  id: string;
  blob: Blob;
  mimeType: string;
  size: number;
  updatedAt: number;
}

interface PreparedAsset extends StoredAsset {
  dataUrl: string;
}

const preparedAssetsByUrl = new Map<string, PreparedAsset>();
const persistedAssetIds = new Set<string>();

function cachePreparedAsset(asset: PreparedAsset) {
  preparedAssetsByUrl.delete(asset.dataUrl);
  preparedAssetsByUrl.set(asset.dataUrl, asset);
  if (preparedAssetsByUrl.size > MAX_PREPARED_ASSETS) {
    const oldest = preparedAssetsByUrl.keys().next().value;
    if (oldest) preparedAssetsByUrl.delete(oldest);
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted'));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open the local board database'));
  });
}

function isEmbeddedAssetUrl(url: string | undefined) {
  return Boolean(url && (url.startsWith('data:image/') || url.startsWith('blob:')));
}

async function contentAddress(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    return `asset-${hash}`;
  }

  // Stable fallback for older WebViews without SubtleCrypto.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const value of new Uint8Array(bytes)) {
    first = Math.imul(first ^ value, 0x01000193);
    second = Math.imul(second ^ value, 0x85ebca6b);
  }
  return `asset-${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}-${blob.size}`;
}

async function prepareAsset(url: string): Promise<PreparedAsset> {
  const cached = preparedAssetsByUrl.get(url);
  if (cached) {
    cachePreparedAsset(cached);
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to read an embedded image asset');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Embedded asset is not an image');
  const asset: PreparedAsset = {
    id: await contentAddress(blob),
    blob,
    mimeType: blob.type,
    size: blob.size,
    updatedAt: Date.now(),
    dataUrl: url,
  };
  cachePreparedAsset(asset);
  return asset;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Unable to materialize an image asset'));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to materialize an image asset'));
    reader.readAsDataURL(blob);
  });
}

async function externalizeDocumentAssets(document: BoardDocument) {
  const assets = new Map<string, PreparedAsset>();
  const shapes = await Promise.all(document.shapes.map(async (shape): Promise<BoardShape> => {
    if (shape.type !== 'image' || !isEmbeddedAssetUrl(shape.url)) return shape;
    const asset = await prepareAsset(shape.url!);
    assets.set(asset.id, asset);
    const { url: _embeddedUrl, ...storedShape } = shape;
    return { ...storedShape, assetId: asset.id };
  }));

  return {
    document: { ...document, shapes },
    assets: Array.from(assets.values()),
  };
}

async function hydrateDocumentAssets(database: IDBDatabase, document: BoardDocument) {
  const assetIds = Array.from(new Set(document.shapes
    .filter((shape) => shape.type === 'image' && !shape.url && shape.assetId)
    .map((shape) => shape.assetId!)));
  if (!assetIds.length) return document;

  const transaction = database.transaction(ASSET_STORE, 'readonly');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(ASSET_STORE);
  const records = await Promise.all(assetIds.map((id) => requestResult(store.get(id))));
  await completion;
  const assets = new Map<string, PreparedAsset>();
  await Promise.all(records.map(async (value) => {
    const record = value as StoredAsset | undefined;
    if (!record?.blob) return;
    try {
      const dataUrl = await blobToDataUrl(record.blob);
      const asset: PreparedAsset = { ...record, dataUrl };
      assets.set(record.id, asset);
      persistedAssetIds.add(record.id);
      cachePreparedAsset(asset);
    } catch {
      // A missing/corrupt asset must not prevent the rest of the board loading.
    }
  }));

  return {
    ...document,
    shapes: document.shapes.map((shape) => {
      if (shape.type !== 'image' || shape.url || !shape.assetId) return shape;
      const asset = assets.get(shape.assetId);
      return asset ? { ...shape, url: asset.dataUrl } : shape;
    }),
  };
}

export async function loadPersistedDocument() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DOCUMENT_STORE, 'readonly');
    const completion = transactionDone(transaction);
    const stored = await requestResult(transaction.objectStore(DOCUMENT_STORE).get(ACTIVE_DOCUMENT_ID));
    await completion;
    const document = (stored as StoredDocument | undefined)?.document ?? null;
    return document ? await hydrateDocumentAssets(database, document) : null;
  } finally {
    database.close();
  }
}

export async function savePersistedDocument(document: BoardDocument) {
  const externalized = await externalizeDocumentAssets(document);
  const referencedAssetIds = new Set(externalized.document.shapes
    .filter((shape) => shape.type === 'image' && shape.assetId)
    .map((shape) => shape.assetId!));
  const database = await openDatabase();
  try {
    const transaction = database.transaction([DOCUMENT_STORE, ASSET_STORE], 'readwrite');
    const completion = transactionDone(transaction);
    const documentStore = transaction.objectStore(DOCUMENT_STORE);
    const assetStore = transaction.objectStore(ASSET_STORE);

    externalized.assets
      .filter((asset) => !persistedAssetIds.has(asset.id))
      .forEach(({ dataUrl: _dataUrl, ...asset }) => assetStore.put(asset));
    documentStore.put({
      id: ACTIVE_DOCUMENT_ID,
      document: externalized.document,
      updatedAt: externalized.document.updatedAt,
    } satisfies StoredDocument);

    const keysRequest = assetStore.getAllKeys();
    keysRequest.onsuccess = () => {
      keysRequest.result.forEach((key) => {
        if (typeof key === 'string' && !referencedAssetIds.has(key)) assetStore.delete(key);
      });
    };
    await completion;
    Array.from(persistedAssetIds).forEach((id) => {
      if (!referencedAssetIds.has(id)) persistedAssetIds.delete(id);
    });
    externalized.assets.forEach((asset) => persistedAssetIds.add(asset.id));
  } finally {
    database.close();
  }
}
