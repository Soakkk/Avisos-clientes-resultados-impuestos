import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canInstallUpdate,
  initialUpdateStatus,
  updateStatusReducer,
} from '../src/update-status';

test('el actualizador recorre comprobación descarga y listo sin instalar', () => {
  let state = initialUpdateStatus;
  state = updateStatusReducer(state, { type: 'check' });
  assert.equal(state.status, 'checking');
  state = updateStatusReducer(state, { type: 'available', version: '1.5.0' });
  assert.deepEqual(state, { status: 'downloading', version: '1.5.0', percent: 0, workspaceSaved: false });
  state = updateStatusReducer(state, { type: 'progress', percent: 72.4 });
  assert.equal(state.percent, 72.4);
  state = updateStatusReducer(state, { type: 'downloaded', version: '1.5.0' });
  assert.equal(state.status, 'ready');
  assert.equal(canInstallUpdate(state), false);
});

test('ready no permite instalar hasta confirmar la persistencia del estado', () => {
  const ready = updateStatusReducer(initialUpdateStatus, { type: 'downloaded', version: '1.5.0' });
  const requested = updateStatusReducer(ready, { type: 'install-requested' });
  assert.equal(requested.status, 'ready');
  assert.equal(canInstallUpdate(requested), false);

  const saved = updateStatusReducer(requested, { type: 'workspace-saved' });
  assert.equal(canInstallUpdate(saved), true);
  assert.equal(updateStatusReducer(saved, { type: 'install' }).status, 'installing');
});

test('un error de persistencia mantiene la actualización lista y recuperable', () => {
  const ready = updateStatusReducer(initialUpdateStatus, { type: 'downloaded', version: '1.5.0' });
  const failed = updateStatusReducer(ready, { type: 'workspace-save-failed', message: 'Disco lleno' });
  assert.deepEqual(failed, {
    status: 'error', version: '1.5.0', message: 'Disco lleno', recoverable: true, workspaceSaved: false,
  });
  assert.equal(canInstallUpdate(failed), false);
});
