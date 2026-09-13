import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { ClientDirectory } from '../src/storage/clientDirectory';
import { NoticeRepository } from '../src/storage/noticeRepository';
import { createStorageRouter } from '../src/storage/router';
import type { ArchivedNotice, NoticeState } from '../src/storage/types';

const makeRoot = () => mkdtemp(path.join(tmpdir(), 'avisos-storage-'));

const notice = (overrides: Partial<ArchivedNotice> = {}): ArchivedNotice => ({
  id: 'joint-1',
  archivedAt: '2026-09-13T10:00:00.000Z',
  cliente_nombre: 'José Pérez',
  cliente_nif: '12345678Z',
  models: ['303'],
  periods: ['2T'],
  noticeIds: ['tax-1'],
  snapshot: { total_importe: 120.5 },
  ...overrides,
});

const emptyState = (): NoticeState => ({
  schemaVersion: 1,
  queue: [],
  activeNotices: [],
  archivedNotices: [],
  groupingOverrides: [],
  updatedAt: '2026-09-13T10:00:00.000Z',
});

test('el directorio lee y conserva el contrato común del escáner', async () => {
  const root = await makeRoot();
  const file = path.join(root, 'clientes.json');
  await writeFile(file, JSON.stringify({ schema_version: 1, clientes: {
    '12345678Z': { nif: '12345678Z', nombre: 'Ana original', carpeta: 'C:/Ana',
      metadatos: { nombre: { origen: 'escaner', fecha: '2026-01-01' } }, conflictos: {} },
  } }));
  const directory = new ClientDirectory(file);
  assert.equal((await directory.load()).clients['12345678Z'].fields.nombre.value, 'Ana original');
  await directory.mergeVerified({ nif: '12345678Z', fields: {
    nombre: { value: 'Ana alternativa', verified: true },
    iban: { value: 'ES2900811016100006298239', verified: true },
  } }, 'avisos-fiscales');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.schema_version, 1);
  assert.equal(stored.clientes['12345678Z'].carpeta, 'C:/Ana');
  assert.equal(stored.clientes['12345678Z'].nombre, 'Ana original');
  assert.equal(stored.clientes['12345678Z'].metadatos.nombre.origen, 'escaner');
  assert.deepEqual(stored.clientes['12345678Z'].conflictos.nombre, ['Ana original', 'Ana alternativa']);
  assert.equal(stored.clientes['12345678Z'].metadatos.iban.origen, 'avisos-fiscales');
});

test('el directorio migra el formato anterior de avisos sin perder metadatos ni conflictos', async () => {
  const root = await makeRoot();
  const file = path.join(root, 'clientes.json');
  const original = { value: 'Ana', source: 'avisos-antiguo', updatedAt: '2026-01-01' };
  const alternative = { value: 'Otra Ana', source: 'revision', updatedAt: '2026-02-01' };
  await writeFile(file, JSON.stringify({ schemaVersion: 1, clients: {
    '12345678Z': { nif: '12345678Z', fields: { nombre: original }, conflicts: { nombre: [alternative] } },
  } }));
  const directory = new ClientDirectory(file);
  await directory.mergeVerified({ nif: '12345678Z', fields: { carpeta: { value: 'C:/Ana', verified: true } } }, 'avisos-fiscales');
  const reloaded = (await directory.load()).clients['12345678Z'];
  assert.deepEqual(reloaded.fields.nombre, original);
  assert.deepEqual(reloaded.conflicts.nombre, [alternative]);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schema_version, 1);
});

test('solo publica datos verificados en el directorio común', async () => {
  const root = await makeRoot();
  const directory = new ClientDirectory(path.join(root, 'clientes.json'));

  const result = await directory.mergeVerified({
    nif: ' B-12345678 ',
    fields: {
      nombre: { value: 'Cliente Dudoso', verified: false },
      iban: { value: 'ES2900811016100006298239', verified: true },
    },
  }, 'avisos-fiscales');

  assert.equal(result.written, true);
  assert.deepEqual(result.rejectedFields, ['nombre']);
  const stored = JSON.parse(await readFile(path.join(root, 'clientes.json'), 'utf8'));
  assert.equal(stored.clientes.B12345678.nombre, undefined);
  assert.equal(stored.clientes.B12345678.iban, 'ES2900811016100006298239');
  assert.equal(stored.clientes.B12345678.metadatos.iban.origen, 'avisos-fiscales');
});

test('no escribe cuando ningún campo está verificado', async () => {
  const root = await makeRoot();
  const directory = new ClientDirectory(path.join(root, 'clientes.json'));
  const result = await directory.mergeVerified({
    nif: '12345678Z',
    fields: { nombre: { value: 'Sin validar', verified: false } },
  }, 'avisos-fiscales');

  assert.equal(result.written, false);
  assert.deepEqual(result.rejectedFields, ['nombre']);
  await assert.rejects(readFile(path.join(root, 'clientes.json'), 'utf8'), /ENOENT/);
});

test('la escritura de almacenamiento es atómica y deja un JSON completo', async () => {
  const root = await makeRoot();
  const repository = new NoticeRepository(root);
  const state = emptyState();
  state.queue.push({ id: 'capture-1', fileId: 'image-1', status: 'pending', attempts: 0 });

  await repository.saveQueue(state);

  assert.deepEqual(await repository.loadQueue(), state);
  assert.deepEqual((await readdir(root)).sort(), ['notices.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'notices.json'), 'utf8')), state);
});

test('las escrituras simultáneas no comparten el mismo archivo temporal', async () => {
  const root = await makeRoot();
  const repository = new NoticeRepository(root);
  const states = Array.from({ length: 16 }, (_, index) => ({
    ...emptyState(),
    activeNotices: [{ index }],
    updatedAt: `2026-09-13T10:00:${String(index).padStart(2, '0')}.000Z`,
  }));

  await Promise.all(states.map((state) => repository.saveQueue(state)));

  const stored = await repository.loadQueue();
  assert.ok(states.some((state) => JSON.stringify(state) === JSON.stringify(stored)));
  assert.deepEqual((await readdir(root)).sort(), ['notices.json']);
});

test('archivar es idempotente y conserva la captura y el snapshot', async () => {
  const root = await makeRoot();
  const repository = new NoticeRepository(root);
  await repository.saveQueue(emptyState());

  await repository.archive(notice());
  await repository.archive(notice({ archivedAt: '2026-09-13T12:00:00.000Z' }));

  const stored = await repository.loadQueue();
  assert.equal(stored.archivedNotices.length, 1);
  assert.equal(stored.archivedNotices[0].archivedAt, '2026-09-13T10:00:00.000Z');
  assert.deepEqual(stored.archivedNotices[0].snapshot, { total_importe: 120.5 });
});

test('la búsqueda de almacenamiento normaliza nombre y filtra modelo periodo y fecha', async () => {
  const root = await makeRoot();
  const repository = new NoticeRepository(root);
  const state = emptyState();
  state.archivedNotices = [
    notice(),
    notice({
      id: 'joint-2',
      archivedAt: '2026-08-01T10:00:00.000Z',
      cliente_nombre: 'Otra Empresa',
      cliente_nif: 'B87654321',
      models: ['130'],
      periods: ['1T'],
    }),
  ];
  await repository.saveQueue(state);

  assert.deepEqual((await repository.search({ query: 'jose perez' })).map((item) => item.id), ['joint-1']);
  assert.deepEqual((await repository.search({ model: '303', period: '2t' })).map((item) => item.id), ['joint-1']);
  assert.deepEqual((await repository.search({ from: '2026-09-01', to: '2026-09-30' })).map((item) => item.id), ['joint-1']);
});

test('exportar e importar copia de seguridad restaura avisos clientes y capturas', async () => {
  const sourceRoot = await makeRoot();
  const source = new NoticeRepository(path.join(sourceRoot, 'avisos'), path.join(sourceRoot, 'clientes.json'));
  const state = emptyState();
  state.archivedNotices = [notice({ captureIds: ['capture-1'] })];
  await source.saveQueue(state);
  await source.writeCapture('capture-1', Buffer.from('imagen-original'));
  const directory = new ClientDirectory(path.join(sourceRoot, 'clientes.json'));
  await directory.mergeVerified({
    nif: '12345678Z',
    fields: { nombre: { value: 'José Pérez', verified: true } },
  }, 'avisos-fiscales');

  const backup = await source.exportBackup();
  const destinationRoot = await makeRoot();
  const destination = new NoticeRepository(path.join(destinationRoot, 'avisos'), path.join(destinationRoot, 'clientes.json'));
  await destination.importBackup(backup);

  assert.deepEqual(await destination.loadQueue(), state);
  assert.equal(await readFile(path.join(destinationRoot, 'avisos', 'capturas', 'capture-1.png'), 'utf8'), 'imagen-original');
  assert.match(await readFile(path.join(destinationRoot, 'clientes.json'), 'utf8'), /José Pérez/);
});

test('la API de almacenamiento guarda archiva busca y restaura copias', async () => {
  const root = await makeRoot();
  const repository = new NoticeRepository(root, path.join(root, 'clientes.json'));
  const directory = new ClientDirectory(path.join(root, 'clientes.json'));
  const application = express();
  application.use(express.json({ limit: '20mb' }));
  application.use(createStorageRouter(repository, directory));
  const server = application.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const persisted = emptyState();
    persisted.activeNotices = [{
      cliente_nif: '12345678Z', cliente_nombre: 'José Pérez', iban: 'ES2900811016100006298239',
      verificacion: { estado: 'ok', checks: [], discrepanciasIA: [], segundaLecturaHecha: true },
    }];
    const saved = await fetch(`${base}/api/notices/state`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(persisted),
    });
    assert.equal(saved.status, 204);
    assert.equal((await (await fetch(`${base}/api/notices/state`)).json()).schemaVersion, 1);
    assert.match(await readFile(path.join(root, 'clientes.json'), 'utf8'), /José Pérez/);

    assert.equal((await fetch(`${base}/api/notices/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice()),
    })).status, 200);
    const matches = await (await fetch(`${base}/api/notices/search?query=jose&model=303`)).json();
    assert.deepEqual(matches.map((item: ArchivedNotice) => item.id), ['joint-1']);

    const backup = await (await fetch(`${base}/api/backup/export`)).json();
    assert.equal(backup.manifest.schemaVersion, 1);
    assert.equal((await fetch(`${base}/api/backup/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(backup),
    })).status, 204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('la limpieza conserva capturas referenciadas por bandeja activos e historial', async () => {
  const root = await makeRoot();
  const repository = new NoticeRepository(root);
  const state = emptyState();
  state.queue = [{ id: 'queue', fileId: 'queued', status: 'pending', attempts: 0 }];
  state.activeNotices = [{ screenshotId: 'active' }];
  state.archivedNotices = [notice({ captureIds: ['archived'] })];
  await repository.saveQueue(state);
  const captureDirectory = path.join(root, 'capturas');
  await mkdir(captureDirectory, { recursive: true });
  for (const id of ['queued', 'active', 'archived', 'orphan']) {
    const file = path.join(captureDirectory, `${id}.png`);
    await writeFile(file, id);
    await utimes(file, new Date(0), new Date(0));
  }

  assert.deepEqual(await repository.cleanupOrphanedCaptures(1, Date.now()), ['orphan']);
  assert.deepEqual((await readdir(captureDirectory)).sort(), ['active.png', 'archived.png', 'queued.png']);
});
