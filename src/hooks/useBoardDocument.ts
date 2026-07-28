import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTextEditableShape, type BoardDocument, type BoardShape, type CanvasSettings } from '../types';
import { resolveBoundConnectors } from '../utils/geometry';
import { createBlankDocument, parseBoardDocument } from '../utils/document';
import { loadPersistedDocument, savePersistedDocument } from '../utils/persistence';

export const STORAGE_KEY = 'museboard.document.v1';
const MAX_HISTORY = 80;
const HISTORY_GROUP_WINDOW_MS = 500;

export interface HistoryCommitOptions {
  /** Consecutive commits with the same key become a single undo step. */
  historyGroup?: string;
}

interface HistoryState {
  past: BoardDocument[];
  present: BoardDocument;
  future: BoardDocument[];
  lastCommit?: { group: string; at: number };
}

export type ShapeUpdater = (shapes: BoardShape[]) => BoardShape[];

function normalizeShapes(shapes: BoardShape[]) {
  return shapes.map((shape) => {
    if (!isTextEditableShape(shape)) return shape;
    const text = shape.text ?? '';
    const textColor = shape.textColor ?? (shape.type === 'note' ? '#3f3a24' : '#172033');
    const fontSize = shape.fontSize ?? 18;
    const fontFamily = shape.fontFamily ?? 'Inter, Microsoft YaHei, sans-serif';
    const textAlign = shape.textAlign ?? (shape.type === 'text' || shape.type === 'note' ? 'left' : 'center');
    if (
      shape.text === text
      && shape.textColor === textColor
      && shape.fontSize === fontSize
      && shape.fontFamily === fontFamily
      && shape.textAlign === textAlign
    ) return shape;
    return { ...shape, text, textColor, fontSize, fontFamily, textAlign };
  });
}

function sameShape(first: BoardShape, second: BoardShape) {
  if (first === second) return true;
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]) as Set<keyof BoardShape>;
  for (const key of keys) {
    const firstValue = first[key];
    const secondValue = second[key];
    if (Array.isArray(firstValue) || Array.isArray(secondValue)) {
      if (!Array.isArray(firstValue) || !Array.isArray(secondValue)) return false;
      if (firstValue.length !== secondValue.length || firstValue.some((value, index) => value !== secondValue[index])) return false;
    } else if (firstValue !== secondValue) return false;
  }
  return true;
}

function sameShapes(first: BoardShape[], second: BoardShape[]) {
  return first === second || (
    first.length === second.length
    && first.every((shape, index) => sameShape(shape, second[index]))
  );
}

function sameDocumentContent(first: BoardDocument, second: BoardDocument) {
  return first === second || (
    first.version === second.version
    && first.title === second.title
    && first.settings.background === second.settings.background
    && first.settings.grid === second.settings.grid
    && first.settings.snap === second.settings.snap
    && first.settings.guides === second.settings.guides
    && sameShapes(first.shapes, second.shapes)
  );
}

interface InitialDocument {
  document: BoardDocument;
  fromStorage: boolean;
  invalidStoredDocument: boolean;
}

function loadInitialDocument(): InitialDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { document: createBlankDocument(), fromStorage: false, invalidStoredDocument: false };
    const document = parseBoardDocument(JSON.parse(raw), { stripLegacyStarters: true });
    return {
      document: { ...document, shapes: resolveBoundConnectors(normalizeShapes(document.shapes)) },
      fromStorage: true,
      invalidStoredDocument: false,
    };
  } catch {
    return { document: createBlankDocument(), fromStorage: false, invalidStoredDocument: true };
  }
}

const touch = (document: BoardDocument): BoardDocument => ({ ...document, updatedAt: Date.now() });

export function useBoardDocument() {
  const initialDocumentRef = useRef<InitialDocument | null>(null);
  if (!initialDocumentRef.current) initialDocumentRef.current = loadInitialDocument();
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    present: initialDocumentRef.current!.document,
    future: [],
  }));
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [persistenceReady, setPersistenceReady] = useState(false);
  const presentRef = useRef(history.present);
  const saveSequenceRef = useRef(0);
  const persistenceBlockedRef = useRef(initialDocumentRef.current.invalidStoredDocument);
  presentRef.current = history.present;

  useEffect(() => {
    let cancelled = false;
    void loadPersistedDocument()
      .then((stored) => {
        if (!stored || cancelled) return;
        let document: BoardDocument;
        try {
          document = parseBoardDocument(stored, { stripLegacyStarters: true });
        } catch {
          if (!initialDocumentRef.current?.fromStorage) {
            persistenceBlockedRef.current = true;
            setSaveState('error');
          }
          return;
        }
        setHistory((current) => {
          const shouldRestore = !initialDocumentRef.current?.fromStorage || document.updatedAt > current.present.updatedAt;
          if (!shouldRestore) return current;
          persistenceBlockedRef.current = false;
          return {
            past: [],
            present: { ...document, shapes: resolveBoundConnectors(normalizeShapes(document.shapes)) },
            future: [],
          };
        });
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setPersistenceReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;
    if (persistenceBlockedRef.current && history.present === initialDocumentRef.current?.document) {
      setSaveState('error');
      return;
    }
    persistenceBlockedRef.current = false;
    const sequence = ++saveSequenceRef.current;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      let localSaved = false;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.present));
        localSaved = true;
      } catch { /* IndexedDB remains available for larger documents. */ }
      void savePersistedDocument(history.present)
        .then(() => { if (saveSequenceRef.current === sequence) setSaveState('saved'); })
        .catch(() => {
          if (saveSequenceRef.current === sequence) setSaveState(localSaved ? 'saved' : 'error');
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [history.present, persistenceReady]);

  const commitDocument = useCallback((
    updater: (document: BoardDocument) => BoardDocument,
    options?: HistoryCommitOptions,
  ) => {
    const committedAt = Date.now();
    setHistory((current) => {
      const next = updater(current.present);
      if (sameDocumentContent(current.present, next)) return current;
      const grouped = Boolean(
        options?.historyGroup
        && current.lastCommit?.group === options.historyGroup
        && committedAt - current.lastCommit.at <= HISTORY_GROUP_WINDOW_MS,
      );
      return {
        past: grouped ? current.past : [...current.past, current.present].slice(-MAX_HISTORY),
        present: touch(next),
        future: [],
        lastCommit: options?.historyGroup ? { group: options.historyGroup, at: committedAt } : undefined,
      };
    });
  }, []);

  const commitShapes = useCallback((updater: ShapeUpdater, options?: HistoryCommitOptions) => {
    commitDocument((document) => {
      const updated = updater(document.shapes);
      if (sameShapes(document.shapes, updated)) return document;
      return {
        ...document,
        shapes: resolveBoundConnectors(normalizeShapes(updated)),
      };
    }, options);
  }, [commitDocument]);

  const previewShapes = useCallback((updater: ShapeUpdater) => {
    setHistory((current) => {
      const updated = updater(current.present.shapes);
      if (sameShapes(current.present.shapes, updated)) return current;
      const shapes = resolveBoundConnectors(normalizeShapes(updated));
      if (sameShapes(current.present.shapes, shapes)) return current;
      return { ...current, present: { ...current.present, shapes } };
    });
  }, []);

  const commitPreview = useCallback((snapshot: BoardShape[]) => {
    setHistory((current) => {
      const shapes = resolveBoundConnectors(normalizeShapes(current.present.shapes));
      if (sameShapes(snapshot, shapes)) return current;
      return {
        past: [...current.past, { ...current.present, shapes: snapshot }].slice(-MAX_HISTORY),
        present: touch({ ...current.present, shapes }),
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
        lastCommit: undefined,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present].slice(-MAX_HISTORY),
        present: next,
        future: current.future.slice(1),
        lastCommit: undefined,
      };
    });
  }, []);

  const setTitle = useCallback((title: string) => {
    setHistory((current) => title === current.present.title ? current : ({
      ...current,
      future: [],
      present: touch({ ...current.present, title }),
      lastCommit: undefined,
    }));
  }, []);

  const setSettings = useCallback((patch: Partial<CanvasSettings>) => {
    commitDocument((document) => ({
      ...document,
      settings: { ...document.settings, ...patch },
    }));
  }, [commitDocument]);

  const importDocument = useCallback((document: BoardDocument) => {
    setHistory((current) => {
      const next = {
        ...document,
        shapes: resolveBoundConnectors(normalizeShapes(document.shapes)),
        settings: { ...document.settings, guides: document.settings.guides ?? true },
      };
      if (sameDocumentContent(current.present, next)) return current;
      return {
        past: [...current.past, current.present].slice(-MAX_HISTORY),
        present: touch(next),
        future: [],
      };
    });
  }, []);

  const clearDocument = useCallback(() => {
    commitDocument((document) => ({ ...document, shapes: [] }));
  }, [commitDocument]);

  return useMemo(() => ({
    document: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveState,
    presentRef,
    commitDocument,
    commitShapes,
    previewShapes,
    commitPreview,
    undo,
    redo,
    setTitle,
    setSettings,
    importDocument,
    clearDocument,
  }), [
    history.present,
    history.past.length,
    history.future.length,
    saveState,
    commitDocument,
    commitShapes,
    previewShapes,
    commitPreview,
    undo,
    redo,
    setTitle,
    setSettings,
    importDocument,
    clearDocument,
  ]);
}
