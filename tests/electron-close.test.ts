import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
function launch() {
  const appEvents: Record<string, Function> = {};
  const ipc: Record<string, Function> = {};
  const updateEvents: Record<string, Function> = {};
  const windowEvents: Record<string, Function> = {};
  const sent: any[] = [];
  const timers: { callback: Function; delay: number }[] = [];
  let quits = 0;
  let installs = 0;
  const webContents = { setWindowOpenHandler() {}, send: (...args: any[]) => sent.push(args) };
  class Window {
    webContents = webContents;
    on(event: string, callback: Function) { windowEvents[event] = callback; }
    isDestroyed() { return false; }
    setProgressBar() {}
    static getAllWindows() { return []; }
  }
  const app = { isPackaged: false, whenReady: () => ({ then: (fn: Function) => fn() }), on: (event: string, fn: Function) => { appEvents[event] = fn; }, quit: () => { quits++; } };
  const autoUpdater = { on: (event: string, fn: Function) => { updateEvents[event] = fn; }, quitAndInstall: () => { installs++; } };
  runInNewContext(readFileSync(new URL('../main-electron.cjs', import.meta.url), 'utf8'), {
    require: (name: string) => name === 'electron' ? { app, BrowserWindow: Window, ipcMain: { handle: (event: string, fn: Function) => { ipc[event] = fn; }, on: (event: string, fn: Function) => { ipc[event] = fn; } }, shell: {} } : name === 'electron-updater' ? { autoUpdater } : require(name),
    __dirname: process.cwd(), process: { platform: 'win32', env: {} }, console: { log() {} },
    setInterval: () => 1, setTimeout: (callback: Function, delay: number) => { timers.push({ callback, delay }); return timers.length; }, clearInterval() {}, clearTimeout() {},
  });
  return { appEvents, windowEvents, ipc, updateEvents, webContents, sent, timers, quits: () => quits, installs: () => installs };
}

test('cerrar Windows espera confirmación de persistencia antes de salir', async () => {
  const app = launch();
  let prevented = false;
  app.windowEvents.close?.({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.quits(), 0);
  assert.equal(app.sent[0]?.[0], 'save-state-before-update');
  app.ipc['state-saved']({ sender: app.webContents }, { success: true, requestId: app.sent[0]?.[1]?.requestId });
  await new Promise(setImmediate);
  assert.equal(app.quits(), 1);
});

test('un fallo de guardado impide cerrar o instalar y permite volver a intentarlo', async () => {
  const app = launch();
  app.updateEvents['update-downloaded']({ version: '2.0' });
  const restart = app.ipc['restart-and-install']({ sender: app.webContents });
  app.ipc['state-saved']({ sender: app.webContents }, { success: false, message: 'ENOSPC', requestId: app.sent.find(item => item[0] === 'save-state-before-update')?.[1]?.requestId });
  await restart;
  assert.equal(app.installs(), 0);
  assert.equal(app.quits(), 0);
  assert.equal(app.sent.at(-1)[1].status, 'error');
});

for (const install of [false, true]) {
  test(`una respuesta tardía no confirma el reintento de ${install ? 'actualización' : 'cierre'}`, async () => {
    const app = launch();
    if (install) app.updateEvents['update-downloaded']({ version: '2.0' });
    app.windowEvents.close({ preventDefault() {} });
    const firstId = app.sent.find(item => item[0] === 'save-state-before-update')?.[1]?.requestId;
    app.timers.find(timer => timer.delay === 15_000)!.callback();
    await new Promise(setImmediate);
    app.windowEvents.close({ preventDefault() {} });
    const requests = app.sent.filter(item => item[0] === 'save-state-before-update');
    const secondId = requests.at(-1)?.[1]?.requestId;
    app.ipc['state-saved']({ sender: app.webContents }, { requestId: firstId, success: true });
    await new Promise(setImmediate);
    assert.equal(app.quits() + app.installs(), 0, 'el segundo guardado sigue pendiente');
    assert.equal(requests.length, 2);
    assert.notEqual(firstId, secondId);
    app.ipc['state-saved']({ sender: app.webContents }, { requestId: secondId, success: true });
    await new Promise(setImmediate);
    assert.equal(app.quits(), install ? 0 : 1);
    assert.equal(app.installs(), install ? 1 : 0);
  });
}

test('el preload conserva el identificador en la solicitud y en su confirmación', () => {
  let api: any;
  const listeners: Record<string, Function> = {};
  const sent: any[] = [];
  runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } },
      ipcRenderer: { on: (name: string, fn: Function) => { listeners[name] = fn; }, removeListener() {}, send: (...args: unknown[]) => sent.push(args) }}),
  });
  let received: unknown;
  api.onSaveRequested((id: string) => { received = id; });
  listeners['save-state-before-update']({}, { requestId: 'close-42' });
  assert.equal(received, 'close-42');
  api.stateSaved(received, true);
  assert.equal(sent[0][1].requestId, 'close-42');
  assert.equal(sent[0][1].success, true);
});
