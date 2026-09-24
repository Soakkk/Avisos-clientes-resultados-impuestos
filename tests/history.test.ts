import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { CaptureQueue } from '../src/components/CaptureQueue';
import { NoticeHistory } from '../src/components/NoticeHistory';
import {
  completeAndContinue,
  createMergeOverride,
  createSplitOverride,
  groupNotices,
  searchArchivedNotices,
  undoGroupingOverride,
} from '../src/history';
import type { ArchivedNotice } from '../src/storage/types';
import type { JointNotice, TaxNotice } from '../src/types';

const tax = (id: string, nif: string, name: string, model = '303'): TaxNotice => ({
  id, modelo: model, modelo_nombre: `Modelo ${model}`, periodo: '2T', ejercicio: '2026',
  cliente_nif: nif, cliente_nombre: name, importe: 100, tipo_resultado: 'A ingresar',
  fechaCargo: '2026-07-20T12:00:00.000Z', fechaLimiteDomiciliacion: '2026-07-15T12:00:00.000Z', timestamp: 1,
});

const joint = (id: string): JointNotice => ({
  id, cliente_nombre: `Cliente ${id}`, cliente_nif: id,
  notices: [tax(`tax-${id}`, id, `Cliente ${id}`)], total_importe: 100, todosDomiciliados: false,
});

test('la búsqueda del historial ignora acentos y combina filtros', () => {
  const archived: ArchivedNotice[] = [{
    id: 'uno', archivedAt: '2026-09-13T10:00:00.000Z', cliente_nombre: 'José Pérez', cliente_nif: '12345678Z',
    models: ['303'], periods: ['2T'], noticeIds: ['tax-1'], snapshot: joint('12345678Z'),
  }, {
    id: 'dos', archivedAt: '2026-08-01T10:00:00.000Z', cliente_nombre: 'Otra Empresa', cliente_nif: 'B12345678',
    models: ['130'], periods: ['1T'], noticeIds: ['tax-2'], snapshot: joint('B12345678'),
  }];

  assert.deepEqual(searchArchivedNotices(archived, { query: 'jose perez', model: '303', period: '2t' }).map((item) => item.id), ['uno']);
  assert.deepEqual(searchArchivedNotices(archived, { from: '2026-09-01', to: '2026-09-30' }).map((item) => item.id), ['uno']);
});

test('copiar archivar y continuar respeta el orden y selecciona el siguiente pendiente', async () => {
  const events: string[] = [];
  const next = await completeAndContinue({
    joint: joint('A'),
    mode: 'text',
    exportText: async () => { events.push('copy'); },
    exportImage: async () => { events.push('image'); },
    archive: async () => { events.push('archive'); },
    pendingJointIds: ['A', 'B', 'C'],
  });

  assert.deepEqual(events, ['copy', 'archive']);
  assert.equal(next, 'B');
});

test('un fallo al copiar impide archivar el aviso', async () => {
  let archived = false;
  await assert.rejects(completeAndContinue({
    joint: joint('A'), mode: 'image',
    exportText: async () => {},
    exportImage: async () => { throw new Error('portapapeles ocupado'); },
    archive: async () => { archived = true; },
    pendingJointIds: ['A', 'B'],
  }), /portapapeles ocupado/);
  assert.equal(archived, false);
});

test('separar unir y deshacer son decisiones de agrupación reversibles', () => {
  const notices = [
    tax('one', 'B12345678', 'Empresa Uno'),
    tax('two', 'B12345678', 'Empresa Uno', '130'),
    tax('three', 'B87654321', 'Empresa Dos'),
  ];
  const base = groupNotices(notices, []);
  assert.deepEqual(base.map((group) => group.notices.length), [2, 1]);

  const split = createSplitOverride(base[0], '2026-09-13T10:00:00.000Z');
  const separated = groupNotices(notices, [split]);
  assert.deepEqual(separated.map((group) => group.notices.length).sort(), [1, 1, 1]);

  const merge = createMergeOverride(separated[0], separated[2], '2026-09-13T10:01:00.000Z');
  const merged = groupNotices(notices, [split, merge]);
  assert.deepEqual(merged.map((group) => group.notices.length).sort(), [1, 2]);
  assert.deepEqual(groupNotices(notices, undoGroupingOverride([split, merge])).map((group) => group.notices.length).sort(), [1, 1, 1]);
});

test('la bandeja expone estados errores y reintento de cada captura', () => {
  const markup = renderToStaticMarkup(createElement(CaptureQueue, {
    items: [{ id: 'one', fileId: 'file-one', status: 'failed', attempts: 4, error: 'Sin conexión', createdAt: '2026-09-13T10:00:00.000Z' }],
    onRetry: () => {},
    onSelect: () => {},
  }));
  assert.match(markup, /Capturas en proceso/);
  assert.match(markup, /Sin conexión/);
  assert.match(markup, /Reintentar/);
});

test('el historial ofrece los cinco filtros y permite reabrir avisos', () => {
  const markup = renderToStaticMarkup(createElement(NoticeHistory, {
    items: [{
      id: 'uno', archivedAt: '2026-09-13T10:00:00.000Z', cliente_nombre: 'José Pérez', cliente_nif: '12345678Z',
      models: ['303'], periods: ['2T'], noticeIds: ['tax-1'], snapshot: joint('12345678Z'),
    }],
    onReopen: () => {},
    onViewCapture: () => {},
  }));
  for (const label of ['Buscar', 'Modelo', 'Periodo', 'Desde', 'Hasta', 'Reabrir']) assert.match(markup, new RegExp(label));
});
