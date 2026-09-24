import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuración local de la IA (%USERPROFILE%\.generador-avisos-fiscales\config.json).
 * Vive fuera de la carpeta de instalación para sobrevivir a actualizaciones.
 */
export interface AiSettings {
  /** Modelo de la lectura principal. */
  model: string;
  /** Modelo de la segunda lectura. Debe ser distinto para que el contraste sea independiente. */
  verifyModel: string;
  /** Capturas que se leen a la vez (1 = de una en una). */
  concurrency: number;
}

export interface StoredConfig extends AiSettings {
  apiKey?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
}

/**
 * Modelos recomendados (septiembre de 2026). La 2.x está retirada o a punto de
 * retirarse; los alias "latest" quedan como último recurso porque Google los
 * cambia de modelo con solo dos semanas de aviso.
 */
export const RECOMMENDED_MODELS: ModelOption[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', hint: 'El más preciso. Recomendado para la lectura principal.' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', hint: 'Muy preciso y algo más rápido. Recomendado para la verificación.' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', hint: 'Generación anterior, estable.' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', hint: 'El más rápido y barato; algo menos preciso.' },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: 'gemini-3.8-flash',
  verifyModel: 'gemini-3.7-flash',
  concurrency: 3,
};

/** Respaldo si el modelo elegido no está disponible para la clave o ha sido retirado. */
export const MAIN_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
export const VERIFY_FALLBACKS = ['gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest'];

export const MAX_CONCURRENCY = 4;

const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,79}$/;

export function sanitizeModelId(value: unknown): string | undefined {
  const clean = String(value ?? '').trim().replace(/^models\//, '');
  return MODEL_ID.test(clean) ? clean : undefined;
}

export function normalizeSettings(input: Partial<Record<keyof AiSettings, unknown>> = {}): AiSettings {
  const concurrency = Math.round(Number(input.concurrency));
  return {
    model: sanitizeModelId(input.model) || DEFAULT_AI_SETTINGS.model,
    verifyModel: sanitizeModelId(input.verifyModel) || DEFAULT_AI_SETTINGS.verifyModel,
    concurrency: Number.isFinite(concurrency) ? Math.min(MAX_CONCURRENCY, Math.max(1, concurrency)) : DEFAULT_AI_SETTINGS.concurrency,
  };
}

/** Lista sin duplicados, con el preferido delante y sin los modelos excluidos. */
export function modelChain(preferred: string, fallbacks: string[], exclude: string[] = []): string[] {
  return Array.from(new Set([preferred, ...fallbacks])).filter((model) => model && !exclude.includes(model));
}

export class ConfigStore {
  constructor(private readonly file: string) {}

  read(): StoredConfig {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        return { ...normalizeSettings(parsed), apiKey: typeof parsed.apiKey === 'string' && parsed.apiKey ? parsed.apiKey : undefined };
      }
    } catch (error) {
      console.error('No se pudo leer la configuración local:', error);
    }
    return { ...DEFAULT_AI_SETTINGS };
  }

  write(update: Partial<StoredConfig>): StoredConfig {
    const current = this.read();
    const next: StoredConfig = {
      ...normalizeSettings({ ...current, ...update }),
      apiKey: update.apiKey !== undefined ? update.apiKey : current.apiKey,
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }
}
