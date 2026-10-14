import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SFTPWrapper, Stats } from 'ssh2'
import { posix } from 'node:path'
import { newId } from '../shared/merge'
import type { Host, SftpEntry } from '../shared/types'
import { tr } from './i18n'
import { connectSsh, type SshConnection } from './ssh/connect'
import { sessions } from './sessions/manager'
import { vault } from './vault'

const S = {
  id: {
    hostNotFound: 'Host tidak ditemukan',
    sessionClosed: 'Sesi SFTP sudah tertutup',
    fileTooLarge: 'File terlalu besar untuk dibuka di editor (> 2 MB)'
  },
  en: {
    hostNotFound: 'Host not found',
    sessionClosed: 'SFTP session is already closed',
    fileTooLarge: 'File too large to open in the editor (> 2 MB)'
  }
}

interface SftpSession {
  conn: SshConnection
  sftp: SFTPWrapper
}

export interface TransferProgress {
  transferId: string
  name: string
  done: number
  total: number
  finished?: boolean
  error?: string
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

const p = <T>(fn: (cb: (err: Error | null | undefined, v: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))))

class SftpManager {
  private open = new Map<string, SftpSession>()
  onProgress: (p: TransferProgress) => void = () => {}

  async connect(hostId: string): Promise<{ sftpId: string; home: string }> {
    const host = vault.find<Host>('hosts', hostId)
    if (!host) throw new Error(tr(S).hostNotFound)
    // A hidden session context lets host-key and password prompts reach the renderer.
    const ctx = sessions.create(`sftp:${host.label}`, hostId)
    try {
      const conn = await connectSsh(hostId, ctx)
      const sftp = await p<SFTPWrapper>((cb) => conn.client.sftp(cb))
      const sftpId = newId()
      this.open.set(sftpId, { conn, sftp })
      conn.client.once('close', () => this.open.delete(sftpId))
      const home = await p<string>((cb) => sftp.realpath('.', cb))
      return { sftpId, home }
    } finally {
      sessions.close(ctx.id)
    }
  }

  private get(id: string): SftpSession {
    const s = this.open.get(id)
    if (!s) throw new Error(tr(S).sessionClosed)
    return s
  }

  close(id: string): void {
    const s = this.open.get(id)
    this.open.delete(id)
    s?.conn.close()
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) this.close(id)
  }

  async list(id: string, dir: string): Promise<SftpEntry[]> {
    const { sftp } = this.get(id)
    const items = await p<{ filename: string; attrs: Stats }[]>((cb) => sftp.readdir(dir, cb))
    return items
      .map(({ filename, attrs }) => {
        const type = (attrs.mode ?? 0) & S_IFMT
        return {
          name: filename,
          path: posix.join(dir, filename),
          isDir: type === S_IFDIR,
          isLink: type === S_IFLNK,
          size: attrs.size ?? 0,
          mode: attrs.mode ?? 0,
          mtime: (attrs.mtime ?? 0) * 1000
        }
      })
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  }

  async realpath(id: string, path: string): Promise<string> {
    return p<string>((cb) => this.get(id).sftp.realpath(path, cb))
  }

  async isDir(id: string, path: string): Promise<boolean> {
    const st = await p<Stats>((cb) => this.get(id).sftp.stat(path, cb))
    return st.isDirectory()
  }

  async mkdir(id: string, path: string): Promise<void> {
    await p<void>((cb) => this.get(id).sftp.mkdir(path, (e) => cb(e, undefined)))
  }

  async rename(id: string, from: string, to: string): Promise<void> {
    await p<void>((cb) => this.get(id).sftp.rename(from, to, (e) => cb(e, undefined)))
  }

  async chmod(id: string, path: string, mode: number): Promise<void> {
    await p<void>((cb) => this.get(id).sftp.chmod(path, mode, (e) => cb(e, undefined)))
  }

  async remove(id: string, path: string, isDir: boolean): Promise<void> {
    const { sftp } = this.get(id)
    if (!isDir) {
      await p<void>((cb) => sftp.unlink(path, (e) => cb(e, undefined)))
      return
    }
    for (const e of await this.list(id, path)) await this.remove(id, e.path, e.isDir && !e.isLink)
    await p<void>((cb) => sftp.rmdir(path, (e) => cb(e, undefined)))
  }

  async readText(id: string, path: string): Promise<string> {
    const { sftp } = this.get(id)
    const st = await p<Stats>((cb) => sftp.stat(path, cb))
    if (st.size > 2 * 1024 * 1024) throw new Error(tr(S).fileTooLarge)
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const rs = sftp.createReadStream(path)
      rs.on('data', (c: Buffer) => chunks.push(c))
      rs.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      rs.on('error', reject)
    })
  }

  async writeText(id: string, path: string, text: string): Promise<void> {
    const { sftp } = this.get(id)
    await new Promise<void>((resolve, reject) => {
      const ws = sftp.createWriteStream(path)
      ws.on('close', () => resolve())
      ws.on('error', reject)
      ws.end(Buffer.from(text, 'utf8'))
    })
  }

  private async transfer(
    name: string,
    fn: (step: (done: number, total: number) => void) => Promise<void>
  ): Promise<void> {
    const transferId = newId()
    let last = 0
    try {
      await fn((done, total) => {
        const now = Date.now()
        if (now - last > 150 || done === total) {
          last = now
          this.onProgress({ transferId, name, done, total })
        }
      })
      this.onProgress({ transferId, name, done: 1, total: 1, finished: true })
    } catch (err) {
      this.onProgress({
        transferId,
        name,
        done: 0,
        total: 1,
        finished: true,
        error: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  async download(id: string, remote: string, localDir: string, isDir: boolean): Promise<void> {
    const { sftp } = this.get(id)
    const target = join(localDir, posix.basename(remote))
    if (isDir) {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(target, { recursive: true })
      for (const e of await this.list(id, remote)) {
        if (e.isLink) continue
        await this.download(id, e.path, target, e.isDir)
      }
      return
    }
    await this.transfer(posix.basename(remote), (step) =>
      p<void>((cb) =>
        sftp.fastGet(remote, target, { step: (done, _c, total) => step(done, total) }, (e) =>
          cb(e, undefined)
        )
      )
    )
  }

  async upload(id: string, local: string, remoteDir: string): Promise<void> {
    const { sftp } = this.get(id)
    const target = posix.join(remoteDir, basename(local))
    if (statSync(local).isDirectory()) {
      await this.mkdir(id, target).catch(() => {
        /* directory may already exist */
      })
      for (const name of readdirSync(local)) await this.upload(id, join(local, name), target)
      return
    }
    await this.transfer(basename(local), (step) =>
      p<void>((cb) =>
        sftp.fastPut(local, target, { step: (done, _c, total) => step(done, total) }, (e) =>
          cb(e, undefined)
        )
      )
    )
  }
}

export const sftpManager = new SftpManager()
