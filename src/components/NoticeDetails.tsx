import { CalendarClock, Edit2, ExternalLink, Info, Plus, ShieldAlert, ShieldCheck, ShieldQuestion, Split, Trash2, Undo2 } from 'lucide-react';
import { getAeatDeadlines } from '../aeatCalendar';
import { FIELD_LABELS } from '../noticeFactory';
import { clientResultLabel, summarizeJoint } from '../summary';
import type { JointNotice, TaxNotice } from '../types';
import { formatDateSpanish, parseStoredDate } from '../types';
import { maskIban } from '../whatsapp';
import { jointState } from './NoticeList';

const money = (value: number) => `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const shortDate = (value?: string) => {
  const date = parseStoredDate(value);
  return date ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

const RESULT_TONE: Record<TaxNotice['tipo_resultado'], string> = {
  'Domiciliación': 'success',
  'A ingresar': 'warning',
  'A compensar': 'neutral',
  'Resultado negativo': 'neutral',
  'Resultado cero / Sin actividad': 'neutral',
  'Devolución': 'accent',
};

export function verificationIssues(joint: JointNotice) {
  return joint.notices.flatMap((notice) => {
    const verification = notice.verificacion;
    if (!verification) return [];
    const prefix = joint.notices.length > 1 ? `Modelo ${notice.modelo || '¿?'}: ` : '';
    const checks = verification.checks
      .filter((check) => check.status !== 'ok')
      .map((check) => ({ level: check.status, text: prefix + check.message }));
    const discrepancies = (verification.discrepanciasIA || []).map((difference) => ({
      level: 'error' as const,
      text: `${prefix}${FIELD_LABELS[difference.campo] || difference.campo}: las dos lecturas no coinciden («${difference.primera || 'vacío'}» / «${difference.segunda || 'vacío'}»).`,
    }));
    return [...checks, ...discrepancies];
  });
}

export function NoticeDetails({
  joint,
  canUndoGrouping,
  onEdit,
  onSplit,
  onUndoGrouping,
  onAddCapture,
  onViewCapture,
  onDiscard,
}: {
  joint: JointNotice;
  canUndoGrouping: boolean;
  onEdit: () => void;
  onSplit: () => void;
  onUndoGrouping: () => void;
  onAddCapture: () => void;
  onViewCapture: (notice: TaxNotice) => void;
  onDiscard: () => void;
}) {
  const state = jointState(joint);
  const issues = verificationIssues(joint);
  const summary = summarizeJoint(joint);
  const account = summary.payable.find((notice) => notice.iban)?.iban || summary.refunds.find((notice) => notice.iban)?.iban || joint.iban;

  return (
    <div className="details">
      <div className="details-client">
        <div className="details-client-main">
          <h2>{joint.cliente_nombre || <span className="text-danger">Nombre sin leer</span>}</h2>
          <span className="mono">{joint.cliente_nif || 'NIF sin leer'}</span>
        </div>
        <span className="tag tag-large" data-tone={state === 'ok' ? 'success' : state === 'review' ? 'danger' : 'warning'}>
          {state === 'ok' ? <ShieldCheck aria-hidden="true" /> : state === 'review' ? <ShieldAlert aria-hidden="true" /> : <ShieldQuestion aria-hidden="true" />}
          {state === 'ok' ? 'Datos verificados' : state === 'review' ? 'Revisar datos' : 'Sin verificar'}
        </span>
      </div>

      {state === 'review' && (
        <div className="callout" data-tone="warning">
          <ShieldAlert aria-hidden="true" />
          <div>
            <div className="callout-title">
              Revise estos datos antes de enviar el aviso
              <button type="button" className="btn btn-small" onClick={onEdit}><Edit2 aria-hidden="true" /> Corregir</button>
            </div>
            <ul>
              {issues.length > 0
                ? issues.map((issue, index) => <li key={index} data-level={issue.level}>{issue.text}</li>)
                : <li>Hay datos que requieren una comprobación manual.</li>}
            </ul>
          </div>
        </div>
      )}
      {state === 'unverified' && (
        <div className="callout" data-tone="neutral">
          <ShieldQuestion aria-hidden="true" />
          <div>No se pudo hacer la segunda lectura. Compare los datos con la captura antes de enviarlos.</div>
        </div>
      )}

      <div className="section-heading">
        <h3>Declaraciones <span className="count">{joint.notices.length}</span></h3>
        <div className="section-actions">
          {joint.notices.length > 1 && <button type="button" className="link-btn" onClick={onSplit}><Split aria-hidden="true" /> Separar</button>}
          {canUndoGrouping && <button type="button" className="link-btn" onClick={onUndoGrouping}><Undo2 aria-hidden="true" /> Deshacer agrupación</button>}
          <button type="button" className="link-btn" onClick={onEdit}><Edit2 aria-hidden="true" /> Editar</button>
        </div>
      </div>

      <div className="tax-rows">
        {joint.notices.map((tax) => {
          const deadlines = getAeatDeadlines(tax.modelo, tax.periodo, tax.ejercicio);
          const domiciled = tax.tipo_resultado === 'Domiciliación';
          const pays = domiciled || tax.tipo_resultado === 'A ingresar';
          return (
            <article key={tax.id} className="tax-row">
              <div className="tax-row-top">
                <span className="tax-model">{tax.modelo || '¿?'}</span>
                <div className="tax-row-name">
                  <strong>{tax.modelo_nombre || (tax.modelo ? `Modelo ${tax.modelo}` : 'Modelo sin leer')}</strong>
                  <small>{tax.periodo || '¿periodo?'} · {tax.ejercicio || '¿ejercicio?'}</small>
                  {tax.numero_justificante && <small className="mono">Justificante {tax.numero_justificante}</small>}
                </div>
                <div className="tax-row-amount">
                  <span className="tax-amount">{money(tax.importe)}</span>
                  <span className="tag" data-tone={RESULT_TONE[tax.tipo_resultado]}>{clientResultLabel(tax.tipo_resultado)}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onViewCapture(tax)}
                  disabled={!tax.screenshotId && !tax.screenshotUrl}
                  title="Ver captura original"
                  aria-label={'Ver captura original del modelo ' + tax.modelo}
                >
                  <ExternalLink aria-hidden="true" />
                </button>
              </div>
              <dl className="tax-dates">
                <div>
                  <dt>{domiciled ? 'Cargo en cuenta' : pays ? 'Fin del plazo de pago' : 'Fin del plazo'}</dt>
                  <dd>{shortDate(tax.fechaCargo)}</dd>
                </div>
                {pays && (
                  <div>
                    <dt>Domiciliar hasta</dt>
                    <dd>{shortDate(tax.fechaLimiteDomiciliacion)}</dd>
                  </div>
                )}
                {deadlines && (
                  <div className="tax-dates-source">
                    <dt>Calendario</dt>
                    <dd>
                      <span className="tag tag-small" data-tone={deadlines.origen === 'oficial' ? 'success' : 'neutral'}>{deadlines.origen === 'oficial' ? 'Oficial AEAT' : 'Calculado'}</span>
                    </dd>
                  </div>
                )}
              </dl>
              {deadlines?.traslado && <p className="tax-note"><CalendarClock aria-hidden="true" /> {deadlines.traslado}</p>}
              {!deadlines && <p className="tax-note text-danger"><Info aria-hidden="true" /> Sin modelo, periodo o ejercicio válidos no se puede calcular el plazo.</p>}
            </article>
          );
        })}
        <button type="button" className="add-row" onClick={onAddCapture}><Plus aria-hidden="true" /> Añadir otra captura de este cliente</button>
      </div>

      <div className="section-heading"><h3>Resumen para el cliente</h3></div>
      <dl className="summary-grid">
        <dt>{summary.mode === 'devolucion' ? 'Total a devolver' : summary.mode === 'sin-pago' ? 'Resultado' : 'Total a pagar'}</dt>
        <dd className="summary-total">{summary.mode === 'sin-pago' ? 'No tiene que pagar nada' : money(summary.displayTotal)}</dd>
        {summary.mode !== 'sin-pago' && (
          <>
            <dt>Forma de pago</dt>
            <dd>{summary.mode === 'domiciliado' ? 'Domiciliación bancaria' : summary.mode === 'devolucion' ? 'Devolución de la AEAT' : 'Ingreso por el cliente'}</dd>
          </>
        )}
        {(summary.mode === 'domiciliado' || summary.mode === 'devolucion') && (
          <>
            <dt>{summary.mode === 'devolucion' ? 'Cuenta de abono' : 'Cuenta de cargo'}</dt>
            <dd className="mono">{account ? maskIban(account) : <span className="text-danger">No disponible</span>}</dd>
          </>
        )}
        {summary.mode === 'domiciliado' && (
          <>
            <dt>Cargo en cuenta</dt>
            <dd>{summary.dueDate ? formatDateSpanish(summary.dueDate) : '—'}</dd>
            <dt>Domiciliar hasta</dt>
            <dd>{summary.domiciliationDeadline ? formatDateSpanish(summary.domiciliationDeadline) : '—'}</dd>
          </>
        )}
        {summary.mode === 'a-ingresar' && (
          <>
            <dt>Pagar como muy tarde</dt>
            <dd>{summary.dueDate ? formatDateSpanish(summary.dueDate) : '—'}</dd>
          </>
        )}
      </dl>

      <div className="details-footer">
        <button type="button" className="btn btn-danger-ghost" onClick={onDiscard}><Trash2 aria-hidden="true" /> Descartar aviso</button>
        <button type="button" className="btn btn-primary" onClick={onEdit}><Edit2 aria-hidden="true" /> Editar datos</button>
      </div>
    </div>
  );
}
