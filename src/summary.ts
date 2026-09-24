import type { JointNotice, TaxNotice } from './types';
import { parseStoredDate } from './types';

/** Resultados en los que hay que pagar. */
export const PAYABLE_RESULTS: TaxNotice['tipo_resultado'][] = ['Domiciliación', 'A ingresar'];

/**
 * Resultados en los que el cliente no paga nada: el importe no se ingresa ni
 * lo devuelve Hacienda, se arrastra a declaraciones posteriores.
 */
export const NO_PAYMENT_RESULTS: TaxNotice['tipo_resultado'][] = ['A compensar', 'Resultado negativo', 'Resultado cero / Sin actividad'];

/** Cómo se le llama al resultado delante del cliente. */
export const CLIENT_RESULT_LABEL: Partial<Record<TaxNotice['tipo_resultado'], string>> = {
  'Resultado negativo': 'Negativa',
  'Resultado cero / Sin actividad': 'Sin actividad',
};
export const clientResultLabel = (tipo: TaxNotice['tipo_resultado']) => CLIENT_RESULT_LABEL[tipo] || tipo;

export type JointMode = 'domiciliado' | 'a-ingresar' | 'devolucion' | 'sin-pago';

export interface JointSummary {
  mode: JointMode;
  payable: TaxNotice[];
  refunds: TaxNotice[];
  noPayment: TaxNotice[];
  /** Total que sale de la cuenta del cliente (solo lo que se paga). */
  totalToPay: number;
  /** Total que devuelve la AEAT. */
  totalRefund: number;
  /** Importe que se enseña como total según el modo. */
  displayTotal: number;
  /** Todo lo que hay que pagar está domiciliado. */
  allPayableDomiciled: boolean;
  /** Fin del plazo (= día del cargo si está domiciliado) más temprano de lo que se paga. */
  dueDate: Date | null;
  /** Último día para domiciliar, el más temprano de lo domiciliado. */
  domiciliationDeadline: Date | null;
  /** Periodos distintos presentes en el aviso, en orden. */
  periods: { periodo: string; ejercicio: string }[];
}

const earliest = (dates: (Date | null)[]) =>
  dates.filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0] || null;

/**
 * Resume un aviso con uno o varios impuestos. Antes el total sumaba también
 * los resultados negativos: un 303 domiciliado de 500 € con un 130 negativo de
 * −200 € salía como "Total 300 €", cuando el banco carga 500 €.
 */
export function summarizeNotices(notices: TaxNotice[]): JointSummary {
  const payable = notices.filter((notice) => PAYABLE_RESULTS.includes(notice.tipo_resultado));
  const refunds = notices.filter((notice) => notice.tipo_resultado === 'Devolución');
  const noPayment = notices.filter((notice) => NO_PAYMENT_RESULTS.includes(notice.tipo_resultado));
  const totalToPay = payable.reduce((sum, notice) => sum + notice.importe, 0);
  const totalRefund = refunds.reduce((sum, notice) => sum + Math.abs(notice.importe), 0);
  const allPayableDomiciled = payable.length > 0 && payable.every((notice) => notice.tipo_resultado === 'Domiciliación');

  let mode: JointMode;
  if (payable.length > 0) mode = allPayableDomiciled ? 'domiciliado' : 'a-ingresar';
  else if (refunds.length > 0) mode = 'devolucion';
  else mode = 'sin-pago';

  const relevant = payable.length ? payable : refunds.length ? refunds : notices;
  const periods: { periodo: string; ejercicio: string }[] = [];
  for (const notice of notices) {
    if (!periods.some((item) => item.periodo === notice.periodo && item.ejercicio === notice.ejercicio)) {
      periods.push({ periodo: notice.periodo, ejercicio: notice.ejercicio });
    }
  }

  return {
    mode,
    payable,
    refunds,
    noPayment,
    totalToPay,
    totalRefund,
    displayTotal: mode === 'devolucion' ? totalRefund : mode === 'sin-pago' ? notices.reduce((sum, notice) => sum + notice.importe, 0) : totalToPay,
    allPayableDomiciled,
    dueDate: earliest(relevant.map((notice) => parseStoredDate(notice.fechaCargo))),
    domiciliationDeadline: earliest(payable
      .filter((notice) => notice.tipo_resultado === 'Domiciliación')
      .map((notice) => parseStoredDate(notice.fechaLimiteDomiciliacion))),
    periods,
  };
}

export const summarizeJoint = (joint: Pick<JointNotice, 'notices'>) => summarizeNotices(joint.notices);

/** Campos derivados de un aviso conjunto, calculados siempre del mismo modo. */
export function jointTotals(notices: TaxNotice[]): Pick<JointNotice, 'total_importe' | 'todosDomiciliados' | 'iban'> {
  const summary = summarizeNotices(notices);
  const ibanSource = summary.payable.find((notice) => notice.iban) || summary.refunds.find((notice) => notice.iban) || notices.find((notice) => notice.iban);
  return {
    total_importe: summary.displayTotal,
    todosDomiciliados: summary.allPayableDomiciled,
    iban: ibanSource?.iban || '',
  };
}
