import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import type { CaptureItem, CaptureStatus } from '../queue/types';

const STATUS: Record<CaptureStatus, { label: string; className: string; Icon: typeof Clock3 }> = {
  pending: { label: 'Pendiente', className: 'status-warning', Icon: Clock3 },
  processing: { label: 'Procesando', className: 'status-accent', Icon: LoaderCircle },
  review: { label: 'Revisar', className: 'status-success', Icon: CheckCircle2 },
  failed: { label: 'Error', className: 'status-danger', Icon: AlertTriangle },
};

export function CaptureQueue({
  items,
  selectedJointId,
  onRetry,
  onSelect,
}: {
  items: CaptureItem[];
  selectedJointId?: string | null;
  onRetry: (id: string) => void;
  onSelect: (jointId: string) => void;
}) {
  return (
    <section className="queue-panel" aria-labelledby="queue-heading">
      <div className="panel-heading">
        <div>
          <h2 id="queue-heading">Bandeja</h2>
          <p>{items.length} {items.length === 1 ? 'captura' : 'capturas'} en esta sesión</p>
        </div>
        <span className="queue-count">{items.filter((item) => item.status === 'pending').length} pendientes</span>
      </div>
      {items.length === 0 ? (
        <p className="empty-copy">Las capturas pegadas o arrastradas aparecerán aquí y se procesarán en orden.</p>
      ) : (
        <ol className="queue-list">
          {items.map((item, index) => {
            const status = STATUS[item.status];
            const StatusIcon = status.Icon;
            return (
              <li key={item.id} data-status={item.status} data-selected={item.jointId === selectedJointId}>
                <button
                  type="button"
                  className="queue-item-main"
                  disabled={!item.jointId}
                  onClick={() => item.jointId && onSelect(item.jointId)}
                >
                  <span className="queue-sequence">{index + 1}</span>
                  <span className="queue-item-copy">
                    <span>Captura {index + 1}</span>
                    <small>{item.error || `${item.attempts} ${item.attempts === 1 ? 'intento' : 'intentos'}`}</small>
                  </span>
                  <span className={`status-chip ${status.className}`}>
                    <StatusIcon className={item.status === 'processing' ? 'is-spinning' : ''} aria-hidden="true" />
                    {status.label}
                  </span>
                </button>
                {item.status === 'failed' && (
                  <button type="button" className="icon-action" onClick={() => onRetry(item.id)} aria-label={`Reintentar captura ${index + 1}`}>
                    <RefreshCw aria-hidden="true" /> Reintentar
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
