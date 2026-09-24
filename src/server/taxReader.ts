import { ThinkingLevel, Type, type GoogleGenAI } from '@google/genai';
import { MAIN_FALLBACKS, VERIFY_FALLBACKS, modelChain, type AiSettings } from './aiSettings';

/** Esquema compartido por la lectura principal y la segunda lectura de verificación. */
export const TAX_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    modelo: {
      type: Type.STRING,
      description: "Número del modelo tributario, p. ej. '303', '111', '115', '130', '190', '200', '202'. Cadena vacía si no se ve.",
    },
    modelo_nombre: {
      type: Type.STRING,
      description: "Nombre oficial o descriptivo del impuesto, p. ej. 'Impuesto sobre el Valor Añadido' o 'Retenciones de IRPF'",
    },
    periodo: {
      type: Type.STRING,
      description: "Periodo tal y como figura en la declaración: '1T', '2T', '3T', '4T' (trimestral), '01'…'12' (mensual), '1P', '2P', '3P' (pagos fraccionados del modelo 202) o '0A' (anual). Cadena vacía si no se ve.",
    },
    ejercicio: {
      type: Type.STRING,
      description: "Ejercicio fiscal de 4 cifras, p. ej. '2026'. Cadena vacía si no se ve.",
    },
    cliente_nif: {
      type: Type.STRING,
      description: 'NIF, CIF o NIE del declarante o cliente, sin espacios. Cadena vacía si no se ve.',
    },
    cliente_nombre: {
      type: Type.STRING,
      description: 'Nombre completo, apellidos y nombre, o denominación social del cliente. Cadena vacía si no se ve.',
    },
    importe: {
      type: Type.NUMBER,
      description: 'Importe neto resultante de la liquidación como número real positivo o negativo, p. ej. 818.55',
    },
    tipo_resultado: {
      type: Type.STRING,
      enum: ['Domiciliación', 'A ingresar', 'A compensar', 'Resultado negativo', 'Resultado cero / Sin actividad', 'Devolución'],
      description: "Tipo de resultado. Debe ser exactamente uno de estos valores: 'Domiciliación', 'A ingresar', 'A compensar', 'Resultado negativo', 'Resultado cero / Sin actividad', 'Devolución'. " +
        "Usa 'Resultado negativo' cuando el resultado de la declaración sea NEGATIVO y la AEAT no devuelva nada, sino que ese importe se descuente en declaraciones posteriores: " +
        "es el caso típico del modelo 130/131 con resultado negativo (aparece marcado como 'Negativa' o 'A deducir', y se arrastra a la casilla 'A deducir trimestres anteriores' del ejercicio). " +
        "Usa 'Devolución' SOLO si la AEAT va a ingresar el dinero al cliente (casilla de devolución con cuenta de abono), nunca por el mero hecho de que el importe sea negativo. " +
        "Usa 'A compensar' para el IVA (modelo 303) con saldo a compensar en periodos siguientes.",
    },
    iban: {
      type: Type.STRING,
      description: "Código IBAN completo sin espacios si se muestra en el formulario de pago, p. ej. 'ES2900811016100006298239'. Si no aparece completo, cadena vacía.",
    },
    fecha_presentacion: {
      type: Type.STRING,
      description: "Fecha en la que se presentó la declaración, SOLO si aparece en la captura: suele estar junto al estado 'PRESENTADA' o el CSV, en un recuadro tipo 'Datos Present. Fecha: 15/07/2026'. " +
        'Formato dd/mm/aaaa. NO la confundas con la fecha de cargo, la fecha límite, el periodo ni el ejercicio, y NO la deduzcas ni la inventes: si no se ve una fecha de presentación en la captura, devuelve cadena vacía.',
    },
    numero_justificante: {
      type: Type.STRING,
      description: "Número de justificante de la declaración (13 dígitos, empieza por el número del modelo, p. ej. '3036123456789'), solo si aparece. Sin espacios. Cadena vacía si no se ve.",
    },
  },
  required: ['modelo', 'periodo', 'ejercicio', 'cliente_nif', 'cliente_nombre', 'importe', 'tipo_resultado'],
};

export const MAIN_PROMPT = 'Analiza detenidamente esta captura de un modelo tributario de la Agencia Tributaria Española (AEAT) ' +
  'o de un programa fiscal como A3 o SAGE y extrae únicamente los datos visibles según el esquema. ' +
  'Transcribe con precisión el modelo, ejercicio, período, NIF, nombre completo, forma de pago y número de justificante. ' +
  'Si aparecen varios importes, usa el resultado final o total de la declaración, nunca una base, cuota intermedia o pago previo. ' +
  'Conserva el signo del importe y convierte correctamente la coma decimal española: 1.234,56 significa 1234.56. ' +
  'No inventes el IBAN, el justificante ni la fecha de presentación: solo devuélvelos cuando se vean completos. ' +
  'Distingue una devolución real de un resultado negativo o a compensar. Si un dato obligatorio no es legible, ' +
  'devuelve una cadena vacía, o 0 en el importe, para que la aplicación obligue a revisarlo. No completes datos con valores habituales.';

export const VERIFY_PROMPT = 'Eres un transcriptor de documentos fiscales españoles. Lee esta captura de forma independiente ' +
  'y copia con exactitud, dígito a dígito, el IBAN, importe final, NIF/CIF, nombre, modelo, período, ejercicio y número de justificante. ' +
  'Comprueba especialmente los decimales y el signo del resultado. No confundas el importe final con bases o cuotas intermedias. ' +
  'Transcribe la fecha de presentación solo cuando aparezca expresamente en la captura. ' +
  'Para el tipo de resultado elige únicamente la opción del esquema que describa lo visible. No inventes ni completes datos ausentes.';

export type Extracted = Record<string, unknown>;

export interface Discrepancy {
  campo: string;
  primera: string;
  segunda: string;
}

export interface ReadResult {
  data: Extracted;
  modelo: string;
  verificacion: { coincide: boolean; discrepancias: Discrepancy[]; modelo: string } | null;
  verificacionError?: string;
}

type GenerateParams = Parameters<GoogleGenAI['models']['generateContent']>[0];
export type GenerateFn = (params: GenerateParams) => Promise<{ text?: string }>;

// ---- Errores ----

const errorText = (error: unknown) => String((error as { message?: unknown })?.message || error || '');

export function isRetryableGeminiError(error: unknown): boolean {
  const text = errorText(error);
  return text.includes('503') || text.includes('UNAVAILABLE') || text.includes('overloaded') ||
    text.includes('high demand') || text.includes('TIMEOUT_GEMINI') || text.includes('500') || text.includes('INTERNAL');
}

/** El modelo no existe para esta clave, se ha retirado o no admite la petición: se prueba el siguiente. */
export function isModelUnavailableError(error: unknown): boolean {
  const text = errorText(error);
  const lower = text.toLowerCase();
  return text.includes('404') || text.includes('NOT_FOUND') || lower.includes('not found') ||
    lower.includes('is not supported') || lower.includes('deprecated') || lower.includes('no longer available') ||
    lower.includes('retired') || lower.includes('shut down');
}

export function isQuotaError(error: unknown): boolean {
  const text = errorText(error);
  const lower = text.toLowerCase();
  return text.includes('429') || lower.includes('quota') || lower.includes('rate limit') || text.includes('RESOURCE_EXHAUSTED');
}

const isThinkingConfigError = (error: unknown) => /thinking/i.test(errorText(error)) && /400|INVALID_ARGUMENT|invalid/i.test(errorText(error));

export function describeGeminiError(error: unknown): string {
  const text = errorText(error);
  const lower = text.toLowerCase();
  if (text.includes('TIMEOUT_GEMINI')) {
    return 'Gemini no ha respondido tras varios intentos. Vuelva a intentarlo en unos segundos.';
  }
  if (isQuotaError(error)) {
    return 'Se ha alcanzado el límite de uso de la clave de Gemini. Espere un minuto o reduzca las capturas en paralelo en Ajustes.';
  }
  if (text.includes('401') || text.includes('403') || lower.includes('api key') || lower.includes('api_key') ||
      lower.includes('permission') || lower.includes('expired')) {
    return 'La clave de Gemini no es válida o ha caducado. Revise la clave en Ajustes → Inteligencia artificial.';
  }
  if (isModelUnavailableError(error)) {
    return 'Ninguno de los modelos configurados está disponible para esta clave. Elija otro modelo en Ajustes → Inteligencia artificial.';
  }
  if (isRetryableGeminiError(error)) {
    return 'Gemini está saturado en este momento. Espere unos segundos y vuelva a intentarlo.';
  }
  return 'Error al leer la captura con Gemini: ' + text;
}

// ---- Llamadas ----

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Corta la espera si Gemini no responde. La API se ha colgado de forma
 * intermitente en llamadas con imagen (ni responde ni da error).
 */
export const GEMINI_TIMEOUT_MS = 45_000;
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT_GEMINI: sin respuesta de Gemini')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export interface CallOptions {
  generate: GenerateFn;
  timeoutMs?: number;
  wait?: (ms: number) => Promise<unknown>;
}

async function callWithRetry(params: GenerateParams, { generate, timeoutMs = GEMINI_TIMEOUT_MS, wait = sleep }: CallOptions) {
  const maxAttempts = 3;
  let current = params;
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(generate(current), timeoutMs);
    } catch (error) {
      // Algún modelo de respaldo puede no admitir el nivel de razonamiento: se
      // repite la misma llamada sin él en vez de descartar el modelo.
      if (isThinkingConfigError(error) && current.config?.thinkingConfig) {
        const { thinkingConfig: _unused, ...config } = current.config;
        current = { ...current, config };
        continue;
      }
      if (!isRetryableGeminiError(error) || attempt >= maxAttempts) throw error;
      await wait(1500 * attempt);
    }
  }
}

function buildParams(model: string, image: { data: string; mimeType: string }, prompt: string): GenerateParams {
  return {
    model,
    contents: [{ inlineData: image }, { text: prompt }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: TAX_SCHEMA,
      // Extraer datos de una captura no necesita razonamiento largo: el nivel
      // bajo responde antes sin perder precisión. (MINIMAL no lo admiten 3.7/3.8.)
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  };
}

/** Prueba cada modelo de la cadena hasta que uno responde. */
export async function readWithFallback(
  models: string[],
  image: { data: string; mimeType: string },
  prompt: string,
  options: CallOptions,
): Promise<{ data: Extracted; modelo: string }> {
  let lastError: unknown = new Error('No hay modelos configurados.');
  for (const model of models) {
    try {
      const response = await callWithRetry(buildParams(model, image, prompt), options);
      const text = (response.text || '').trim();
      if (!text) throw new Error('Gemini no devolvió datos estructurados.');
      return { data: JSON.parse(text), modelo: model };
    } catch (error) {
      lastError = error;
      // Clave no válida: ningún otro modelo va a funcionar.
      if (/401|403|api key|api_key/i.test(errorText(error))) throw error;
      console.warn(`Lectura con ${model} fallida, probando el siguiente modelo:`, errorText(error));
    }
  }
  throw lastError;
}

// ---- Comparación de las dos lecturas ----

export function normalizarCampo(campo: string, valor: unknown): string {
  const s = valor === undefined || valor === null ? '' : String(valor);
  switch (campo) {
    case 'iban':
    case 'cliente_nif':
    case 'numero_justificante':
      return s.replace(/[\s.-]+/g, '').toUpperCase();
    case 'periodo':
      return s.trim().toUpperCase();
    case 'cliente_nombre':
      // Sin acentos, mayúsculas y espacios colapsados: "José Pérez " == "JOSE PEREZ"
      return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
    case 'fecha_presentacion': {
      const match = s.trim().match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/);
      if (!match) return s.trim();
      const [, first, month, last] = match;
      const yearFirst = first.length === 4;
      const year = yearFirst ? first : last;
      const day = yearFirst ? last : first;
      if (year.length !== 4) return s.trim();
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }
    case 'importe':
      return (Math.round((parseFloat(s) || 0) * 100) / 100).toFixed(2);
    case 'tipo_resultado':
      return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\?/g, '').trim().toLowerCase();
    default:
      return s.trim();
  }
}

/** Solo se comparan los campos donde un error tiene consecuencias reales. */
export const CAMPOS_CRITICOS = ['iban', 'importe', 'cliente_nif', 'cliente_nombre', 'modelo', 'periodo', 'ejercicio', 'tipo_resultado', 'fecha_presentacion', 'numero_justificante'];

export function compareReadings(first: Extracted, second: Extracted): Discrepancy[] {
  const discrepancias: Discrepancy[] = [];
  for (const campo of CAMPOS_CRITICOS) {
    const v1 = normalizarCampo(campo, first[campo]);
    const v2 = normalizarCampo(campo, second[campo]);
    if (!v1 && !v2) continue;
    if (v1 !== v2) discrepancias.push({ campo, primera: String(first[campo] ?? ''), segunda: String(second[campo] ?? '') });
  }
  return discrepancias;
}

/**
 * Lectura principal y segunda lectura EN PARALELO, con modelos distintos. Antes
 * la verificación esperaba a la primera lectura y cada captura tardaba el doble.
 * Si la verificación falla no se bloquea el aviso: queda "sin verificar".
 */
export async function readTaxCapture(
  image: { data: string; mimeType: string },
  settings: AiSettings,
  options: CallOptions,
): Promise<ReadResult> {
  const mainModels = modelChain(settings.model, MAIN_FALLBACKS);
  // La verificación nunca usa el modelo preferido de la lectura principal.
  const verifyModels = modelChain(settings.verifyModel, VERIFY_FALLBACKS, [settings.model]);

  const [main, verify] = await Promise.allSettled([
    readWithFallback(mainModels, image, MAIN_PROMPT, options),
    readWithFallback(verifyModels, image, VERIFY_PROMPT, options),
  ]);
  if (main.status === 'rejected') throw main.reason;

  if (verify.status === 'rejected') {
    return { data: main.value.data, modelo: main.value.modelo, verificacion: null, verificacionError: describeGeminiError(verify.reason) };
  }
  const discrepancias = compareReadings(main.value.data, verify.value.data);
  return {
    data: main.value.data,
    modelo: main.value.modelo,
    verificacion: { coincide: discrepancias.length === 0, discrepancias, modelo: verify.value.modelo },
  };
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function parseImagePayload(imageBase64: unknown): { data: string; mimeType: string } {
  const raw = String(imageBase64 || '');
  const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  const mimeType = (match?.[1] || 'image/png').toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error('FORMATO_IMAGEN_NO_ADMITIDO');
  }
  return { mimeType, data: match ? raw.slice(match[0].length) : raw };
}
