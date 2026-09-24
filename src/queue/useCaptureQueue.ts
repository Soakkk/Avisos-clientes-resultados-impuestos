import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  errorMessage,
  initialQueueState,
  isTemporaryCaptureError,
  queueReducer,
  RETRY_DELAYS,
} from './reducer';
import type { CaptureItem, CaptureProcessResult } from './types';

export function useCaptureQueue({
  initialItems = [],
  ready = true,
  concurrency = 1,
  process,
  persist,
}: {
  initialItems?: CaptureItem[];
  ready?: boolean;
  /** Capturas que se leen a la vez. */
  concurrency?: number;
  process: (item: CaptureItem) => Promise<CaptureProcessResult>;
  persist: (items: CaptureItem[]) => Promise<void>;
}) {
  const [state, dispatch] = useReducer(queueReducer, { items: initialItems }, (value) =>
    queueReducer(initialQueueState, { type: 'hydrate', items: value.items }));
  const inFlight = useRef(new Set<string>());
  const [savedItems, setSavedItems] = useState<CaptureItem[] | null>(null);
  const [storageError, setStorageError] = useState('');
  const blocked = useRef(false);
  const limit = Math.max(1, Math.floor(concurrency) || 1);

  useEffect(() => {
    if (!ready || blocked.current) return;
    void persist(state.items).then(() => setSavedItems(state.items)).catch((error) => {
      blocked.current = true;
      setStorageError(errorMessage(error));
    });
  }, [persist, ready, state.items]);

  // Cada transición se guarda en disco antes de lanzar la lectura: si la app se
  // cierra a medias, la bandeja se recupera en el mismo punto.
  useEffect(() => {
    if (!ready || blocked.current || savedItems !== state.items) return;
    const processing = state.items.filter((item) => item.status === 'processing');
    const next = state.items.find((item) => item.status === 'pending');
    if (processing.length < limit && next) dispatch({ type: 'start', id: next.id, limit });

    for (const item of processing) {
      if (inFlight.current.has(item.id)) continue;
      inFlight.current.add(item.id);
      const attempt = item.attempts;
      void process(item)
        .then((result) => dispatch({ type: 'complete', id: item.id, jointId: result.jointId }))
        .catch(async (error: unknown) => {
          const message = errorMessage(error);
          if (isTemporaryCaptureError(error) && attempt <= RETRY_DELAYS.length) {
            await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
            dispatch({ type: 'schedule-retry', id: item.id, error: message });
          } else if (isTemporaryCaptureError(error)) {
            dispatch({ type: 'fail', id: item.id, error: message });
          } else {
            dispatch({ type: 'review', id: item.id, error: message });
          }
        })
        .finally(() => { inFlight.current.delete(item.id); });
    }
  }, [limit, process, ready, savedItems, state.items]);

  const enqueue = useCallback((items: CaptureItem[]) => { if (!blocked.current) dispatch({ type: 'enqueue', items }); }, []);
  const retry = useCallback((id: string) => { if (!blocked.current) dispatch({ type: 'retry', id, error: '' }); }, []);
  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);
  const hydrate = useCallback((items: CaptureItem[]) => dispatch({ type: 'hydrate', items }), []);

  return { items: state.items, enqueue, retry, remove, hydrate, storageError };
}
