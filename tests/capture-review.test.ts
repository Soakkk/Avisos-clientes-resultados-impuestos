import './dom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureQueue } from '../src/components/CaptureQueue';

test('una captura en revisión sin aviso permite abrir el original y reintentar', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const viewed: string[] = [];
  const retried: string[] = [];
  try {
    await act(async () => { root.render(createElement(CaptureQueue as any, {
      items: [{ id: 'fallo', fileId: 'original', status: 'review', attempts: 1, error: 'Datos incompletos', createdAt: '' }],
      onRetry: (id: string) => retried.push(id), onSelect: () => {}, onViewCapture: (id: string) => viewed.push(id),
    })); });
    const buttons = Array.from(host.querySelectorAll('button'));
    const original = buttons.find(button => button.textContent.includes('Original'));
    const retry = buttons.find(button => button.textContent.includes('Reintentar'));
    assert.ok(original && !original.disabled);
    assert.ok(retry && !retry.disabled);
    await act(async () => { original.click(); retry.click(); });
    assert.deepEqual(viewed, ['original']);
    assert.deepEqual(retried, ['fallo']);
  } finally { await act(async () => { root.unmount(); }); }
});
