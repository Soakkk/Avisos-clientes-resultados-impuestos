import type { CardFormat } from './components/NoticeCard';
import type { MessageTemplates, TemplateId } from './whatsapp';
import { TEMPLATE_IDS } from './whatsapp';

/** Preferencias ligeras de la asesoría, guardadas en el propio equipo. */
export interface Preferences {
  agencyName: string;
  signatureText: string;
  cardFormat: CardFormat;
  /** Solo las plantillas que el usuario ha cambiado; el resto usa el texto original. */
  templates: Partial<MessageTemplates>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  agencyName: 'Asesoría E. Marín',
  signatureText: 'Atentamente,\nAsesoría E. Marín',
  cardFormat: 'A',
  templates: {},
};

const KEYS = {
  agencyName: 'aeat_agency_name',
  signatureText: 'aeat_signature_text',
  cardFormat: 'aeat_card_format',
  templates: 'aeat_message_templates',
} as const;

const read = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: se usan los valores por defecto */ }
};

export function loadPreferences(): Preferences {
  const format = read(KEYS.cardFormat);
  let templates: Partial<MessageTemplates> = {};
  try {
    const parsed = JSON.parse(read(KEYS.templates) || '{}');
    for (const id of TEMPLATE_IDS) {
      if (typeof parsed[id] === 'string' && parsed[id].trim()) templates[id as TemplateId] = parsed[id];
    }
  } catch {
    templates = {};
  }
  return {
    agencyName: read(KEYS.agencyName) || DEFAULT_PREFERENCES.agencyName,
    signatureText: read(KEYS.signatureText) || DEFAULT_PREFERENCES.signatureText,
    cardFormat: format === 'A' || format === 'B' || format === 'C' ? format : DEFAULT_PREFERENCES.cardFormat,
    templates,
  };
}

export function savePreferences(preferences: Preferences) {
  write(KEYS.agencyName, preferences.agencyName);
  write(KEYS.signatureText, preferences.signatureText);
  write(KEYS.cardFormat, preferences.cardFormat);
  write(KEYS.templates, JSON.stringify(preferences.templates));
}
