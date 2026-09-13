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
    setInterval: () => 1, setTimeout: () => 1, clearInterval() {}, clearTimeout() {},
  });
  return { appEvents, windowEvents, ipc, updateEvents, webContents, sent, quits: () => quits, installs: () => installs };
}

test('cerrar Windows espera confirmación de persistencia antes de salir', async () => {
  const app = launch();
  let prevented = false;
  app.windowEvents.close?.({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.quits(), 0);
  assert.equal(app.sent[0]?.[0], 'save-state-before-update');
  app.ipc['state-saved']({ sender: app.webContents }, { success: true });
  await new Promise(setImmediate);
  assert.equal(app.quits(), 1);
});

test('un fallo de guardado impide cerrar o instalar y permite volver a intentarlo', async () => {
  const app = launch();
  app.updateEvents['update-downloaded']({ version: '2.0' });
  const restart = app.ipc['restart-and-install']({ sender: app.webContents });
  app.ipc['state-saved']({ sender: app.webContents }, { success: false, message: 'ENOSPC' });
  await restart;
  assert.equal(app.installs(), 0);
  assert.equal(app.quits(), 0);
  assert.equal(app.sent.at(-1)[1].status, 'error');
});
