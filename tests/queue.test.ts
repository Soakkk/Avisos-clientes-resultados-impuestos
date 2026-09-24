import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialQueueState,
  queueReducer,
  runCaptureQueue,
  TemporaryCaptureError,
} from '../src/queue/reducer';
import type { CaptureItem } from '../src/queue/types';

const item = (id: string): CaptureItem => ({
  id,
  fileId: `file-${id}`,
  status: 'pending',
  attempts: 0,
  createdAt: `2026-09-13T10:00:0${id}.000Z`,
});

test('la bandeja conserva el orden FIFO al encolar varias capturas', () => {
  const state = queueReducer(initialQueueState, { type: 'enqueue', items: [item('1'), item('2'), item('3')] });
  assert.deepEqual(state.items.map((entry) => entry.id), ['1', '2', '3']);
  assert.equal(state.items.filter((entry) => entry.status === 'processing').length, 0);
});

test('la bandeja nunca mantiene más de una captura en proceso', () => {
  let state = queueReducer({ items: [item('1'), item('2')] }, { type: 'start', id: '1' });
  state = queueReducer(state, { type: 'start', id: '2' });
  assert.deepEqual(state.items.map((entry) => entry.status), ['processing', 'pending']);
  assert.equal(state.items[0].attempts, 1);
});

test('la bandeja reintenta errores temporales esperando 1s 2s y 4s', async () => {
  const waits: number[] = [];
  let attempts = 0;
  const final = await runCaptureQueue([item('1')], {
    process: async () => {
      attempts += 1;
      if (attempts < 4) throw new TemporaryCaptureError('Gemini no responde');
      return { jointId: '12345678Z' };
    },
    persist: async () => {},
    sleep: async (milliseconds) => { waits.push(milliseconds); },
  });

  assert.deepEqual(waits, [1_000, 2_000, 4_000]);
  assert.equal(attempts, 4);
  assert.equal(final[0].status, 'review');
  assert.equal(final[0].attempts, 4);
});

test('la bandeja continúa con la siguiente captura tras un fallo definitivo', async () => {
  const processed: string[] = [];
  const snapshots: CaptureItem[][] = [];
  const final = await runCaptureQueue([item('1'), item('2')], {
    process: async (capture) => {
      processed.push(capture.id);
      if (capture.id === '1') throw new TemporaryCaptureError('Servicio no disponible');
      return { jointId: 'B12345678' };
    },
    persist: async (items) => {
      assert.ok(items.filter((entry) => entry.status === 'processing').length <= 1);
      snapshots.push(structuredClone(items));
    },
    sleep: async () => {},
  });

  assert.deepEqual(processed, ['1', '1', '1', '1', '2']);
  assert.deepEqual(final.map((entry) => entry.status), ['failed', 'review']);
  assert.match(final[0].error || '', /Servicio no disponible/);
  assert.ok(snapshots.length > 0);
});

test('los errores de datos pasan a revisión sin detener la bandeja', async () => {
  const final = await runCaptureQueue([item('1'), item('2')], {
    process: async (capture) => {
      if (capture.id === '1') throw new Error('NIF ilegible');
      return { jointId: 'B12345678' };
    },
    persist: async () => {},
    sleep: async () => {},
  });

  assert.deepEqual(final.map((entry) => entry.status), ['review', 'review']);
  assert.equal(final[0].error, 'NIF ilegible');
});

test('reintentar manualmente reinicia el contador agotado de la bandeja', () => {
  const failed = { ...item('1'), status: 'failed' as const, attempts: 4, error: 'Sin conexión' };
  const state = queueReducer({ items: [failed] }, { type: 'retry', id: '1', error: '' });
  assert.equal(state.items[0].status, 'pending');
  assert.equal(state.items[0].attempts, 0);
});

test('con un límite mayor la bandeja lee varias capturas a la vez sin pasarse', () => {
  let state = queueReducer({ items: [item('1'), item('2'), item('3')] }, { type: 'start', id: '1', limit: 2 });
  state = queueReducer(state, { type: 'start', id: '2', limit: 2 });
  state = queueReducer(state, { type: 'start', id: '3', limit: 2 });
  assert.deepEqual(state.items.map((entry) => entry.status), ['processing', 'processing', 'pending']);
});
