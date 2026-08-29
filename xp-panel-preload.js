'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xpPanel', {
  getData: () => ipcRenderer.invoke('getXpPanelData'),
  close: () => ipcRenderer.send('closeXpPanel'),
  move: (dx, dy) => ipcRenderer.send('moveXpPanel', dx, dy),
  resize: (dw, dh) => ipcRenderer.send('resizeXpPanel', dw, dh),
  reset: () => ipcRenderer.send('resetXpPanel'),
  openPokeData: (slot) => ipcRenderer.send('openXpPokeData', slot),
  onData: (cb) => {
    const handler = (_event, payload) => { try { cb(payload); } catch {} };
    ipcRenderer.on('xp-panel-data', handler);
    return () => ipcRenderer.removeListener('xp-panel-data', handler);
  },
});
