export interface TaxNotice {
  id: string;
  modelo: string;
  modelo_nombre: string;
  periodo: string; // 1T, 2T, 3T, 4T, 01, 02...
  ejercicio: string; // Year
  cliente_nif: string;
  cliente_nombre: string;
  importe: number;
  tipo_resultado: 'Domiciliación' | 'A ingresar' | 'A compensar' | 'Resultado cero / Sin actividad' | 'Devolución';
  iban?: string;
  screenshotUrl?: string; // thumbnail base64
  fechaCargo: string; // Calculated final AEAT charge/deadline
  fechaLimiteDomiciliacion: string; // Calculated direct debit cutoff
  timestamp: number;
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
