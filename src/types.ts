import { getAeatDeadlines } from './aeatCalendar';
import type { FieldCheck } from './validation';

export interface NoticeVerification {
  /** 'ok' = checksums y segunda lectura correctos; 'revisar' = algo no cuadra; 'sin-verificar' = la 2ª lectura no pudo hacerse */
  estado: 'ok' | 'revisar' | 'sin-verificar';
  checks: FieldCheck[];
  /** Campos donde la segunda lectura de la IA no coincidió con la primera */
  discrepanciasIA: { campo: string; primera: string; segunda: string }[];
  segundaLecturaHecha: boolean;
}

export interface TaxNotice {
  id: string;
  modelo: string;
  modelo_nombre: string;
  periodo: string; // 1T, 2T, 3T, 4T, 01, 02...
  ejercicio: string; // Year
  cliente_nif: string;
  cliente_nombre: string;
  importe: number;
  /**
   * 'Resultado negativo': la declaración sale negativa y no se paga nada. Es lo
   * típico del 130/131 cuando la actividad ha tenido pocos ingresos: el importe
   * no lo devuelve Hacienda, se descuenta en los trimestres siguientes del mismo
   * ejercicio (casilla [15] del propio modelo). No confundir con 'Devolución',
   * que es la única en la que la AEAT ingresa dinero al cliente.
   */
  tipo_resultado: 'Domiciliación' | 'A ingresar' | 'A compensar' | 'Resultado negativo' | 'Resultado cero / Sin actividad' | 'Devolución';
  iban?: string;
  screenshotUrl?: string; // miniatura JPEG comprimida (base64 pequeño)
  screenshotId?: string; // id de la captura original guardada en disco (/api/capturas/:id)
  /**
   * Fin del plazo de presentación e ingreso (ISO). Si está domiciliada, es
   * también el día en que la AEAT carga el importe. Vacía si no se conoce.
   */
  fechaCargo: string;
  /** Último día para presentar domiciliando el pago (ISO). Vacía si no aplica. */
  fechaLimiteDomiciliacion: string;
  /** Número de justificante de la declaración, si se leyó de la captura. */
  numero_justificante?: string;
  /** Lo último guardado de este NIF en el directorio común (para detectar cambios de IBAN). */
  clienteConocido?: { nombre?: string; iban?: string };
  /**
   * Fecha real de presentación leída de la captura ("Datos Present."), en ISO.
   * Es un dato de la captura, no calculado: si no aparece se queda vacío y la
   * ficha no enseña ninguna fecha, antes que darle al cliente una que no es.
   */
  fechaPresentacion?: string;
  timestamp: number;
  verificacion?: NoticeVerification;
  /** Nota manual opcional que solo se muestra al pie de la imagen exportada. */
  notaAsesoria?: string;
  /** Desactivada por defecto para conservar intacto el diseno actual. */
  mostrarNotaAsesoria?: boolean;
}

export interface JointNotice {
  id: string; // Client NIF
  cliente_nombre: string;
  cliente_nif: string;
  notices: TaxNotice[];
  total_importe: number;
  iban?: string;
  todosDomiciliados: boolean;
  notaAsesoria?: string;
  mostrarNotaAsesoria?: boolean;
}

export const TAX_RESULT_TYPES = [
  'Domiciliación',
  'A ingresar',
  'A compensar',
  'Resultado negativo',
  'Resultado cero / Sin actividad',
  'Devolución',
] as const;

/**
 * Normaliza variantes devueltas por OCR/IA y textos antiguos guardados con
 * problemas de codificación. Así una domiciliación nunca cae por error en el
 * aviso genérico "A pagar".
 */
export function normalizeTaxResult(modelo: unknown, value: unknown): TaxNotice['tipo_resultado'] {
  const raw = String(value ?? '').trim();
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\?/g, '')
    .toLowerCase();

  let result: TaxNotice['tipo_resultado'];
  if (/domicilia/.test(key)) result = 'Domiciliación';
  else if (/devolu/.test(key)) result = 'Devolución';
  else if (/compens/.test(key)) result = 'A compensar';
  else if (/sin actividad|resultado cero|^cero$/.test(key)) result = 'Resultado cero / Sin actividad';
  else if (/negativ/.test(key)) result = 'Resultado negativo';
  else result = 'A ingresar';

  const model = String(modelo ?? '').trim();
  if ((model === '130' || model === '131') && result === 'A compensar') {
    return 'Resultado negativo';
  }
  return result;
}

/**
 * Rellena las fechas de un aviso con el calendario de la AEAT. Si el periodo o
 * el modelo no permiten saber el plazo, las fechas quedan vacías (y el aviso
 * se marca para revisar) en vez de inventar una.
 */
export function withDeadlines<T extends Pick<TaxNotice, 'modelo' | 'periodo' | 'ejercicio'>>(notice: T): T & Pick<TaxNotice, 'fechaCargo' | 'fechaLimiteDomiciliacion'> {
  const deadlines = getAeatDeadlines(notice.modelo, notice.periodo, notice.ejercicio);
  return {
    ...notice,
    fechaCargo: deadlines ? deadlines.finPlazo.toISOString() : '',
    fechaLimiteDomiciliacion: deadlines?.finDomiciliacion ? deadlines.finDomiciliacion.toISOString() : '',
  };
}

/** Convierte una fecha ISO guardada en Date, o null si falta o no es válida. */
export function parseStoredDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export function formatDateSpanish(date: Date): string {
  // En español los meses van en minúscula ("lunes, 20 de abril de 2026");
  // solo el día de la semana, que abre la frase, va con mayúscula.
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();

  return `${dayName}, ${dayNum} de ${monthName} de ${year}`;
}
