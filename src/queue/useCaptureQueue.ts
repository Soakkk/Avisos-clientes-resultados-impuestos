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
  process,
  persist,
}: {
  initialItems?: CaptureItem[];
  ready?: boolean;
  process: (item: CaptureItem) => Promise<CaptureProcessResult>;
  persist: (items: CaptureItem[]) => Promise<void>;
}) {
  const [state, dispatch] = useReducer(queueReducer, { items: initialItems }, (value) =>
    queueReducer(initialQueueState, { type: 'hydrate', items: value.items }));
  const working = useRef(false);
  const [savedItems, setSavedItems] = useState<CaptureItem[] | null>(null);
  const [storageError, setStorageError] = useState('');
  const blocked = useRef(false);

  useEffect(() => {
    if (!ready || blocked.current) return;
    void persist(state.items).then(() => setSavedItems(state.items)).catch((error) => {
      blocked.current = true;
      setStorageError(errorMessage(error));
    });
  }, [persist, ready, state.items]);

  useEffect(() => {
    if (!ready || blocked.current || savedItems !== state.items) return;
    const processing = state.items.find((item) => item.status === 'processing');
    const next = state.items.find((item) => item.status === 'pending');
    if (!processing) {
      if (next) dispatch({ type: 'start', id: next.id });
      return;
    }
    if (working.current) return;
    working.current = true;
    const attempt = processing.attempts;
    void process(processing)
      .then((result) => dispatch({ type: 'complete', id: processing.id, jointId: result.jointId }))
      .catch(async (error: unknown) => {
        const message = errorMessage(error);
        if (isTemporaryCaptureError(error) && attempt <= RETRY_DELAYS.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
          dispatch({ type: 'schedule-retry', id: processing.id, error: message });
        } else if (isTemporaryCaptureError(error)) {
          dispatch({ type: 'fail', id: processing.id, error: message });
        } else {
          dispatch({ type: 'review', id: processing.id, error: message });
        }
      })
      .finally(() => { working.current = false; });
  }, [process, ready, savedItems, state.items]);

  const enqueue = useCallback((items: CaptureItem[]) => { if (!blocked.current) dispatch({ type: 'enqueue', items }); }, []);
  const retry = useCallback((id: string) => { if (!blocked.current) dispatch({ type: 'retry', id, error: '' }); }, []);
  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);
  const hydrate = useCallback((items: CaptureItem[]) => dispatch({ type: 'hydrate', items }), []);

  return { items: state.items, enqueue, retry, remove, hydrate, storageError };
}
