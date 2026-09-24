import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, CalendarDays, Check, ExternalLink, FlaskConical, KeyRound, Loader2, MessageSquareText, RefreshCw,
  RotateCcw, Sparkles, X,
} from 'lucide-react';
import { yearOverview } from '../aeatCalendar';
import type { Preferences } from '../preferences';
import type { JointNotice, TaxNotice } from '../types';
import { formatDateSpanish } from '../types';
import { jointTotals } from '../summary';
import {
  DEFAULT_TEMPLATES, TEMPLATE_IDS, TEMPLATE_LABELS, TEMPLATE_VARIABLES, buildWhatsAppText, type TemplateId,
} from '../whatsapp';
import type { CardFormat } from './NoticeCard';

export type SettingsTab = 'general' | 'plantillas' | 'ia' | 'calendario';

export interface AiConfig {
  hasApiKey: boolean;
  model: string;
  verifyModel: string;
  concurrency: number;
  maxConcurrency: number;
  recommendedModels: { id: string; label: string; hint: string }[];
}

const TABS: { id: SettingsTab; label: string; Icon: typeof Building2 }[] = [
  { id: 'general', label: 'Asesoría', Icon: Building2 },
  { id: 'plantillas', label: 'Texto del mensaje', Icon: MessageSquareText },
  { id: 'ia', label: 'Inteligencia artificial', Icon: Sparkles },
  { id: 'calendario', label: 'Calendario AEAT', Icon: CalendarDays },
];

const CARD_FORMATS: { id: CardFormat; label: string }[] = [
  { id: 'A', label: 'Equilibrado' },
  { id: 'B', label: 'Recibo' },
  { id: 'C', label: 'Una ojeada' },
];

// ---- Ejemplos para la vista previa de las plantillas ----

const sampleTax = (overrides: Partial<TaxNotice>): TaxNotice => ({
  id: 'ejemplo', modelo: '303', modelo_nombre: 'Impuesto sobre el Valor Añadido', periodo: '3T', ejercicio: '2026',
  cliente_nif: '12345678Z', cliente_nombre: 'CLIENTE DE EJEMPLO', importe: 818.55, tipo_resultado: 'Domiciliación',
  iban: 'ES2900811016100006298239', fechaCargo: '2026-10-20T10:00:00.000Z', fechaLimiteDomiciliacion: '2026-10-15T10:00:00.000Z',
  timestamp: 1, ...overrides,
});

const SAMPLE_BY_TEMPLATE: Record<TemplateId, TaxNotice[]> = {
  'uno-domiciliado': [sampleTax({})],
  'uno-a-ingresar': [sampleTax({ tipo_resultado: 'A ingresar' })],
  'uno-devolucion': [sampleTax({ importe: -312.4, tipo_resultado: 'Devolución' })],
  'uno-negativo': [sampleTax({ modelo: '130', modelo_nombre: 'Pago fraccionado IRPF', importe: -140, tipo_resultado: 'Resultado negativo' })],
  'uno-sin-pago': [sampleTax({ importe: -120, tipo_resultado: 'A compensar' })],
  'varios-domiciliado': [sampleTax({ id: 'a' }), sampleTax({ id: 'b', modelo: '130', modelo_nombre: 'Pago fraccionado IRPF', importe: 210 })],
  'varios-a-ingresar': [sampleTax({ id: 'a', tipo_resultado: 'A ingresar' }), sampleTax({ id: 'b', modelo: '111', modelo_nombre: 'Retenciones', importe: 95, tipo_resultado: 'A ingresar' })],
  'varios-devolucion': [sampleTax({ id: 'a', importe: -312.4, tipo_resultado: 'Devolución' }), sampleTax({ id: 'b', modelo: '130', modelo_nombre: 'Pago fraccionado IRPF', importe: 0, tipo_resultado: 'Resultado cero / Sin actividad' })],
  'varios-sin-pago': [sampleTax({ id: 'a', importe: -120, tipo_resultado: 'A compensar' }), sampleTax({ id: 'b', modelo: '130', modelo_nombre: 'Pago fraccionado IRPF', importe: -80, tipo_resultado: 'Resultado negativo' })],
};

const sampleJoint = (id: TemplateId): JointNotice => {
  const notices = SAMPLE_BY_TEMPLATE[id];
  return { id: 'ejemplo', cliente_nombre: 'CLIENTE DE EJEMPLO', cliente_nif: '12345678Z', notices, ...jointTotals(notices) };
};

export function SettingsDialog({
  open,
  initialTab = 'general',
  preferences,
  aiConfig,
  appVersion,
  onClose,
  onSavePreferences,
  onAiConfigChanged,
}: {
  open: boolean;
  initialTab?: SettingsTab;
  preferences: Preferences;
  aiConfig: AiConfig | null;
  appVersion: string;
  onClose: () => void;
  onSavePreferences: (preferences: Preferences) => void;
  onAiConfigChanged: (config: AiConfig) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [aiDraft, setAiDraft] = useState({ model: '', verifyModel: '', concurrency: 1 });
  const [templateId, setTemplateId] = useState<TemplateId>('uno-domiciliado');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState<'save' | 'test' | null>(null);
  const [keyResult, setKeyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<{ id: string; label: string }[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const templateRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setDraft(preferences);
    setKeyResult(null);
    setSaveError('');
    setApiKeyInput('');
    if (aiConfig) setAiDraft({ model: aiConfig.model, verifyModel: aiConfig.verifyModel, concurrency: aiConfig.concurrency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const templateText = draft.templates[templateId] ?? DEFAULT_TEMPLATES[templateId];
  const templateCustomized = draft.templates[templateId] !== undefined && draft.templates[templateId] !== DEFAULT_TEMPLATES[templateId];
  const preview = useMemo(() => buildWhatsAppText(sampleJoint(templateId), {
    agencyName: draft.agencyName, signatureText: draft.signatureText, templates: draft.templates,
  }), [draft, templateId]);
  const overview = useMemo(() => yearOverview(calendarYear), [calendarYear]);

  if (!open) return null;

  const setTemplate = (value: string) => {
    setDraft((current) => {
      const templates = { ...current.templates };
      if (value === DEFAULT_TEMPLATES[templateId]) delete templates[templateId];
      else templates[templateId] = value;
      return { ...current, templates };
    });
  };

  const insertVariable = (name: string) => {
    const area = templateRef.current;
    const token = `{${name}}`;
    if (!area) return setTemplate(templateText + token);
    const start = area.selectionStart ?? templateText.length;
    const end = area.selectionEnd ?? templateText.length;
    setTemplate(templateText.slice(0, start) + token + templateText.slice(end));
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const postConfig = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la configuración.');
    return data;
  };

  const refreshAiConfig = async () => {
    const response = await fetch('/api/config');
    if (response.ok) onAiConfigChanged(await response.json());
  };

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) {
      setKeyResult({ ok: false, message: 'Pegue la clave de Gemini antes de guardar.' });
      return;
    }
    setKeyBusy('save');
    setKeyResult(null);
    try {
      await postConfig({ apiKey: apiKeyInput.trim() });
      setApiKeyInput('');
      await refreshAiConfig();
      setKeyResult({ ok: true, message: 'Clave guardada en este equipo. Pulse «Probar» para comprobarla.' });
    } catch (error) {
      setKeyResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setKeyBusy(null);
    }
  };

  const handleTestKey = async () => {
    setKeyBusy('test');
    setKeyResult(null);
    try {
      if (aiConfig && (aiDraft.model !== aiConfig.model)) await postConfig({ model: aiDraft.model });
      const response = await fetch('/api/config/test', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      setKeyResult(response.ok && data.ok
        ? { ok: true, message: `La clave funciona con ${data.modelo}.` }
        : { ok: false, message: data.error || 'La clave no ha respondido correctamente.' });
      await refreshAiConfig();
    } catch {
      setKeyResult({ ok: false, message: 'No se pudo contactar con el servidor local.' });
    } finally {
      setKeyBusy(null);
    }
  };

  const loadModels = async () => {
    setModelsBusy(true);
    setModelsError('');
    try {
      const response = await fetch('/api/config/models');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar la lista de modelos.');
      setAvailableModels(data.models || []);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelsBusy(false);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    try {
      if (aiConfig && (aiDraft.model !== aiConfig.model || aiDraft.verifyModel !== aiConfig.verifyModel || aiDraft.concurrency !== aiConfig.concurrency)) {
        if (aiDraft.model === aiDraft.verifyModel) throw new Error('La verificación debe usar un modelo distinto al de la lectura principal.');
        await postConfig(aiDraft);
        await refreshAiConfig();
      }
      onSavePreferences(draft);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const modelOptions = (() => {
    const options = new Map<string, string>();
    aiConfig?.recommendedModels?.forEach((model) => options.set(model.id, `${model.label} (recomendado)`));
    availableModels?.forEach((model) => { if (!options.has(model.id)) options.set(model.id, model.label === model.id ? model.id : `${model.label} · ${model.id}`); });
    [aiDraft.model, aiDraft.verifyModel].forEach((id) => { if (id && !options.has(id)) options.set(id, id); });
    return Array.from(options, ([id, label]) => ({ id, label }));
  })();
  const hintFor = (id: string) => aiConfig?.recommendedModels?.find((model) => model.id === id)?.hint;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog dialog-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-header">
          <h2 id="settings-title">Ajustes</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar ajustes"><X aria-hidden="true" /></button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Secciones de ajustes">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} type="button" data-active={tab === id} onClick={() => setTab(id)}>
                <Icon aria-hidden="true" />{label}
              </button>
            ))}
            <div className="settings-version">Versión {appVersion || '…'}</div>
          </nav>

          <div className="settings-content">
            {tab === 'general' && (
              <section className="settings-section">
                <h3>Datos de la asesoría</h3>
                <label className="field">
                  <span>Nombre de la asesoría</span>
                  <input value={draft.agencyName} onChange={(event) => setDraft({ ...draft, agencyName: event.target.value })} />
                </label>
                <label className="field">
                  <span>Firma de los mensajes</span>
                  <textarea rows={3} value={draft.signatureText} onChange={(event) => setDraft({ ...draft, signatureText: event.target.value })} />
                </label>
                <div className="field">
                  <span>Formato de la ficha en imagen</span>
                  <div className="segmented">
                    {CARD_FORMATS.map((option) => (
                      <button key={option.id} type="button" data-active={draft.cardFormat === option.id} onClick={() => setDraft({ ...draft, cardFormat: option.id })}>
                        <strong>{option.id}</strong> {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tab === 'plantillas' && (
              <section className="settings-section">
                <h3>Texto del mensaje de WhatsApp</h3>
                <p className="settings-help">
                  Cada situación tiene su propio texto. Las palabras entre llaves se sustituyen por los datos del aviso.
                  Si falta un dato (por ejemplo, la cuenta), su línea no se incluye.
                </p>
                <div className="template-toolbar">
                  <label className="field field-inline">
                    <span>Situación</span>
                    <select value={templateId} onChange={(event) => setTemplateId(event.target.value as TemplateId)}>
                      {TEMPLATE_IDS.map((id) => (
                        <option key={id} value={id}>{TEMPLATE_LABELS[id]}{draft.templates[id] !== undefined ? ' · modificado' : ''}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn" disabled={!templateCustomized} onClick={() => setTemplate(DEFAULT_TEMPLATES[templateId])}>
                    <RotateCcw aria-hidden="true" /> Restaurar original
                  </button>
                </div>
                <div className="variable-chips" aria-label="Insertar variable">
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <button key={variable.name} type="button" title={variable.description} onClick={() => insertVariable(variable.name)}>
                      {`{${variable.name}}`}
                    </button>
                  ))}
                </div>
                <div className="template-grid">
                  <label className="field">
                    <span>Plantilla</span>
                    <textarea ref={templateRef} className="mono" rows={16} value={templateText} onChange={(event) => setTemplate(event.target.value)} spellCheck />
                  </label>
                  <div className="field">
                    <span>Vista previa con un ejemplo</span>
                    <pre className="template-preview">{preview}</pre>
                  </div>
                </div>
              </section>
            )}

            {tab === 'ia' && (
              <section className="settings-section">
                <h3>Clave de Google Gemini</h3>
                <div className="key-status" data-ok={!!aiConfig?.hasApiKey}>
                  {aiConfig?.hasApiKey ? <Check aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                  {aiConfig?.hasApiKey ? 'Hay una clave guardada en este equipo.' : 'Todavía no hay ninguna clave guardada.'}
                </div>
                <div className="field-row">
                  <input
                    type="password"
                    placeholder={aiConfig?.hasApiKey ? 'Pegue una clave nueva para sustituirla' : 'Pegue aquí su clave de Gemini'}
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                    autoComplete="off"
                  />
                  <button type="button" className="btn btn-primary" onClick={handleSaveKey} disabled={keyBusy !== null}>
                    {keyBusy === 'save' ? <Loader2 className="is-spinning" aria-hidden="true" /> : <KeyRound aria-hidden="true" />} Guardar clave
                  </button>
                  <button type="button" className="btn" onClick={handleTestKey} disabled={keyBusy !== null || !aiConfig?.hasApiKey}>
                    {keyBusy === 'test' ? <Loader2 className="is-spinning" aria-hidden="true" /> : <FlaskConical aria-hidden="true" />} Probar
                  </button>
                </div>
                {keyResult && <p className="inline-result" data-ok={keyResult.ok}>{keyResult.message}</p>}
                <a className="link-btn" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" /> Gestionar claves en Google AI Studio
                </a>

                <h3>Modelos</h3>
                <p className="settings-help">
                  Cada captura se lee dos veces a la vez con modelos distintos y se comparan los datos. Si el modelo elegido
                  no está disponible, la aplicación prueba automáticamente el siguiente recomendado.
                </p>
                <div className="field-grid">
                  <label className="field">
                    <span>Lectura principal</span>
                    <select value={aiDraft.model} onChange={(event) => setAiDraft({ ...aiDraft, model: event.target.value })}>
                      {modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    {hintFor(aiDraft.model) && <small>{hintFor(aiDraft.model)}</small>}
                  </label>
                  <label className="field">
                    <span>Segunda lectura (verificación)</span>
                    <select value={aiDraft.verifyModel} onChange={(event) => setAiDraft({ ...aiDraft, verifyModel: event.target.value })}>
                      {modelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    {aiDraft.model === aiDraft.verifyModel
                      ? <small className="text-danger">Elija un modelo distinto al de la lectura principal.</small>
                      : hintFor(aiDraft.verifyModel) && <small>{hintFor(aiDraft.verifyModel)}</small>}
                  </label>
                </div>
                <div className="field-row">
                  <button type="button" className="btn" onClick={loadModels} disabled={modelsBusy || !aiConfig?.hasApiKey}>
                    {modelsBusy ? <Loader2 className="is-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Ver los modelos de mi clave
                  </button>
                  {availableModels && <small className="muted">{availableModels.length} modelos disponibles añadidos a la lista.</small>}
                  {modelsError && <small className="text-danger">{modelsError}</small>}
                </div>

                <h3>Velocidad</h3>
                <label className="field">
                  <span>Capturas que se leen a la vez: <strong>{aiDraft.concurrency}</strong></span>
                  <input
                    type="range" min={1} max={aiConfig?.maxConcurrency || 4} step={1}
                    value={aiDraft.concurrency}
                    onChange={(event) => setAiDraft({ ...aiDraft, concurrency: Number(event.target.value) })}
                  />
                  <small>Con una clave de pago se pueden leer 3 o 4 a la vez. Si aparecen avisos de límite de uso, bájelo.</small>
                </label>
              </section>
            )}

            {tab === 'calendario' && (
              <section className="settings-section">
                <div className="calendar-heading">
                  <h3>Calendario del contribuyente</h3>
                  <label className="field field-inline">
                    <span>Año</span>
                    <select value={calendarYear} onChange={(event) => setCalendarYear(Number(event.target.value))}>
                      {[-1, 0, 1].map((offset) => {
                        const year = new Date().getFullYear() + offset;
                        return <option key={year} value={year}>{year}</option>;
                      })}
                    </select>
                  </label>
                </div>
                <div className="date-legend">
                  <div><strong>Fin del plazo</strong> Último día para presentar e ingresar. Si está domiciliada, es el día del <strong>cargo en cuenta</strong>.</div>
                  <div><strong>Fin de la domiciliación</strong> Último día para presentar eligiendo la domiciliación como forma de pago.</div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr><th>Periodo</th><th>Modelos</th><th>Fin del plazo / cargo</th><th>Fin domiciliación</th><th>Origen</th></tr>
                  </thead>
                  <tbody>
                    {overview.map((row) => (
                      <tr key={`${row.etiqueta}-${row.modelos}`}>
                        <td>{row.etiqueta}</td>
                        <td>{row.modelos}</td>
                        <td>
                          {formatDateSpanish(row.plazos.finPlazo)}
                          {row.plazos.traslado && <small className="muted block">{row.plazos.traslado}</small>}
                        </td>
                        <td>{row.plazos.finDomiciliacion ? formatDateSpanish(row.plazos.finDomiciliacion) : '—'}</td>
                        <td><span className="tag" data-tone={row.plazos.origen === 'oficial' ? 'success' : 'neutral'}>{row.plazos.origen === 'oficial' ? 'Oficial AEAT' : 'Calculado'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="settings-help">
                  «Oficial» son fechas copiadas del calendario publicado por la AEAT. «Calculado» aplica sus reglas: si el último día
                  cae en sábado, domingo o festivo nacional pasa al siguiente día hábil, y la fecha de domiciliación nunca se retrasa.
                  Los festivos autonómicos o locales (p. ej. Lunes de Pascua) pueden ampliar el plazo en su municipio.
                </p>
              </section>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          {saveError && <span className="text-danger footer-error">{saveError}</span>}
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>Guardar cambios</button>
        </div>
      </div>
    </div>
  );
}
