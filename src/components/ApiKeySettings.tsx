import React, { useEffect, useState } from 'react';
import { Settings, X, Check, KeyRound, ExternalLink, FlaskConical, Loader2 } from 'lucide-react';

interface ApiKeySettingsProps {
  onConfigured?: () => void;
}

export const ApiKeySettings: React.FC<ApiKeySettingsProps> = ({ onConfigured }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Comprueba contra Gemini que la clave guardada funciona de verdad
  // (no solo que haya "algo" guardado).
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/config/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({ ok: true, message: 'La clave funciona correctamente. Ya puede analizar capturas.' });
      } else {
        setTestResult({ ok: false, message: data.error || 'La clave no ha respondido correctamente.' });
      }
    } catch {
      setTestResult({ ok: false, message: 'No se pudo contactar con el servidor local.' });
    } finally {
      setTesting(false);
    }
  };

  const refreshStatus = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setHasApiKey(!!data.hasApiKey);
    } catch {
      setHasApiKey(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleSave = async () => {
    if (!apiKeyInput.trim()) {
      setError('Pega tu clave de API de Gemini antes de guardar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la clave.');

      setHasApiKey(true);
      setApiKeyInput('');
      setSaved(true);
      onConfigured?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar la clave.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
          hasApiKey
            ? 'bg-[#F5F8FC] text-[#5D7084] hover:bg-[#EDF4FA] border-[#DCE5F0]'
            : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200'
        }`}
        id="btn-open-settings"
      >
        <Settings className="w-3.5 h-3.5" />
        <span>{hasApiKey ? 'Ajustes' : 'Configurar API Key'}</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-[#DCE5F0]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-[#326FA6] flex items-center justify-center text-white">
                  <KeyRound className="w-4.5 h-4.5" />
                </div>
                <h2 className="font-display font-bold text-sm text-slate-900">
                  Clave de API de Gemini
                </h2>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700"
                id="btn-close-settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed mb-3">
              Esta clave se guarda únicamente en este ordenador (nunca se sube a internet ni a GitHub) y permite
              que la app lea las capturas de pantalla con IA.
            </p>

            <ol className="text-xs text-slate-600 leading-relaxed mb-3 list-decimal pl-4 space-y-1">
              <li>Pulse el botón de abajo: se abrirá Google AI Studio en su navegador.</li>
              <li>Inicie sesión con su cuenta de Google y pulse <b>«Create API key»</b>.</li>
              <li>Copie la clave y péguela aquí. Es gratis.</li>
            </ol>

            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-4 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all shadow-sm"
              id="btn-open-aistudio"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Crear una clave gratis en Google AI Studio</span>
            </a>

            <div className="mb-2 text-[11px] font-semibold text-slate-500">
              Estado actual:{' '}
              {hasApiKey === null ? (
                <span className="text-slate-400">comprobando…</span>
              ) : hasApiKey ? (
                <span className="text-emerald-600">clave configurada ✓</span>
              ) : (
                <span className="text-amber-600">sin configurar</span>
              )}
            </div>

            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Pega aquí tu clave de Google AI Studio"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-slate-800 bg-slate-50/50 font-mono mb-2"
            />

            {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#326FA6] hover:bg-[#285D8D] rounded-lg transition-all disabled:opacity-50"
                id="btn-save-api-key"
              >
                {saved ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>¡Guardada!</span>
                  </>
                ) : (
                  <span>{saving ? 'Guardando…' : 'Guardar clave'}</span>
                )}
              </button>

              <button
                onClick={handleTest}
                disabled={testing || !hasApiKey}
                title={hasApiKey ? 'Hace una llamada mínima a Gemini para confirmar que la clave guardada funciona' : 'Guarde primero una clave'}
                className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 transition-all disabled:opacity-50"
                id="btn-test-api-key"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                <span>{testing ? 'Probando…' : 'Probar clave'}</span>
              </button>
            </div>

            {testResult && (
              <p className={`text-xs mt-2 leading-relaxed ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                {testResult.ok ? '✓ ' : '✖ '}{testResult.message}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
