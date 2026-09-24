import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

/**
 * Avisos y confirmaciones dentro de la propia ventana. Sustituyen a alert() y
 * confirm() del navegador, que bloqueaban la aplicación entera, no dejaban
 * copiar el texto del error y no permitían deshacer.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function useFeedback() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message: string, options: { tone?: ToastTone; detail?: string; action?: Toast['action']; duration?: number } = {}) => {
    const id = nextId.current++;
    const tone = options.tone || 'info';
    setToasts((items) => [...items.slice(-3), { id, tone, message, detail: options.detail, action: options.action }]);
    // Los errores se quedan hasta que se cierran: hay que poder leerlos con calma.
    const duration = options.duration ?? (tone === 'error' ? 0 : options.action ? 7000 : 3500);
    if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  }, [dismiss]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setPending({ ...options, resolve });
  }), []);

  const answer = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => () => { timers.current.forEach((timer) => clearTimeout(timer)); }, []);

  return { toasts, notify, dismiss, confirm, pending, answer };
}

const TONE_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone];
        return (
          <div key={toast.id} className="toast" data-tone={toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <Icon className="toast-icon" aria-hidden="true" />
            <div className="toast-body">
              <p>{toast.message}</p>
              {toast.detail && <small>{toast.detail}</small>}
            </div>
            {toast.action && (
              <button type="button" className="toast-action" onClick={() => { toast.action!.run(); onDismiss(toast.id); }}>
                {toast.action.label}
              </button>
            )}
            <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Cerrar aviso">
              <X aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmDialog({ pending, onAnswer }: { pending: ConfirmOptions | null; onAnswer: (value: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onAnswer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, onAnswer]);

  if (!pending) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onAnswer(false); }}>
      <div className="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-body">
          <h2 id="confirm-title" className="dialog-title">{pending.title}</h2>
          <p className="dialog-text">{pending.message}</p>
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn" onClick={() => onAnswer(false)}>{pending.cancelLabel || 'Cancelar'}</button>
          <button ref={confirmRef} type="button" className={pending.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => onAnswer(true)}>
            {pending.confirmLabel || 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}
