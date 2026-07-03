const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;
let expressAppProcess;

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
  try {
    // In production, we run the bundled commonjs file from dist/server.cjs
    // Set environment variable to production so Express knows to serve static built files
    process.env.NODE_ENV = 'production';
    
    // Require the bundled server. This will start the Express app on port 3000
    require('./dist/server.cjs');
    console.log('Servidor Express local iniciado correctamente desde Electron.');
  } catch (err) {
    console.error('Error al iniciar el servidor Express interno:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Generador de Avisos de Impuestos',
    icon: path.join(__dirname, 'dist', 'favicon.ico'), // Optional icon
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
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

// Start local Express server first, then boot the Electron window
app.whenReady().then(() => {
  // Start server
  startExpressServer();
  
  // Create Electron Window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
