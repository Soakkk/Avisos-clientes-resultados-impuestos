import './dom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { NoticeEditor } from '../src/components/NoticeEditor';
import App from '../src/App';

test('el editor reabre el borrador y conserva cambios antes de pulsar Guardar', async () => {
  const host = document.createElement('div');
  const mounted = createRoot(host);
  const notice: any = { id: 'cliente', cliente_nombre: 'Nombre original', cliente_nif: '12345678Z', notices: [] };
  const initialDraft = { jointId: 'cliente', clientName: 'Nombre pendiente', clientNif: '87654321X', taxes: [] };
  let latest: any;
  try {
    await act(async () => { mounted.render(createElement(NoticeEditor as any, { notice, initialDraft, onDraftChange: (draft: any) => { latest = draft; }, onSave: () => {}, onCancel: () => {} })); });
    const name = host.querySelector('input')!;
    assert.equal(name.value, 'Nombre pendiente');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(name, 'Otra edición pendiente');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(latest.clientName, 'Otra edición pendiente');
    assert.equal(latest.clientNif, '87654321X');
  } finally { await act(async () => { mounted.unmount(); }); }
});

test('cerrar durante la hidratación espera los avisos guardados y su borrador', async () => {
  const originalFetch = globalThis.fetch;
  const acknowledgements: boolean[] = [];
  const requestIds: string[] = [];
  const writes: any[] = [];
  let onSave!: (requestId: string) => void;
  let load!: (state: any) => void;
  const loaded = new Promise(resolve => { load = resolve; });
  globalThis.fetch = (async (_url: string, options?: RequestInit) => {
    if (_url === '/api/health') return { ok: true, json: async () => ({ version: '1' }) };
    if (options?.method === 'POST') { writes.push(JSON.parse(options.body as string)); return { ok: true }; }
    return { ok: true, json: () => loaded };
  }) as any;
  window.updates = { check: async () => false, restart: async () => false, stateSaved: (requestId, success) => { requestIds.push(requestId); acknowledgements.push(success); }, onStatus: () => () => {}, onSaveRequested: callback => { onSave = callback; return () => {}; } };
  const root = createRoot(document.createElement('div'));
  const notice = { id: 't', modelo: '303', periodo: '2T', ejercicio: '2026', cliente_nif: '12345678Z', cliente_nombre: 'Nombre original', importe: 1, tipo_resultado: 'A ingresar', timestamp: 1, fechaCargo: '2026-07-20', fechaLimiteDomiciliacion: '2026-07-15' };
  const draft = { jointId: '12345678Z', clientName: 'Edición pendiente', clientNif: '12345678Z', taxes: [notice] };
  try {
    await act(async () => { root.render(createElement(App)); });
    await act(async () => { onSave('close-during-hydration'); });
    assert.deepEqual(acknowledgements, []);
    assert.equal(writes.length, 0);
    await act(async () => { load({ schemaVersion: 1, queue: [], activeNotices: [notice], archivedNotices: [], groupingOverrides: [], draft, updatedAt: '' }); });
    assert.deepEqual(acknowledgements, [true]);
    assert.deepEqual(requestIds, ['close-during-hydration']);
    assert.deepEqual(writes.at(-1).draft, draft);
    assert.equal(writes.at(-1).activeNotices[0].id, 't');
  } finally { await act(async () => { root.unmount(); }); globalThis.fetch = originalFetch; delete window.updates; }
});
