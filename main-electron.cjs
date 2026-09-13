const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let expressAppProcess;
let updateTimer;
let updateReady = false;
let pendingStateSave = null;

// Function to check if the local server is up and running
function checkServerReady(url, callback) {
  http.get(url, (res) => {
    if (res.statusCode === 200) {
      callback(true);
    } else {
      callback(false);
    }
  }).on('error', () => {
    callback(false);
  });
}

function startExpressServer() {
  // Only start the bundled server when running as a packaged .exe.
  // In "npm run electron:dev" the server is already running separately
  // via "npm run dev" (tsx server.ts) on the same port, so requiring the
  // bundled file here would just fail trying to bind an already-used port.
  if (!app.isPackaged) {
    console.log('Modo desarrollo: usando el servidor de "npm run dev" ya iniciado.');
    return;
  }

  try {
    process.env.NODE_ENV = 'production';
    process.env.APP_VERSION = app.getVersion();
    require('./dist/server.cjs');
    console.log('Servidor Express local iniciado correctamente desde Electron.');
  } catch (err) {
    console.error('Error al iniciar el servidor Express interno:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    title: 'Generador de Avisos Fiscales',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0B3159',
      symbolColor: '#FFFFFF',
      height: 44,
    },
    icon: path.join(__dirname, 'assets', 'app.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Los enlaces externos (p. ej. "crear API key en Google AI Studio") deben
  // abrirse en el navegador del sistema. Sin esto, target="_blank" abría una
  // ventana Electron vacía y el usuario no llegaba nunca a la página.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      // Las capturas guardadas se sirven desde el propio servidor local:
      // esas sí se abren en una ventana de la app.
      if (!url.startsWith('http://localhost:3000')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  const localServerUrl = 'http://localhost:3000';

  // Poll local server until it responds, then load the window URL
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    checkServerReady(localServerUrl + '/api/health', (ready) => {
      if (ready) {
        clearInterval(interval);
        mainWindow.loadURL(localServerUrl);
      } else if (attempts > 15) {
        // Fallback if server takes too long to respond
        clearInterval(interval);
        mainWindow.loadURL(localServerUrl);
      }
    });
  }, 300);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- Actualizaciones automáticas vía GitHub Releases ----
// Descarga silenciosa, estado visible en la interfaz e instalación solo cuando
// el workspace ya ha confirmado su persistencia (o al cerrar normalmente).
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.allowDowngrade = false;

function sendUpdateStatus(state) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', state);
}

function comprobarActualizaciones() {
  if (!app.isPackaged) return Promise.resolve(false);

  sendUpdateStatus({ status: 'checking', workspaceSaved: false });
  return autoUpdater.checkForUpdates().then(() => true).catch((error) => {
    sendUpdateStatus({ status: 'error', message: String(error?.message || error), recoverable: true, workspaceSaved: false });
    return false;
  });
}

autoUpdater.on('update-available', (info) => {
  sendUpdateStatus({ status: 'downloading', version: info.version, percent: 0, workspaceSaved: false });
});

autoUpdater.on('update-not-available', (info) => {
  sendUpdateStatus({ status: 'checking', version: info.version, message: 'Aplicación actualizada', workspaceSaved: false });
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) mainWindow.setProgressBar(progress.percent / 100);
  sendUpdateStatus({ status: 'downloading', percent: progress.percent, workspaceSaved: false });
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) mainWindow.setProgressBar(-1);
  updateReady = true;
  sendUpdateStatus({ status: 'ready', version: info.version, workspaceSaved: false });
});

autoUpdater.on('error', (error) => {
  if (mainWindow) mainWindow.setProgressBar(-1);
  sendUpdateStatus({ status: 'error', message: String(error?.message || error), recoverable: true, workspaceSaved: false });
});

ipcMain.handle('check-for-updates', () => comprobarActualizaciones());

ipcMain.on('state-saved', (event, result) => {
  if (!pendingStateSave || pendingStateSave.sender !== event.sender) return;
  const pending = pendingStateSave;
  pendingStateSave = null;
  clearTimeout(pending.timer);
  if (result?.success) pending.resolve(true);
  else pending.reject(new Error(result?.message || 'No se pudo guardar el estado.'));
});

ipcMain.handle('restart-and-install', async (event) => {
  if (!updateReady) return false;
  const saved = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingStateSave = null;
      reject(new Error('La aplicación no confirmó el guardado a tiempo.'));
    }, 15_000);
    pendingStateSave = { sender: event.sender, resolve, reject, timer };
    event.sender.send('save-state-before-update');
  });
  if (!saved) return false;
  sendUpdateStatus({ status: 'installing', workspaceSaved: true });
  autoUpdater.quitAndInstall(false, true);
  return true;
});

// Start local Express server first, then boot the Electron window
app.whenReady().then(() => {
  // Start server
  startExpressServer();

  // Create Electron Window
  createWindow();
  // Esperar a que la ventana esté lista evita que el diálogo de actualización
  // aparezca antes que la propia aplicación. Después se vuelve a comprobar de
  // forma silenciosa cada seis horas mientras permanezca abierta.
  setTimeout(comprobarActualizaciones, 5000);
  updateTimer = setInterval(comprobarActualizaciones, 6 * 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (updateTimer) clearInterval(updateTimer);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
