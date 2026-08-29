'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokeLauncherHud', {
  openXpPanel: () => ipcRenderer.send('openXpPanel'),
});
