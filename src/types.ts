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
  fechaCargo: string; // Calculated final AEAT charge/deadline
  fechaLimiteDomiciliacion: string; // Calculated direct debit cutoff
  /**
   * Fecha real de presentación leída de la captura ("Datos Present."), en ISO.
   * Es un dato de la captura, no calculado: si no aparece se queda vacío y la
   * ficha no enseña ninguna fecha, antes que darle al cliente una que no es.
   */
  fechaPresentacion?: string;
  timestamp: number;
  verificacion?: NoticeVerification;
}

export interface JointNotice {
  id: string; // Client NIF
  cliente_nombre: string;
  cliente_nif: string;
  notices: TaxNotice[];
  total_importe: number;
  iban?: string;
  todosDomiciliados: boolean;
}

// Function to calculate AEAT Spanish Tax Deadlines and Direct Debit Cutoffs
export function calculateAEATDeadlines(modelo: string, periodo: string, ejercicio: string): { 
  fechaCargo: Date; 
  fechaLimiteDomiciliacion: Date;
} {
  const year = parseInt(ejercicio, 10) || new Date().getFullYear();
  let cargoYear = year;
  let cargoMonth = 0; // 0-indexed (Jan is 0, Dec is 11)
  let cargoDay = 20;
  
  let domYear = year;
  let domMonth = 0;
  let domDay = 15;

  const cleanPeriod = (periodo || "").toUpperCase().trim();

  if (cleanPeriod === "1T") {
    cargoMonth = 3; // April
    cargoDay = 20;
    domMonth = 3;
    domDay = 15;
  } else if (cleanPeriod === "2T") {
    cargoMonth = 6; // July
    cargoDay = 20;
    domMonth = 6;
    domDay = 15;
  } else if (cleanPeriod === "3T") {
    cargoMonth = 9; // October
    cargoDay = 20;
    domMonth = 9;
    domDay = 15;
  } else if (cleanPeriod === "4T") {
    cargoYear = year + 1;
    cargoMonth = 0; // January
    cargoDay = 30;
    domYear = year + 1;
    domMonth = 0;
    domDay = 25;
  } else {
    // Treat as monthly (e.g. "01" for Jan, due Feb 20th)
    const monthNum = parseInt(cleanPeriod, 10);
    if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
      if (monthNum === 12) {
        // December monthly is due January 30th of the following year
        cargoYear = year + 1;
        cargoMonth = 0; // January
        cargoDay = 30;
        domYear = year + 1;
        domMonth = 0;
        domDay = 25;
      } else {
        // Month M is due M+1 on the 20th
        // Since monthNum is 1-indexed (Jan=1, due Feb=index 1), we can set cargoMonth to monthNum
        cargoMonth = monthNum; // Jan(1) -> Feb(1), Feb(2) -> March(2), etc.
        cargoDay = 20;
        domMonth = monthNum;
        domDay = 15;
      }
    } else {
      // Fallback if period cannot be parsed cleanly, default to current quarter style
      cargoMonth = 3; // April
      cargoDay = 20;
      domMonth = 3;
      domDay = 15;
    }
  }

  const cargoDate = new Date(cargoYear, cargoMonth, cargoDay);
  const domDate = new Date(domYear, domMonth, domDay);

  // Shifting if it lands on a weekend (Saturday or Sunday) to next business day (Monday)
  const adjustWeekend = (d: Date): Date => {
    const day = d.getDay();
    const res = new Date(d);
    if (day === 6) { // Saturday
      res.setDate(d.getDate() + 2);
    } else if (day === 0) { // Sunday
      res.setDate(d.getDate() + 1);
    }
    return res;
  };

  return {
    fechaCargo: adjustWeekend(cargoDate),
    fechaLimiteDomiciliacion: adjustWeekend(domDate)
  };
}

export function formatDateSpanish(date: Date): string {
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();

  return `${dayName}, ${dayNum} de ${monthName} de ${year}`;
}
