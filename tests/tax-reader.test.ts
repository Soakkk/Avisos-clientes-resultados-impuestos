import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AI_SETTINGS, ConfigStore, modelChain, normalizeSettings } from '../src/server/aiSettings';
import { compareReadings, describeGeminiError, readTaxCapture } from '../src/server/taxReader';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const image = { data: 'AAAA', mimeType: 'image/png' };
const reading = (overrides = {}) => ({
  modelo: '303', periodo: '3T', ejercicio: '2026', cliente_nif: '12345678Z', cliente_nombre: 'José Pérez',
  importe: 120.5, tipo_resultado: 'Domiciliación', iban: 'ES2900811016100006298239', ...overrides,
});
const noWait = async () => {};

test('las dos lecturas se lanzan a la vez con modelos distintos', async () => {
  const calls: string[] = [];
  let pending = 0;
  let maxPending = 0;
  const generate = async (params: any) => {
    calls.push(params.model);
    pending++; maxPending = Math.max(maxPending, pending);
    await new Promise((resolve) => setTimeout(resolve, 5));
    pending--;
    return { text: JSON.stringify(reading()) };
  };
  const result = await readTaxCapture(image, DEFAULT_AI_SETTINGS, { generate, wait: noWait });
  assert.equal(maxPending, 2);
  assert.deepEqual(calls.sort(), ['gemini-3.7-flash', 'gemini-3.8-flash']);
  assert.equal(result.modelo, 'gemini-3.8-flash');
  assert.equal(result.verificacion?.modelo, 'gemini-3.7-flash');
  assert.equal(result.verificacion?.coincide, true);
});

test('si el modelo elegido no existe se usa el siguiente de la cadena', async () => {
  const generate = async (params: any) => {
    if (params.model === 'gemini-9-flash') throw new Error('404 NOT_FOUND: models/gemini-9-flash is not found');
    return { text: JSON.stringify(reading()) };
  };
  const result = await readTaxCapture(image, { ...DEFAULT_AI_SETTINGS, model: 'gemini-9-flash' }, { generate, wait: noWait });
  assert.equal(result.modelo, 'gemini-3.8-flash');
});

test('un modelo que no admite el nivel de razonamiento se repite sin él', async () => {
  const seen: boolean[] = [];
  const generate = async (params: any) => {
    seen.push(Boolean(params.config.thinkingConfig));
    if (params.config.thinkingConfig && params.model === 'gemini-3.8-flash') throw new Error('400 INVALID_ARGUMENT: thinking level not supported');
    return { text: JSON.stringify(reading()) };
  };
  const result = await readTaxCapture(image, DEFAULT_AI_SETTINGS, { generate, wait: noWait });
  assert.equal(result.modelo, 'gemini-3.8-flash');
  assert.ok(seen.includes(false));
});

test('si la verificación falla el aviso sigue adelante sin verificar', async () => {
  const generate = async (params: any) => {
    if (params.model !== 'gemini-3.8-flash') throw new Error('503 UNAVAILABLE');
    return { text: JSON.stringify(reading()) };
  };
  const result = await readTaxCapture(image, DEFAULT_AI_SETTINGS, { generate, wait: noWait });
  assert.equal(result.verificacion, null);
  assert.match(result.verificacionError || '', /saturado/);
});

test('una clave no válida no prueba más modelos', async () => {
  let calls = 0;
  const generate = async () => { calls++; throw new Error('403 PERMISSION_DENIED: API key not valid'); };
  await assert.rejects(readTaxCapture(image, DEFAULT_AI_SETTINGS, { generate, wait: noWait }), /API key/);
  assert.equal(calls, 2);
  assert.match(describeGeminiError(new Error('403 API key not valid')), /clave de Gemini no es válida/);
});

test('la comparación detecta un dígito distinto del IBAN y del justificante', () => {
  const diffs = compareReadings(
    reading({ numero_justificante: '3036123456789' }),
    reading({ iban: 'ES2900811016100006298238', numero_justificante: '303 6123456789', cliente_nombre: 'JOSE PEREZ ' }),
  );
  assert.deepEqual(diffs.map((diff) => diff.campo), ['iban']);
});

test('los ajustes se normalizan y la verificación nunca repite el modelo principal', () => {
  assert.deepEqual(normalizeSettings({ model: 'models/gemini-3.7-flash', verifyModel: '', concurrency: 9 }), {
    model: 'gemini-3.7-flash', verifyModel: DEFAULT_AI_SETTINGS.verifyModel, concurrency: 4,
  });
  assert.ok(!modelChain('gemini-3.8-flash', ['gemini-3.8-flash', 'gemini-3.7-flash'], ['gemini-3.8-flash']).includes('gemini-3.8-flash'));
});

test('guardar ajustes conserva la clave ya guardada', () => {
  const store = new ConfigStore(path.join(mkdtempSync(path.join(tmpdir(), 'avisos-config-')), 'config.json'));
  store.write({ apiKey: 'clave' });
  store.write({ model: 'gemini-3.7-flash', concurrency: 2 });
  assert.deepEqual(store.read(), { apiKey: 'clave', model: 'gemini-3.7-flash', verifyModel: DEFAULT_AI_SETTINGS.verifyModel, concurrency: 2 });
});

test('los errores de clave o modelo no se reintentan y la cuota sí', async () => {
  const { geminiErrorStatus } = await import('../src/server/taxReader');
  assert.equal(geminiErrorStatus(new Error('403 PERMISSION_DENIED: API key not valid')), 400);
  assert.equal(geminiErrorStatus(new Error('404 NOT_FOUND: model not found')), 400);
  assert.equal(geminiErrorStatus(new Error('429 RESOURCE_EXHAUSTED: quota')), 429);
  assert.equal(geminiErrorStatus(new Error('TIMEOUT_GEMINI: sin respuesta')), 503);
});
