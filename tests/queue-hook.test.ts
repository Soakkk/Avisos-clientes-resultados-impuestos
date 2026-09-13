import './dom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useCaptureQueue } from '../src/queue/useCaptureQueue';

test('la bandeja espera el guardado y se bloquea si el disco lo rechaza', async () => {
  const element = document.createElement('div');
  const root = createRoot(element);
  let rejectSave!: (error: Error) => void;
  const saving = new Promise<void>((_, reject) => { rejectSave = reject; });
  let processed = 0;
  let queue: ReturnType<typeof useCaptureQueue>;
  const process = async () => { processed++; return { jointId: 'cliente' }; };
  const persist = () => saving;
  function Harness() {
    queue = useCaptureQueue({ initialItems: [{ id: 'a', fileId: 'a', status: 'pending', attempts: 0, createdAt: '2026-09-13' }], process, persist });
    return null;
  }
  try {
    await act(async () => { root.render(createElement(Harness)); });
    assert.equal(processed, 0, 'No se debe analizar antes de confirmar la persistencia');
    await act(async () => { rejectSave(new Error('ENOSPC')); await saving.catch(() => {}); });
    assert.match((queue as any).storageError, /ENOSPC/);
    await act(async () => { queue.enqueue([{ id: 'b', fileId: 'b', status: 'pending', attempts: 0, createdAt: '2026-09-13' }]); });
    assert.equal(processed, 0);
    assert.deepEqual(queue.items.map(item => item.id), ['a']);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('la bandeja persiste cada transición antes de continuar con otra captura', async () => {
  const root = createRoot(document.createElement('div'));
  const events: string[] = [];
  const persist = async (items: any[]) => { events.push(items.map(item => item.status).join(',')); };
  const process = async (item: any) => { events.push(`process:${item.id}`); return { jointId: item.id }; };
  function Harness() {
    useCaptureQueue({ initialItems: ['a', 'b'].map(id => ({ id, fileId: id, status: 'pending', attempts: 0, createdAt: '2026-09-13' })), process, persist });
    return null;
  }
  try {
    await act(async () => { root.render(createElement(Harness)); });
    assert.deepEqual(events, ['pending,pending', 'processing,pending', 'process:a', 'review,pending', 'review,processing', 'process:b', 'review,review']);
  } finally { await act(async () => { root.unmount(); }); }
});
