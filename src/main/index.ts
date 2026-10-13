import { app, shell, BrowserWindow, Menu, protocol, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc, shutdown } from './ipc'

app.setName('Termos')
// Every renderer runs in the Chromium sandbox, whatever a window's options say.
app.enableSandbox()

/**
 * The UI is served from a private `termos://app/` origin instead of file://.
 * With the GrantFileProtocolExtraPrivileges fuse off, file:// pages get no special
 * powers, and this handler only ever serves files from the bundled renderer folder.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'termos', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])
const RENDERER_DIR = join(__dirname, '../renderer')
// Same policy as the <meta> tag in index.html, plus frame-ancestors (header-only).
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}

async function serveRenderer(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host !== 'app') return new Response('Not found', { status: 404 })
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const file = normalize(join(RENDERER_DIR, rel))
  if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Forbidden', { status: 403 })
  try {
    const body = await readFile(file)
    return new Response(body, {
      headers: {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': CSP
      }
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

app.on('web-contents-created', (_e, contents) => {
  // No <webview>, no new windows, no navigation away from the bundled page.
  contents.on('will-attach-webview', (ev) => ev.preventDefault())
  contents.on('will-navigate', (ev) => ev.preventDefault())
  contents.on('will-redirect', (ev) => ev.preventDefault())
})

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 520,
    show: false,
    title: 'Termos',
    backgroundColor: '#151515',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('termos://app/index.html')
  }
  return mainWindow
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('id.termos.app')
    Menu.setApplicationMenu(null)
    protocol.handle('termos', serveRenderer)
    // Termos never needs camera, microphone, location, notifications or any web permission.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    // The page loads nothing from the network; block any other request outright.
    // (SSH, sync and Proxmox traffic runs in the main process, outside this filter.)
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
      const ok =
        details.url.startsWith('termos://app/') ||
        details.url.startsWith('devtools://') ||
        details.url.startsWith('data:') ||
        details.url.startsWith('blob:termos://app/') ||
        (is.dev && details.url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\0'))
      cb({ cancel: !ok })
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const win = createWindow()
    registerIpc(win)

    app.on('second-instance', () => {
      if (win.isMinimized()) win.restore()
      win.focus()
    })
  })

  app.on('before-quit', () => shutdown())

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
