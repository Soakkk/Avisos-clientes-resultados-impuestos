export type CaptureStatus = 'pending' | 'processing' | 'review' | 'failed';

export interface CaptureItem {
  id: string;
  fileId: string;
  status: CaptureStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  jointId?: string;
}

export interface CaptureQueueState {
  items: CaptureItem[];
}

export type CaptureQueueAction =
  | { type: 'hydrate'; items: CaptureItem[] }
  | { type: 'enqueue'; items: CaptureItem[] }
  | { type: 'start'; id: string }
  | { type: 'complete'; id: string; jointId?: string }
  | { type: 'retry'; id: string; error: string }
  | { type: 'review'; id: string; error: string }
  | { type: 'fail'; id: string; error: string }
  | { type: 'remove'; id: string };

export interface CaptureProcessResult {
  jointId?: string;
}
