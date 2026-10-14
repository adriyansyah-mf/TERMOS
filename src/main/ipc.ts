import { BrowserWindow, app, dialog, ipcMain, powerMonitor, shell } from 'electron'
import type { TermosApi, TermosEvents } from '../shared/api'
import type { ProxmoxServer, SshKey } from '../shared/types'
import { forwards } from './forwards'
import { generateKey, importKeyFile, keyFingerprint, keyFromPrivate } from './keys'
import { forgetTicket, probeCertificate, proxmoxClient } from './proxmox'
import { listSerialPorts, openSession } from './sessions/backends'
import { sessions } from './sessions/manager'
import { sftpManager } from './sftp'
import { importSshConfig } from './sshconfig'
import { sharing } from './sharing'
import { sync } from './sync'
import { vault } from './vault'
import { getLanguage, tr } from './i18n'
import { loadLanguage, persistLanguage } from './prefs'

const S = {
  id: {
    pickKey: 'Pilih private key',
    saveDir: 'Simpan ke folder',
    pickUpload: 'Pilih file untuk diunggah',
    pveNotFound: 'Server Proxmox tidak ditemukan'
  },
  en: {
    pickKey: 'Select a private key',
    saveDir: 'Save to folder',
    pickUpload: 'Select files to upload',
    pveNotFound: 'Proxmox server not found'
  }
}

let win: BrowserWindow | null = null

function emit<K extends keyof TermosEvents>(channel: K, payload?: TermosEvents[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function pve(serverId: string): ReturnType<typeof proxmoxClient> {
  const s = vault.find<ProxmoxServer>('proxmox', serverId)
  if (!s) throw new Error(tr(S).pveNotFound)
  return proxmoxClient(s)
}

// void-returning calls may resolve to anything; the renderer ignores the value.
type Result<R> = [R] extends [void] ? unknown : R
type Handlers = {
  [K in keyof TermosApi]: (
    ...args: Parameters<TermosApi[K]>
  ) => Result<ReturnType<TermosApi[K]>> | Promise<Result<ReturnType<TermosApi[K]>>>
}

const handlers: Handlers = {
  vaultStatus: () => {
    loadLanguage()
    return {
      exists: vault.exists(),
      unlocked: vault.isUnlocked(),
      quickUnlock: vault.quickUnlockAvailable(),
      language: getLanguage()
    }
  },
  vaultCreate: (pw) => vault.create(pw),
  vaultUnlock: async (pw) => {
    await vault.unlock(pw)
    sync.start()
  },
  vaultQuickUnlock: () => {
    vault.quickUnlock()
    sync.start()
  },
  vaultLock: () => lockNow(),
  vaultChangePassword: (a, b) => vault.changePassword(a, b),
  vaultSetQuickUnlock: (on) => vault.setQuickUnlock(on),
  vaultSnapshot: () => vault.snapshot(),
  upsert: (c, e) => {
    if (c === 'proxmox') forgetTicket(e.id)
    return vault.upsert(c, e)
  },
  remove: (c, id) => vault.remove(c, id),
  updateSettings: (patch) => {
    const out = vault.updateSettings(patch)
    if (patch.language) persistLanguage(patch.language)
    return out
  },

  syncStatus: () => sync.status(),
  syncServerInfo: (url) => sync.serverInfo(url),
  syncRegister: (url, user, pw, invite) => sync.register(url, user, pw, invite),
  syncLogin: (url, user, pw) => sync.login(url, user, pw),
  syncLogout: () => sync.logout(),
  syncNow: () => sync.syncNow(),
  syncChangePassword: (a, b) => sync.changePassword(a, b),
  syncDevices: () => sync.devices(),
  syncRevokeDevice: (id) => sync.revokeDevice(id),
  teamCreate: (name) => sync.createTeam(name),
  teamMembers: (id) => sync.members(id),
  teamPreviewMember: (user) => sync.previewMember(user),
  teamAddMember: (id, user, fp) => sync.addMember(id, user, fp),
  teamRemoveMember: (id, userId) => sync.removeMember(id, userId),
  teamDelete: (id) => sync.deleteTeam(id),

  shareStart: (id, allow) => sharing.start(id, allow),
  shareStop: (id) => sharing.stop(id),
  shareSetInput: (id, allow) => sharing.setAllowInput(id, allow),
  shareKick: (id, viewer) => sharing.kick(id, viewer),
  shareList: () => sharing.list(),

  sessionOpen: (req) => openSession(req),
  sessionClose: (id) => sessions.close(id),
  sessionAnswer: (rid, v) => sessions.answer(rid, v),
  serialPorts: () => listSerialPorts(),

  keyGenerate: (label, kind, pass) => vault.upsert<SshKey>('keys', generateKey(label, kind, pass)),
  keyImportFile: () =>
    dialog
      .showOpenDialog(win!, {
        title: tr(S).pickKey,
        defaultPath: `${app.getPath('home')}/.ssh`,
        properties: ['openFile', 'showHiddenFiles']
      })
      .then((r) => {
        if (r.canceled || !r.filePaths[0]) return null
        return vault.upsert<SshKey>('keys', importKeyFile(r.filePaths[0]))
      }),
  keyImportText: (label, priv, pass, cert) =>
    vault.upsert<SshKey>('keys', keyFromPrivate(label, priv, pass, cert)),
  keyFingerprint: (id) => {
    const k = vault.find<SshKey>('keys', id)
    return k ? keyFingerprint(k) : ''
  },
  importSshConfig: () => importSshConfig(),

  forwardStatus: () => forwards.status(),
  forwardStart: (id) => forwards.start(id),
  forwardStop: (id) => forwards.stop(id),

  sftpConnect: (hostId) => sftpManager.connect(hostId),
  sftpClose: (id) => sftpManager.close(id),
  sftpList: (id, dir) => sftpManager.list(id, dir),
  sftpRealpath: (id, p) => sftpManager.realpath(id, p),
  sftpMkdir: (id, p) => sftpManager.mkdir(id, p),
  sftpRename: (id, a, b) => sftpManager.rename(id, a, b),
  sftpRemove: (id, p, d) => sftpManager.remove(id, p, d),
  sftpChmod: (id, p, m) => sftpManager.chmod(id, p, m),
  sftpReadText: (id, p) => sftpManager.readText(id, p),
  sftpWriteText: (id, p, t) => sftpManager.writeText(id, p, t),
  sftpDownload: (id: string, items: { path: string; isDir: boolean }[]) =>
    dialog
      .showOpenDialog(win!, {
        title: tr(S).saveDir,
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory']
      })
      .then(async (r) => {
        const dir = r.filePaths[0]
        if (r.canceled || !dir) return null
        for (const it of items) await sftpManager.download(id, it.path, dir, it.isDir)
        return dir
      }),
  sftpUploadDialog: (id: string, remoteDir: string) =>
    dialog
      .showOpenDialog(win!, {
        title: tr(S).pickUpload,
        properties: ['openFile', 'multiSelections', 'showHiddenFiles']
      })
      .then(async (r) => {
        if (r.canceled) return 0
        for (const f of r.filePaths) await sftpManager.upload(id, f, remoteDir)
        return r.filePaths.length
      }),
  sftpUploadPaths: async (id: string, paths: string[], remoteDir: string) => {
    for (const f of paths) await sftpManager.upload(id, f, remoteDir)
  },

  pveVersion: (server) => proxmoxClient(server).version(),
  pveProbe: (url) => probeCertificate(url),
  pveResources: (id) => pve(id).resources(),
  pveAction: (id, node, type, vmid, action) => pve(id).guestAction(node, type, vmid, action),
  pveSnapshots: (id, node, type, vmid) => pve(id).snapshots(node, type, vmid),
  pveSnapshotCreate: (id, node, type, vmid, name) =>
    pve(id).createSnapshot(node, type, vmid, name, 'Dibuat dari Termos'),
  pveSnapshotRollback: (id, node, type, vmid, name) =>
    pve(id).rollbackSnapshot(node, type, vmid, name),
  pveSnapshotDelete: (id, node, type, vmid, name) => pve(id).deleteSnapshot(node, type, vmid, name),
  pveTasks: (id, node) => pve(id).tasks(node),
  pveGuestAddresses: (id, node, type, vmid) => pve(id).guestAddresses(node, type, vmid),
  pveOpenConsole: (id, node, type, vmid, name) => {
    void shell.openExternal(pve(id).consoleUrl(node, type, vmid, name))
  },

  openExternal: (url) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  },
  appVersion: () => app.getVersion()
}

export function registerIpc(window: BrowserWindow): void {
  win = window
  sessions.attach(window.webContents)

  // Only our own window may call into the main process; anything else (a frame that
  // somehow navigated, a devtools extension) is refused.
  const trusted = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !!win &&
    !win.isDestroyed() &&
    e.sender === win.webContents &&
    e.senderFrame === win.webContents.mainFrame

  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`termos:${name}`, (e, ...args: unknown[]) => {
      if (!trusted(e)) throw new Error('IPC ditolak')
      if (name !== 'vaultStatus' && name !== 'syncStatus') activity()
      return (fn as (...a: unknown[]) => unknown)(...args)
    })
  }
  // Keystrokes and resizes are fire-and-forget to keep typing latency low.
  ipcMain.on('termos:write', (e, id: unknown, data: unknown) => {
    if (!trusted(e) || typeof id !== 'string' || typeof data !== 'string') return
    activity()
    sessions.write(id, data)
  })
  ipcMain.on('termos:resize', (e, id: unknown, cols: unknown, rows: unknown) => {
    if (!trusted(e) || typeof id !== 'string') return
    const c = Number(cols)
    const r = Number(rows)
    if (Number.isInteger(c) && Number.isInteger(r) && c > 0 && r > 0 && c < 2000 && r < 1000)
      sessions.resize(id, c, r)
  })

  startAutoLock()

  let pending: NodeJS.Timeout | null = null
  vault.on('changed', () => {
    sync.localChanged()
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      emit('vault:changed')
    }, 150)
  })
  vault.on('locked', () => emit('vault:locked'))
  forwards.on('status', (s) => emit('forwards:status', s))
  sync.on('status', (s) => emit('sync:status', s))
  sharing.on('status', (s) => emit('share:status', s))
  sftpManager.onProgress = (p) => emit('sftp:progress', p)
}

// ── auto-lock ────────────────────────────────────────────────────────────────

let lastActivity = Date.now()
function activity(): void {
  lastActivity = Date.now()
}

function lockNow(): void {
  if (!vault.isUnlocked()) return
  sync.stop()
  sharing.stopAll()
  sessions.closeAll()
  forwards.stopAll()
  sftpManager.closeAll()
  vault.lock()
}

function startAutoLock(): void {
  setInterval(() => {
    if (!vault.isUnlocked()) return
    const minutes = vault.get().settings.autoLockMinutes
    if (minutes > 0 && Date.now() - lastActivity > minutes * 60_000) lockNow()
  }, 30_000).unref()
  const onSleep = (): void => {
    if (vault.isUnlocked() && vault.get().settings.lockOnSleep) lockNow()
  }
  powerMonitor.on('suspend', onSleep)
  powerMonitor.on('lock-screen', onSleep)
}

export function shutdown(): void {
  sync.stop()
  sharing.stopAll()
  sessions.closeAll()
  forwards.stopAll()
  sftpManager.closeAll()
  if (vault.isUnlocked()) vault.flush()
}
