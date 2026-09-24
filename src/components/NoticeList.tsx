import { FileStack } from 'lucide-react';
import { summarizeJoint } from '../summary';
import type { JointNotice } from '../types';

const money = (value: number) => `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export type JointState = 'ok' | 'review' | 'unverified';

export function jointState(joint: JointNotice): JointState {
  if (joint.notices.some((notice) => notice.verificacion?.estado === 'revisar')) return 'review';
  if (joint.notices.some((notice) => !notice.verificacion || notice.verificacion.estado === 'sin-verificar')) return 'unverified';
  return 'ok';
}

const STATE_LABEL: Record<JointState, string> = { ok: 'Verificado', review: 'Revisar', unverified: 'Sin verificar' };
const MODE_LABEL = { domiciliado: 'Domiciliado', 'a-ingresar': 'A ingresar', devolucion: 'A devolver', 'sin-pago': 'Sin pago' } as const;

/** Avisos en curso: uno por cliente, listos para revisar y enviar. */
export function NoticeList({
  joints,
  selectedId,
  onSelect,
}: {
  joints: JointNotice[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  const pendingReview = joints.filter((joint) => jointState(joint) === 'review').length;
  return (
    <section className="notice-list-panel" aria-labelledby="notices-heading">
      <h2 id="notices-heading" className="side-heading">
        Avisos en curso <span className="count">{joints.length}</span>
        {pendingReview > 0 && <span className="count count-warning" title="Avisos con datos por revisar">{pendingReview} por revisar</span>}
      </h2>
      {joints.length === 0 ? (
        <div className="side-empty">
          <FileStack aria-hidden="true" />
          <p>Pegue capturas con <kbd>Ctrl</kbd>+<kbd>V</kbd> o arrástrelas a la ventana.</p>
        </div>
      ) : (
        <ul className="notice-list" role="listbox" aria-label="Avisos en curso">
          {joints.map((joint) => {
            const state = jointState(joint);
            const summary = summarizeJoint(joint);
            return (
              <li key={joint.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={joint.id === selectedId}
                  data-selected={joint.id === selectedId}
                  className="notice-list-item"
                  onClick={() => onSelect(joint.id)}
                >
                  <span className="state-dot" data-state={state} title={STATE_LABEL[state]} />
                  <span className="notice-list-main">
                    <strong>{joint.cliente_nombre || 'Sin nombre'}</strong>
                    <small>
                      {joint.notices.map((notice) => notice.modelo || '¿?').join(' · ')}
                      {' — '}
                      {summary.periods.map((item) => `${item.periodo || '¿?'} ${item.ejercicio}`.trim()).join(', ')}
                    </small>
                  </span>
                  <span className="notice-list-amount">
                    <strong>{summary.mode === 'sin-pago' ? '—' : money(summary.displayTotal)}</strong>
                    <small>{MODE_LABEL[summary.mode]}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
