import { app, shell, BrowserWindow, Menu, protocol, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
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

/** Small frameless window shown from process start until the main UI is ready. */
function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    show: true,
    frame: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    backgroundColor: '#151515',
    center: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const iconData = readFileSync(icon).toString('base64')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#151515;color:#e2dfda;
      font-family:ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
      -webkit-app-region:no-drag}
    img{width:96px;height:96px}
    .name{font-size:26px;letter-spacing:.35em;margin-left:.35em;color:#ece9e4}
    .bar{width:180px;height:3px;border-radius:2px;background:#2a2a2a;overflow:hidden}
    .bar i{display:block;height:100%;width:40%;border-radius:2px;background:#e7a43a;
      animation:slide 1.1s ease-in-out infinite}
    @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(450%)}}
  </style></head><body>
    <img src="data:image/png;base64,${iconData}" alt="">
    <div class="name">Termos</div>
    <div class="bar"><i></i></div>
  </body></html>`
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return splash
}

function createWindow(splash?: BrowserWindow): BrowserWindow {
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

  mainWindow.on('ready-to-show', () => {
    splash?.close()
    mainWindow.show()
  })

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

    const splash = createSplash()
    const win = createWindow(splash)
    registerIpc(win)

    // If the renderer never reports ready (crash, corrupted bundle), do not
    // leave an immortal splash on screen. The guard matters: in the normal
    // flow the splash is already destroyed when the timer fires, and calling
    // close() on a destroyed window throws "Object has been destroyed".
    const splashTimer = setTimeout(() => {
      if (!splash.isDestroyed()) splash.close()
    }, 10_000)
    splash.on('closed', () => {
      clearTimeout(splashTimer)
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    })

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
