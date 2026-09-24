import { getAeatDeadlines } from './aeatCalendar';
import type { NoticeVerification, TaxNotice } from './types';
import { normalizeTaxResult, withDeadlines } from './types';
import {
  type FieldCheck,
  type KnownClient,
  validateAgainstDirectory,
  validateJustificante,
  validatePlazo,
  validateTitular,
  verifyNoticeFields,
} from './validation';

/** Respuesta de POST /api/gemini/read-tax. */
export interface ReadTaxResponse {
  data: Record<string, unknown>;
  modelo?: string;
  verificacion: { coincide: boolean; discrepancias: { campo: string; primera: string; segunda: string }[]; modelo: string } | null;
  verificacionError?: string;
}

export const FIELD_LABELS: Record<string, string> = {
  iban: 'IBAN',
  cliente_nif: 'NIF',
  cliente_nombre: 'Nombre',
  importe: 'Importe',
  modelo: 'Modelo',
  periodo: 'Periodo',
  ejercicio: 'Ejercicio',
  tipo_resultado: 'Resultado',
  fecha_presentacion: 'Fecha de presentación',
  numero_justificante: 'Justificante',
  plazo: 'Plazo',
};

type VerifiableNotice = Pick<TaxNotice, 'modelo' | 'periodo' | 'ejercicio' | 'cliente_nif' | 'cliente_nombre' | 'importe' | 'tipo_resultado' | 'iban' | 'numero_justificante' | 'clienteConocido'>;

export interface VerificationContext {
  today?: Date;
  /** El usuario acaba de revisar los datos a mano en el editor. */
  reviewedByUser?: boolean;
}

/** Todas las comprobaciones deterministas, sin IA. */
export function runChecks(notice: VerifiableNotice, { today = new Date(), reviewedByUser = false }: VerificationContext = {}): FieldCheck[] {
  const deadlines = getAeatDeadlines(notice.modelo, notice.periodo, notice.ejercicio);
  return [
    ...verifyNoticeFields(notice),
    validatePlazo(deadlines?.finPlazo ?? null, today),
    ...[validateJustificante(notice.numero_justificante, notice.modelo), validateTitular(notice.cliente_nif, notice.modelo)]
      .filter((check): check is FieldCheck => !!check),
    ...validateAgainstDirectory(notice, notice.clienteConocido, reviewedByUser),
  ];
}

/**
 * Combina las comprobaciones deterministas con la segunda lectura de la IA
 * para dar un veredicto por aviso.
 */
export function buildVerification(
  notice: VerifiableNotice,
  discrepanciasIA: { campo: string; primera: string; segunda: string }[],
  segundaLecturaHecha: boolean,
  context: VerificationContext = {},
): NoticeVerification {
  const checks = runChecks(notice, context);
  const hasProblem = checks.some((check) => check.status !== 'ok') || discrepanciasIA.length > 0;
  return {
    estado: hasProblem ? 'revisar' : segundaLecturaHecha ? 'ok' : 'sin-verificar',
    checks,
    discrepanciasIA,
    segundaLecturaHecha,
  };
}

/**
 * Convierte la fecha de presentación que lee la IA ("15/07/2026") a ISO.
 * Devuelve undefined ante cualquier cosa rara: esta fecha va en el aviso del
 * cliente, así que mejor no enseñar ninguna que enseñar una inventada.
 */
export function parseFechaEspanola(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const m = valor.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return undefined;
  const [, d, mes, a] = m;
  const fecha = new Date(Number(a), Number(mes) - 1, Number(d), 12);
  // new Date(2026, 1, 31) no falla, "corrige" la fecha al 3 de marzo: hay que
  // comprobar que los componentes siguen siendo los mismos para colar un 31/02.
  if (fecha.getFullYear() !== Number(a) || fecha.getMonth() !== Number(mes) - 1 || fecha.getDate() !== Number(d)) {
    return undefined;
  }
  return fecha.toISOString();
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

const cleanPeriod = (value: unknown) => {
  const clean = text(value).toUpperCase().replace(/\s+/g, '');
  return /^\d$/.test(clean) ? `0${clean}` : clean;
};

const newId = () => Math.random().toString(36).substring(2, 9);

/**
 * Crea el aviso a partir de la lectura de la IA. Lo que la IA no ha podido leer
 * se queda VACÍO: antes se rellenaba con valores "habituales" (modelo 303,
 * periodo 2T, ejercicio actual…) que pasaban la validación y el aviso salía
 * como verificado con datos inventados.
 */
export function buildNoticeFromReading(
  result: ReadTaxResponse,
  extras: { screenshotId?: string; screenshotUrl?: string; clienteConocido?: KnownClient; today?: Date; timestamp?: number } = {},
): TaxNotice {
  const data = result.data || {};
  const rawAmount = typeof data.importe === 'number' ? data.importe : parseFloat(text(data.importe).replace(',', '.'));
  const modelo = text(data.modelo);
  const notice: TaxNotice = withDeadlines({
    id: newId(),
    modelo,
    modelo_nombre: text(data.modelo_nombre),
    periodo: cleanPeriod(data.periodo),
    ejercicio: text(data.ejercicio),
    cliente_nif: text(data.cliente_nif).replace(/[\s.-]+/g, '').toUpperCase(),
    cliente_nombre: text(data.cliente_nombre),
    importe: Number.isFinite(rawAmount) ? rawAmount : 0,
    tipo_resultado: normalizeTaxResult(modelo, data.tipo_resultado),
    iban: text(data.iban).replace(/\s+/g, '').toUpperCase(),
    numero_justificante: text(data.numero_justificante).replace(/[\s.-]+/g, '') || undefined,
    screenshotUrl: extras.screenshotUrl,
    screenshotId: extras.screenshotId,
    fechaCargo: '',
    fechaLimiteDomiciliacion: '',
    fechaPresentacion: parseFechaEspanola(data.fecha_presentacion),
    timestamp: extras.timestamp ?? Date.now(),
    clienteConocido: extras.clienteConocido,
  });
  notice.verificacion = buildVerification(
    notice,
    result.verificacion?.discrepancias || [],
    !!result.verificacion,
    { today: extras.today },
  );
  return notice;
}

/** Recalcula fechas y comprobaciones tras una edición manual. */
export function applyManualEdit(edit: TaxNotice, today = new Date()): TaxNotice {
  const updated = withDeadlines(edit);
  // Las discrepancias de la doble lectura se descartan: el usuario acaba de
  // revisar los datos a mano, y eso es la verificación definitiva.
  updated.verificacion = buildVerification(updated, [], true, { today, reviewedByUser: true });
  return updated;
}
