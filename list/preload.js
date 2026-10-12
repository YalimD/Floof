const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floofList', {
  get: () => ipcRenderer.invoke('list:get'),
  onUpdate: (cb) => ipcRenderer.on('list:update', (_e, data) => cb(data)),
  find: (id) => ipcRenderer.invoke('list:find', id),
  answer: (id, text) => ipcRenderer.invoke('list:answer', { id, text }),
  clear: () => ipcRenderer.invoke('list:clear'),
  forget: (id, ended) => ipcRenderer.invoke('list:forget', { id, ended }),
  remove: (id) => ipcRenderer.invoke('list:remove', id),
  removeCritters: () => ipcRenderer.invoke('list:remove-critters'),
  goTo: (id) => ipcRenderer.invoke('list:go-to', id),
  setBadge: (id, badge) => ipcRenderer.invoke('list:badge', { id, badge }),
  control: (id, kind, text) => ipcRenderer.invoke('list:control', { id, kind, text }),
});
