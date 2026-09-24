import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { CaptureItem, CaptureStatus } from '../queue/types';

const STATUS: Record<CaptureStatus, { label: string; tone: string; Icon: typeof Clock3 }> = {
  pending: { label: 'En espera', tone: 'neutral', Icon: Clock3 },
  processing: { label: 'Leyendo', tone: 'accent', Icon: LoaderCircle },
  review: { label: 'Leída', tone: 'success', Icon: CheckCircle2 },
  failed: { label: 'Error', tone: 'danger', Icon: AlertTriangle },
};

/**
 * Capturas de la sesión que todavía necesitan algo: en espera, leyéndose o con
 * error. Las ya convertidas en aviso aparecen en la lista de avisos.
 */
export function CaptureQueue({
  items,
  selectedJointId,
  onRetry,
  onSelect,
  onViewCapture,
  onRemove,
}: {
  items: CaptureItem[];
  selectedJointId?: string | null;
  onRetry: (id: string) => void;
  onSelect: (jointId: string) => void;
  onViewCapture?: (fileId: string) => void;
  onRemove?: (id: string) => void;
}) {
  const visible = items.filter((item) => item.status !== 'review' || !item.jointId);
  if (visible.length === 0) return null;
  return (
    <section className="queue-panel" aria-labelledby="queue-heading">
      <h2 id="queue-heading" className="side-heading">
        Capturas en proceso <span className="count">{visible.length}</span>
      </h2>
      <ol className="queue-list">
        {visible.map((item) => {
          const index = items.indexOf(item);
          const needsReview = item.status === 'review' && !item.jointId;
          const status = needsReview ? { label: 'Revisar', tone: 'warning', Icon: AlertTriangle } : STATUS[item.status];
          const StatusIcon = status.Icon;
          return (
            <li key={item.id} data-status={item.status} data-selected={!!item.jointId && item.jointId === selectedJointId}>
              <button
                type="button"
                className="queue-item-main"
                disabled={!item.jointId}
                onClick={() => item.jointId && onSelect(item.jointId)}
              >
                <span className="queue-item-copy">
                  <span>Captura {index + 1}</span>
                  <small title={item.error}>{item.error || (item.attempts > 1 ? `${item.attempts} intentos` : status.label)}</small>
                </span>
                <span className="tag" data-tone={status.tone}>
                  <StatusIcon className={item.status === 'processing' ? 'is-spinning' : ''} aria-hidden="true" />
                  {status.label}
                </span>
              </button>
              {(needsReview || item.status === 'failed') && (
                <div className="queue-actions">
                  {onViewCapture && (
                    <button type="button" className="link-btn" onClick={() => onViewCapture(item.fileId)} aria-label={`Abrir original de captura ${index + 1}`}>
                      <ExternalLink aria-hidden="true" /> Original
                    </button>
                  )}
                  <button type="button" className="link-btn" onClick={() => onRetry(item.id)} aria-label={`Reintentar captura ${index + 1}`}>
                    <RefreshCw aria-hidden="true" /> Reintentar
                  </button>
                  {onRemove && (
                    <button type="button" className="link-btn" onClick={() => onRemove(item.id)} aria-label={`Quitar captura ${index + 1}`}>
                      <X aria-hidden="true" /> Quitar
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
