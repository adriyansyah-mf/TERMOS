import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PreloadBridge, TermosEvents } from '../shared/api'

const bridge: PreloadBridge = {
  invoke: (method, ...args) => ipcRenderer.invoke(`termos:${method}`, ...args),
  write: (id, data) => ipcRenderer.send('termos:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('termos:resize', id, cols, rows),
  on: <K extends keyof TermosEvents>(channel: K, fn: (payload: TermosEvents[K]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: TermosEvents[K]): void => fn(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('termos', bridge)
