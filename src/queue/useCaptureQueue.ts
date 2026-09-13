import { useCallback, useEffect, useReducer, useRef } from 'react';
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

  useEffect(() => {
    if (!ready) return;
    void persist(state.items);
  }, [persist, ready, state.items]);

  useEffect(() => {
    if (!ready) return;
    const next = state.items.find((item) => item.status === 'pending');
    if (!next || working.current || state.items.some((item) => item.status === 'processing')) return;
    working.current = true;
    const attempt = next.attempts + 1;
    dispatch({ type: 'start', id: next.id });
    void process({ ...next, status: 'processing', attempts: attempt, error: undefined })
      .then((result) => dispatch({ type: 'complete', id: next.id, jointId: result.jointId }))
      .catch(async (error: unknown) => {
        const message = errorMessage(error);
        if (isTemporaryCaptureError(error) && attempt <= RETRY_DELAYS.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
          dispatch({ type: 'schedule-retry', id: next.id, error: message });
        } else if (isTemporaryCaptureError(error)) {
          dispatch({ type: 'fail', id: next.id, error: message });
        } else {
          dispatch({ type: 'review', id: next.id, error: message });
        }
      })
      .finally(() => { working.current = false; });
  }, [process, ready, state.items]);

  const enqueue = useCallback((items: CaptureItem[]) => dispatch({ type: 'enqueue', items }), []);
  const retry = useCallback((id: string) => dispatch({ type: 'retry', id, error: '' }), []);
  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), []);
  const hydrate = useCallback((items: CaptureItem[]) => dispatch({ type: 'hydrate', items }), []);

  return { items: state.items, enqueue, retry, remove, hydrate };
}
