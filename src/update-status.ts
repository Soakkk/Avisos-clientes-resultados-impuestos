export type UpdatePhase = 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

export interface UpdateStatus {
  status: UpdatePhase;
  version?: string;
  percent?: number;
  message?: string;
  recoverable?: boolean;
  workspaceSaved: boolean;
}

export type UpdateEvent =
  | { type: 'check' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'install-requested' }
  | { type: 'workspace-saved' }
  | { type: 'workspace-save-failed'; message: string }
  | { type: 'install' }
  | { type: 'error'; message: string; recoverable?: boolean };

export const initialUpdateStatus: UpdateStatus = { status: 'checking', workspaceSaved: false };

export function canInstallUpdate(state: UpdateStatus): boolean {
  return state.status === 'ready' && state.workspaceSaved;
}

export function updateStatusReducer(state: UpdateStatus, event: UpdateEvent): UpdateStatus {
  switch (event.type) {
    case 'check':
      return { status: 'checking', workspaceSaved: false };
    case 'available':
      return { status: 'downloading', version: event.version, percent: 0, workspaceSaved: false };
    case 'progress':
      return state.status === 'downloading' ? { ...state, percent: Math.max(0, Math.min(100, event.percent)) } : state;
    case 'downloaded':
      return { status: 'ready', version: event.version, workspaceSaved: false };
    case 'install-requested':
      return state.status === 'ready' ? { ...state, workspaceSaved: false } : state;
    case 'workspace-saved':
      return state.status === 'ready' ? { ...state, workspaceSaved: true } : state;
    case 'workspace-save-failed':
      return { status: 'error', version: state.version, message: event.message, recoverable: true, workspaceSaved: false };
    case 'install':
      return canInstallUpdate(state) ? { ...state, status: 'installing' } : state;
    case 'error':
      return { status: 'error', version: state.version, message: event.message, recoverable: event.recoverable, workspaceSaved: false };
  }
}
