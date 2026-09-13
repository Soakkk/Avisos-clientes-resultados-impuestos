const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updates', {
  check: () => ipcRenderer.invoke('check-for-updates'),
  restart: () => ipcRenderer.invoke('restart-and-install'),
  stateSaved: (requestId, success, message) => ipcRenderer.send('state-saved', { requestId, success, message }),
  onStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  onSaveRequested: (callback) => {
    const listener = (_event, request) => callback(request.requestId);
    ipcRenderer.on('save-state-before-update', listener);
    return () => ipcRenderer.removeListener('save-state-before-update', listener);
  },
});
