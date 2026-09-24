/**
 * Calendario del contribuyente (AEAT).
 *
 * Tres fechas distintas que no hay que confundir:
 *  - finPlazo: último día para presentar e ingresar. Si la declaración está
 *    DOMICILIADA, la AEAT carga el importe en cuenta ese mismo día.
 *  - finDomiciliacion: último día para presentar la declaración eligiendo la
 *    domiciliación como forma de pago (unos días antes del fin del plazo).
 *  - cargo: día en que se carga la domiciliación = finPlazo.
 *
 * Regla general (art. 30 Ley 39/2015 y calendario de la AEAT): si el último
 * día del plazo es sábado, domingo o festivo nacional, se traslada al primer
 * día hábil siguiente. Las fechas publicadas por la AEAT prevalecen siempre
 * (tabla OFFICIAL_DEADLINES).
 */

export type DeadlineSource = 'oficial' | 'regla';

export interface AeatDeadlines {
  /** Último día para presentar e ingresar; día del cargo si está domiciliada. */
  finPlazo: Date;
  /** Último día para presentar domiciliando el pago (null si el modelo no admite domiciliación). */
  finDomiciliacion: Date | null;
  origen: DeadlineSource;
  /** Explicación legible del plazo, para enseñarla en la app. */
  descripcion: string;
  /** Si la fecha se ha movido por fin de semana o festivo, el motivo. */
  traslado?: string;
}

// ---- Fechas ----

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Mediodía local: evita que la serialización ISO mueva la fecha al día anterior. */
export const localDate = (year: number, month1: number, day: number) => new Date(year, month1 - 1, day, 12);

const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localDate(y, m, d);
};

const isoOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const lastDayOfMonth = (year: number, month1: number) => new Date(year, month1, 0).getDate();

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

// ---- Festivos nacionales ----

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return localDate(year, month, day);
}

/**
 * Fiestas nacionales comunes a toda España. Los festivos autonómicos y locales
 * no alargan los plazos de presentación telemática de la AEAT.
 */
export function nationalHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>([
    [`${year}-01-01`, 'Año Nuevo'],
    [`${year}-01-06`, 'Epifanía del Señor'],
    [`${year}-05-01`, 'Fiesta del Trabajo'],
    [`${year}-08-15`, 'Asunción de la Virgen'],
    [`${year}-10-12`, 'Fiesta Nacional de España'],
    [`${year}-11-01`, 'Todos los Santos'],
    [`${year}-12-06`, 'Día de la Constitución'],
    [`${year}-12-08`, 'Inmaculada Concepción'],
    [`${year}-12-25`, 'Natividad del Señor'],
  ]);
  holidays.set(isoOf(addDays(easterSunday(year), -2)), 'Viernes Santo');
  return holidays;
}

export function nonBusinessReason(date: Date): string | null {
  const day = date.getDay();
  if (day === 6) return 'sábado';
  if (day === 0) return 'domingo';
  const holiday = nationalHolidays(date.getFullYear()).get(isoOf(date));
  return holiday ? `festivo (${holiday})` : null;
}

/** Traslada al primer día hábil siguiente si cae en sábado, domingo o festivo nacional. */
export function nextBusinessDay(date: Date): { date: Date; reason: string | null } {
  const reason = nonBusinessReason(date);
  let current = date;
  while (nonBusinessReason(current)) current = addDays(current, 1);
  return { date: current, reason };
}

// ---- Fechas oficiales publicadas por la AEAT ----

/**
 * Fechas oficiales que prevalecen sobre la regla general. Clave:
 * "modelo|periodo|ejercicio" o "*|periodo|ejercicio" para todos los modelos
 * de ese periodo. Valor: [fin del plazo, fin de la domiciliación] en ISO.
 * Fuente: Calendario del contribuyente de la AEAT 2025 y 2026, nota de la AEAT
 * de 3-4-2025 (Semana Santa) y Orden HAC/241/2025. Para añadir un año nuevo
 * basta con copiar las fechas del calendario que publica la AEAT en diciembre.
 */
export const OFFICIAL_DEADLINES: Record<string, [string, string | null]> = {
  // ---- 2025 ----
  '111|4T|2024': ['2025-01-20', '2025-01-15'],
  '115|4T|2024': ['2025-01-20', '2025-01-15'],
  '123|4T|2024': ['2025-01-20', '2025-01-15'],
  '303|4T|2024': ['2025-01-30', '2025-01-27'],
  '130|4T|2024': ['2025-01-30', '2025-01-27'],
  '131|4T|2024': ['2025-01-30', '2025-01-27'],
  '390|0A|2024': ['2025-01-30', null],
  '190|0A|2024': ['2025-01-31', null],
  '180|0A|2024': ['2025-01-31', null],
  '347|0A|2024': ['2025-02-28', null],
  // 20 de abril de 2025 era domingo; la domiciliación se quedó en el 15 por Semana Santa.
  '*|1T|2025': ['2025-04-21', '2025-04-15'],
  '202|1P|2025': ['2025-04-21', '2025-04-15'],
  '100|0A|2024': ['2025-06-30', '2025-06-25'],
  '*|2T|2025': ['2025-07-21', '2025-07-16'],
  '200|0A|2024': ['2025-07-25', '2025-07-22'],
  '*|3T|2025': ['2025-10-20', '2025-10-15'],
  '202|2P|2025': ['2025-10-20', '2025-10-15'],
  '202|3P|2025': ['2025-12-22', '2025-12-17'],
  // ---- 2026 ----
  '111|4T|2025': ['2026-01-20', '2026-01-15'],
  '115|4T|2025': ['2026-01-20', '2026-01-15'],
  '123|4T|2025': ['2026-01-20', '2026-01-15'],
  '303|4T|2025': ['2026-01-30', '2026-01-27'],
  '130|4T|2025': ['2026-01-30', '2026-01-27'],
  '131|4T|2025': ['2026-01-30', '2026-01-27'],
  '390|0A|2025': ['2026-01-30', null],
  '349|0A|2025': ['2026-01-30', null],
  '190|0A|2025': ['2026-02-02', null],
  '180|0A|2025': ['2026-02-02', null],
  '347|0A|2025': ['2026-03-02', null],
  '*|1T|2026': ['2026-04-20', '2026-04-15'],
  '202|1P|2026': ['2026-04-20', '2026-04-15'],
  '100|0A|2025': ['2026-06-30', '2026-06-25'],
  '*|2T|2026': ['2026-07-20', '2026-07-15'],
  '200|0A|2025': ['2026-07-27', '2026-07-22'],
  '*|3T|2026': ['2026-10-20', '2026-10-15'],
  '202|2P|2026': ['2026-10-20', '2026-10-15'],
  '202|3P|2026': ['2026-12-21', '2026-12-16'],
};

// ---- Reglas por modelo ----

/** Modelos cuyo 4.º trimestre vence el 30 de enero (el resto, el 20). */
const JANUARY_30_MODELS = new Set(['303', '130', '131', '349', '309', '310', '311', '368', '369']);

/** Modelos mensuales con plazo hasta el día 30 del mes siguiente (IVA de SII/REDEME). */
const MONTHLY_30_MODELS = new Set(['303', '349', '353']);

/** Modelos informativos sin ingreso: no hay domiciliación. */
const NO_PAYMENT_MODELS = new Set(['180', '190', '347', '349', '390', '184', '182', '193', '296', '720', '721']);

interface RawDeadline {
  year: number;
  month: number;
  day: number;
  /** Días naturales entre el fin de la domiciliación y el fin del plazo (null = sin domiciliación). */
  domiciliationGap: number | null;
  /** true cuando la AEAT no publica una fecha fija y se estima. */
  domiciliationEstimated?: boolean;
  description: string;
}

const QUARTER_END_MONTH: Record<string, number> = { '1T': 4, '2T': 7, '3T': 10 };
const PAGO_FRACCIONADO_202: Record<string, number> = { '1P': 4, '2P': 10, '3P': 12 };

function annualDeadline(modelo: string, year: number): RawDeadline | null {
  const next = year + 1;
  switch (modelo) {
    case '390': return { year: next, month: 1, day: 30, domiciliationGap: null, description: 'Resumen anual de IVA: del 1 al 30 de enero.' };
    case '349': return { year: next, month: 1, day: 30, domiciliationGap: null, description: 'Operaciones intracomunitarias (anual): del 1 al 30 de enero.' };
    case '180':
    case '190': return { year: next, month: 1, day: 31, domiciliationGap: null, description: 'Resumen anual de retenciones: del 1 al 31 de enero.' };
    case '347': return { year: next, month: 2, day: lastDayOfMonth(next, 2), domiciliationGap: null, description: 'Operaciones con terceros: durante el mes de febrero.' };
    case '200': return { year: next, month: 7, day: 25, domiciliationGap: 3, description: 'Impuesto sobre Sociedades (ejercicio natural): del 1 al 25 de julio; domiciliación hasta el 22.' };
    case '100': return { year: next, month: 6, day: 30, domiciliationGap: 5, description: 'Renta: hasta el 30 de junio; domiciliación hasta el 25 de junio.' };
    default: return null;
  }
}

function rawDeadline(modelo: string, periodo: string, year: number): RawDeadline | null {
  const gap = NO_PAYMENT_MODELS.has(modelo) ? null : 5;

  if (periodo === '0A') return annualDeadline(modelo, year);

  if (modelo === '202') {
    const month = PAGO_FRACCIONADO_202[periodo];
    if (!month) return null;
    return { year, month, day: 20, domiciliationGap: 5, description: `Pago fraccionado de Sociedades ${periodo}: del 1 al 20 de ${MONTHS[month - 1]}; domiciliación hasta el 15.` };
  }
  if (/^[1-3]P$/.test(periodo)) return null;

  if (QUARTER_END_MONTH[periodo]) {
    const month = QUARTER_END_MONTH[periodo];
    return {
      year, month, day: 20, domiciliationGap: gap,
      description: `Trimestral ${periodo}: del 1 al 20 de ${MONTHS[month - 1]}${gap ? '; domiciliación hasta el 15' : ''}.`,
    };
  }

  if (periodo === '4T') {
    // 303, 130 y 131: hasta el 30 de enero y domiciliación hasta el 27.
    // 111, 115 y 123: hasta el 20 de enero y domiciliación hasta el 15.
    const late = JANUARY_30_MODELS.has(modelo);
    const domGap = gap === null ? null : late ? 3 : 5;
    const day = late ? 30 : 20;
    return {
      year: year + 1, month: 1, day, domiciliationGap: domGap,
      description: `Trimestral 4T: del 1 al ${day} de enero del año siguiente${domGap ? `; domiciliación hasta el ${day - domGap}` : ''}.`,
    };
  }

  if (/^\d{1,2}$/.test(periodo)) {
    const month = Number(periodo);
    if (month < 1 || month > 12) return null;
    const dueYear = month === 12 ? year + 1 : year;
    const dueMonth = month === 12 ? 1 : month + 1;
    if (MONTHLY_30_MODELS.has(modelo)) {
      // IVA mensual (SII): hasta el día 30 del mes siguiente (el último día de febrero).
      const day = Math.min(30, lastDayOfMonth(dueYear, dueMonth));
      return {
        year: dueYear, month: dueMonth, day, domiciliationGap: gap, domiciliationEstimated: true,
        description: `Mensual de ${MONTHS[month - 1]}: hasta el ${day} de ${MONTHS[dueMonth - 1]}.`,
      };
    }
    return {
      year: dueYear, month: dueMonth, day: 20, domiciliationGap: gap,
      description: `Mensual de ${MONTHS[month - 1]}: del 1 al 20 de ${MONTHS[dueMonth - 1]}${gap ? '; domiciliación hasta el 15' : ''}.`,
    };
  }

  return null;
}

const businessDaysBetween = (fromExclusive: Date, toInclusive: Date) => {
  let count = 0;
  for (let day = addDays(fromExclusive, 1); day <= toInclusive; day = addDays(day, 1)) {
    if (!nonBusinessReason(day)) count++;
  }
  return count;
};

export function normalizePeriod(periodo: string): string {
  const clean = String(periodo || '').toUpperCase().replace(/\s+/g, '');
  if (/^\d$/.test(clean)) return `0${clean}`;
  return clean;
}

/**
 * Plazos de un modelo, periodo y ejercicio. Devuelve null si no se puede
 * determinar (periodo ilegible, modelo anual desconocido…): la app lo marca
 * para revisar en vez de inventarse una fecha.
 */
export function getAeatDeadlines(modelo: string, periodo: string, ejercicio: string): AeatDeadlines | null {
  const cleanModel = String(modelo || '').trim();
  const cleanPeriod = normalizePeriod(periodo);
  const year = Number(String(ejercicio || '').trim());
  if (!cleanModel || !cleanPeriod || !Number.isInteger(year) || year < 2000 || year > 2100) return null;

  const raw = rawDeadline(cleanModel, cleanPeriod, year);
  if (!raw) return null;

  const official = OFFICIAL_DEADLINES[`${cleanModel}|${cleanPeriod}|${year}`]
    ?? OFFICIAL_DEADLINES[`*|${cleanPeriod}|${year}`];
  if (official && !(NO_PAYMENT_MODELS.has(cleanModel) && official[1])) {
    return {
      finPlazo: parseIso(official[0]),
      finDomiciliacion: raw.domiciliationGap === null || !official[1] ? null : parseIso(official[1]),
      origen: 'oficial',
      descripcion: raw.description,
    };
  }

  const nominal = localDate(raw.year, raw.month, raw.day);
  const shifted = nextBusinessDay(nominal);

  // Fin de la domiciliación. Criterio prudente: NO se retrasa aunque el plazo
  // se amplíe por un festivo (la AEAT unas veces lo amplía y otras no, p. ej.
  // julio de 2026 mantuvo el 22). Sí se adelanta si no deja el margen mínimo
  // de la Orden HAC/241/2025 (3 días hábiles o 5 naturales hasta el fin del
  // plazo). Así nunca se da al cliente una fecha más tardía que la real.
  let domiciliation: Date | null = null;
  if (raw.domiciliationGap !== null) {
    domiciliation = addDays(nominal, -raw.domiciliationGap);
    // Si cae en día inhábil, se adelanta al hábil anterior (nunca se retrasa).
    while (nonBusinessReason(domiciliation)) domiciliation = addDays(domiciliation, -1);
    const calendarDays = (date: Date) => Math.round((shifted.date.getTime() - date.getTime()) / 86_400_000);
    while (businessDaysBetween(domiciliation, shifted.date) < 3 && calendarDays(domiciliation) < 5) {
      domiciliation = addDays(domiciliation, -1);
    }
  }

  return {
    finPlazo: shifted.date,
    finDomiciliacion: domiciliation,
    origen: 'regla',
    descripcion: raw.description + (raw.domiciliationEstimated && domiciliation ? ' Fin de la domiciliación estimado: compruébelo en el calendario de la AEAT.' : ''),
    traslado: shifted.reason
      ? `El ${raw.day} de ${MONTHS[raw.month - 1]} cae en ${shifted.reason}: el plazo se traslada al ${WEEKDAYS[shifted.date.getDay()]} ${shifted.date.getDate()} de ${MONTHS[shifted.date.getMonth()]}.`
      : undefined,
  };
}

/** Plazos de un año para enseñarlos en Ajustes → Calendario AEAT. */
export function yearOverview(year: number): { etiqueta: string; modelos: string; plazos: AeatDeadlines }[] {
  const rows: { etiqueta: string; modelos: string; modelo: string; periodo: string; ejercicio: number }[] = [
    { etiqueta: '4T del año anterior', modelos: '111, 115, 123', modelo: '111', periodo: '4T', ejercicio: year - 1 },
    { etiqueta: '4T del año anterior', modelos: '303, 130, 131', modelo: '303', periodo: '4T', ejercicio: year - 1 },
    { etiqueta: 'Resumen anual del año anterior', modelos: '390', modelo: '390', periodo: '0A', ejercicio: year - 1 },
    { etiqueta: 'Resumen anual del año anterior', modelos: '180, 190', modelo: '190', periodo: '0A', ejercicio: year - 1 },
    { etiqueta: 'Anual del año anterior', modelos: '347', modelo: '347', periodo: '0A', ejercicio: year - 1 },
    { etiqueta: '1T', modelos: '303, 130, 131, 111, 115, 123', modelo: '303', periodo: '1T', ejercicio: year },
    { etiqueta: '1P', modelos: '202', modelo: '202', periodo: '1P', ejercicio: year },
    { etiqueta: 'Renta del año anterior', modelos: '100', modelo: '100', periodo: '0A', ejercicio: year - 1 },
    { etiqueta: '2T', modelos: '303, 130, 131, 111, 115, 123', modelo: '303', periodo: '2T', ejercicio: year },
    { etiqueta: 'Sociedades del año anterior', modelos: '200', modelo: '200', periodo: '0A', ejercicio: year - 1 },
    { etiqueta: '3T', modelos: '303, 130, 131, 111, 115, 123', modelo: '303', periodo: '3T', ejercicio: year },
    { etiqueta: '2P', modelos: '202', modelo: '202', periodo: '2P', ejercicio: year },
    { etiqueta: '3P', modelos: '202', modelo: '202', periodo: '3P', ejercicio: year },
  ];
  return rows.flatMap((row) => {
    const plazos = getAeatDeadlines(row.modelo, row.periodo, String(row.ejercicio));
    return plazos ? [{ etiqueta: row.etiqueta, modelos: row.modelos, plazos }] : [];
  });
}
