import type {
  CaptureItem,
  CaptureProcessResult,
  CaptureQueueAction,
  CaptureQueueState,
} from './types';

export const initialQueueState: CaptureQueueState = { items: [] };
export const RETRY_DELAYS = [1_000, 2_000, 4_000] as const;

export class TemporaryCaptureError extends Error {
  readonly temporary = true;
}

export function isTemporaryCaptureError(error: unknown): boolean {
  return error instanceof TemporaryCaptureError
    || (typeof error === 'object' && error !== null && (error as { temporary?: unknown }).temporary === true);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function queueReducer(state: CaptureQueueState, action: CaptureQueueAction): CaptureQueueState {
  switch (action.type) {
    case 'hydrate':
      return { items: action.items.map((item) => item.status === 'processing' ? { ...item, status: 'pending' } : item) };
    case 'enqueue':
      return { items: [...state.items, ...action.items] };
    case 'start': {
      // Por defecto una captura cada vez; con clave de pago se pueden leer varias
      // en paralelo (límite configurable en Ajustes).
      const limit = Math.max(1, action.limit ?? 1);
      if (state.items.filter((item) => item.status === 'processing').length >= limit) return state;
      return {
        items: state.items.map((item) => item.id === action.id && item.status === 'pending'
          ? { ...item, status: 'processing', attempts: item.attempts + 1, error: undefined }
          : item),
      };
    }
    case 'complete':
      return {
        items: state.items.map((item) => item.id === action.id
          ? { ...item, status: 'review', jointId: action.jointId, error: undefined }
          : item),
      };
    case 'schedule-retry':
      return {
        items: state.items.map((item) => item.id === action.id
          ? { ...item, status: 'pending', error: action.error }
          : item),
      };
    case 'retry':
      return {
        items: state.items.map((item) => item.id === action.id
          ? { ...item, status: 'pending', attempts: 0, error: action.error }
          : item),
      };
    case 'review':
      return {
        items: state.items.map((item) => item.id === action.id
          ? { ...item, status: 'review', error: action.error }
          : item),
      };
    case 'fail':
      return {
        items: state.items.map((item) => item.id === action.id
          ? { ...item, status: 'failed', error: action.error }
          : item),
      };
    case 'remove':
      return { items: state.items.filter((item) => item.id !== action.id) };
  }
}

export async function runCaptureQueue(
  initialItems: CaptureItem[],
  options: {
    process: (item: CaptureItem) => Promise<CaptureProcessResult>;
    persist: (items: CaptureItem[]) => Promise<void>;
    sleep?: (milliseconds: number) => Promise<void>;
  },
): Promise<CaptureItem[]> {
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let state: CaptureQueueState = { items: structuredClone(initialItems) };

  const apply = async (action: CaptureQueueAction) => {
    state = queueReducer(state, action);
    await options.persist(state.items);
  };

  while (state.items.some((item) => item.status === 'pending')) {
    const next = state.items.find((item) => item.status === 'pending');
    if (!next) break;
    await apply({ type: 'start', id: next.id });
    const processing = state.items.find((item) => item.id === next.id)!;
    try {
      const result = await options.process(processing);
      await apply({ type: 'complete', id: processing.id, jointId: result.jointId });
    } catch (error) {
      const message = errorMessage(error);
      if (isTemporaryCaptureError(error) && processing.attempts <= RETRY_DELAYS.length) {
        await apply({ type: 'schedule-retry', id: processing.id, error: message });
        await sleep(RETRY_DELAYS[processing.attempts - 1]);
      } else if (isTemporaryCaptureError(error)) {
        await apply({ type: 'fail', id: processing.id, error: message });
      } else {
        await apply({ type: 'review', id: processing.id, error: message });
      }
    }
  }

  return state.items;
}
