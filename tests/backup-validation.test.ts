import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NoticeRepository } from '../src/storage/noticeRepository';

const tax = () => ({ id: 'tax-1', modelo: '303', modelo_nombre: 'IVA', periodo: '2T', ejercicio: '2026', cliente_nif: '12345678Z', cliente_nombre: 'Ana', importe: 1, tipo_resultado: 'A ingresar', fechaCargo: '', fechaLimiteDomiciliacion: '', timestamp: 1 });
const validBackup = (): any => ({
  manifest: { product: 'avisos-fiscales', schemaVersion: 1, exportedAt: '' },
  state: { schemaVersion: 1, queue: [{ id: 'q', fileId: 'new', status: 'pending', attempts: 0 }], activeNotices: [tax()], archivedNotices: [], groupingOverrides: [], updatedAt: '' },
  clients: { schema_version: 1, clientes: { '12345678Z': { nif: '12345678Z', nombre: 'Ana', metadatos: { nombre: { origen: 'escaner', fecha: '' } }, conflictos: { nombre: ['Otra Ana'] } } } },
  captures: { new: Buffer.from('captura válida').toString('base64') },
});

const malformed: [string, (backup: any) => void][] = [
  ['manifest', b => { b.manifest.exportedAt = 4; }],
  ['state', b => { b.state = { schemaVersion: 1, queue: 'broken' }; }],
  ['queue container', b => { b.state.queue = {}; }],
  ['queue item', b => { b.state.queue = [null]; }],
  ['queue status', b => { b.state.queue[0].status = 'done'; }],
  ['queue attempts', b => { b.state.queue[0].attempts = -1; }],
  ['queue metadata', b => { b.state.queue[0].jointId = {}; }],
  ['active container', b => { b.state.activeNotices = null; }],
  ['active incomplete', b => { b.state.activeNotices = [{ id: 'bad' }]; }],
  ['active field', b => { b.state.activeNotices[0].importe = '100'; }],
  ['active optional field', b => { b.state.activeNotices[0].mostrarNotaAsesoria = 'yes'; }],
  ['verification', b => { b.state.activeNotices[0].verificacion = { estado: 'ok', checks: 'bad', discrepanciasIA: [], segundaLecturaHecha: true }; }],
  ['archived container', b => { b.state.archivedNotices = {}; }],
  ['archive snapshot', b => { b.state.archivedNotices = [{ id: 'a', archivedAt: '', cliente_nombre: 'Ana', cliente_nif: '12345678Z', models: ['303'], periods: ['2T'], noticeIds: ['tax-1'], snapshot: {} }]; }],
  ['grouping', b => { b.state.groupingOverrides = [{ id: 'g', kind: 'merge', noticeIds: 'bad', groupId: 'x', createdAt: '' }]; }],
  ['group assignments', b => { b.state.groupingOverrides = [{ id: 'g', kind: 'split', noticeIds: [], groupId: 'x', createdAt: '', assignments: { x: 3 } }]; }],
  ['selection', b => { b.state.selectedJointId = []; }],
  ['draft', b => { b.state.draft = { jointId: 'x', clientName: 'Ana', clientNif: '12345678Z', taxes: [null] }; }],
  ['updatedAt', b => { b.state.updatedAt = null; }],
  ['clients container', b => { b.clients = []; }],
  ['canonical client', b => { b.clients.clientes['12345678Z'] = null; }],
  ['canonical name', b => { b.clients.clientes['12345678Z'].nombre = 42; }],
  ['canonical metadata', b => { b.clients.clientes['12345678Z'].metadatos.nombre.fecha = []; }],
  ['canonical conflicts', b => { b.clients.clientes['12345678Z'].conflictos.nombre = [42]; }],
  ['canonical conflict metadata', b => { b.clients.clientes['12345678Z'].conflictos_metadatos = { nombre: { Ana: null } }; }],
  ['duplicate normalized nif', b => { b.clients.clientes['12345678-Z'] = { nombre: 'Otro cliente' }; }],
  ['internal client', b => { b.clients = { schemaVersion: 1, clients: { A: { nif: 'A', fields: { nombre: { value: 1, source: '', updatedAt: '' } }, conflicts: {} } }, updatedAt: '' }; }],
  ['internal conflicts', b => { b.clients = { schemaVersion: 1, clients: { A: { nif: 'A', fields: {}, conflicts: { nombre: [null] } } }, updatedAt: '' }; }],
  ['captures missing', b => { delete b.captures; }],
  ['captures array', b => { b.captures = []; }],
  ['late invalid capture id', b => { b.captures['../bad'] = 'YQ=='; }],
  ['late invalid capture content', b => { b.captures.bad = '%%%'; }],
  ['empty capture', b => { b.captures.bad = ''; }],
  ['noncanonical base64', b => { b.captures.bad = 'YR=='; }],
  ['missing referenced capture', b => { b.state.activeNotices[0].screenshotId = 'absent'; }],
  ['capture reference type', b => { b.state.activeNotices[0].screenshotId = {}; }],
];

for (const [label, mutate] of malformed) {
  test(`import rechaza ${label} antes de staging y conserva todos los bytes`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'avisos-invalid-backup-'));
    const clientsFile = path.join(root, 'clientes.json');
    const repo = new NoticeRepository(root, clientsFile);
    const before = validBackup().state;
    await repo.saveQueue(before);
    await repo.writeCapture('original', Buffer.from('original irremplazable'));
    await writeFile(clientsFile, JSON.stringify({ schema_version: 1, clientes: { A: { nombre: 'Anterior' } } }));
    const stateBytes = await readFile(path.join(root, 'notices.json'));
    const clientBytes = await readFile(clientsFile);
    const backup = validBackup();
    mutate(backup);
    let stages = 0;
    const writeCapture = repo.writeCapture.bind(repo);
    repo.writeCapture = async (...args) => { stages++; return writeCapture(...args); };
    await assert.rejects(repo.importBackup(backup), /incompatible|captura/i);
    assert.equal(stages, 0, 'no se prepara ninguna captura antes de validar toda la copia');
    assert.deepEqual(await readFile(path.join(root, 'notices.json')), stateBytes);
    assert.deepEqual(await readFile(clientsFile), clientBytes);
    assert.deepEqual(await readdir(path.join(root, 'capturas')), ['original.png']);
    assert.equal(await readFile(path.join(root, 'capturas/original.png'), 'utf8'), 'original irremplazable');
    assert.ok(!(await readdir(root)).includes('pending-import.json'));
  });
}

test('import acepta ambos directorios completos y conserva metadatos compartidos desconocidos', async () => {
  for (const internal of [false, true]) {
    const root = await mkdtemp(path.join(tmpdir(), 'avisos-valid-backup-'));
    const repo = new NoticeRepository(root, path.join(root, 'clientes.json'));
    const backup = validBackup();
    if (internal) backup.clients = { schemaVersion: 1, updatedAt: '', clients: { '12345678Z': { nif: '12345678Z', fields: { nombre: { value: 'Ana', source: 'escaner', updatedAt: '' } }, conflicts: { nombre: [{ value: 'Otra Ana', source: 'avisos', updatedAt: '' }] }, shared: { extra: { conservar: true } } } }, shared: { extraRaiz: ['conservar'] } };
    else { backup.clients.extraRaiz = ['conservar']; backup.clients.clientes['12345678Z'].extra = { conservar: true }; }
    await repo.importBackup(backup);
    assert.deepEqual(await repo.loadQueue(), backup.state);
    const clients = JSON.parse(await readFile(path.join(root, 'clientes.json'), 'utf8'));
    assert.deepEqual(clients.extraRaiz, ['conservar']);
    assert.deepEqual(clients.clientes['12345678Z'].extra, { conservar: true });
    assert.deepEqual(clients.clientes['12345678Z'].conflictos.nombre, ['Otra Ana']);
  }
});

test('import restaura un workspace completo sin normalizar importes textos ni referencias', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'avisos-full-backup-'));
  const repo = new NoticeRepository(root, path.join(root, 'clientes.json'));
  const backup = validBackup();
  const fullTax = { ...tax(), tipo_resultado: 'Domiciliaci?n', importe: -12.345,
    screenshotId: 'new', notaAsesoria: 'Texto exacto\ncon saltos', mostrarNotaAsesoria: true,
    verificacion: { estado: 'revisar', checks: [{ field: 'importe', status: 'warn', message: 'Revisar importe' }], discrepanciasIA: [{ campo: 'importe', primera: '1', segunda: '2' }], segundaLecturaHecha: true } };
  backup.state.activeNotices = [fullTax];
  backup.state.queue[0] = { ...backup.state.queue[0], status: 'review', attempts: 2, error: 'Texto exacto', createdAt: '', jointId: 'joint' };
  backup.state.archivedNotices = [{ id: 'archive', archivedAt: '', cliente_nombre: 'Ana', cliente_nif: '12345678Z', models: ['303'], periods: ['2T'], noticeIds: ['tax-1'], captureIds: ['new'],
    snapshot: { id: 'joint', cliente_nombre: 'Ana', cliente_nif: '12345678Z', notices: [fullTax], total_importe: -12.345, todosDomiciliados: false } }];
  backup.state.groupingOverrides = [{ id: 'g', kind: 'split', noticeIds: ['tax-1'], groupId: 'joint', assignments: { 'tax-1': 'joint' }, createdAt: '' }];
  backup.state.selectedJointId = 'joint';
  backup.state.draft = { jointId: 'joint', clientName: 'Edición sin guardar', clientNif: '12345678Z', taxes: [fullTax] };
  const original = structuredClone(backup);
  await repo.importBackup(backup);
  assert.deepEqual(await repo.loadQueue(), original.state);
  assert.deepEqual(backup, original, 'la validación no muta la copia recibida');
  assert.equal((await readFile(path.join(root, 'capturas/new.png'))).toString('base64'), original.captures.new);
});
