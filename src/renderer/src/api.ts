import type { Promisified, TermosApi } from '../../shared/api'
import type { CollectionName, Entity } from '../../shared/types'

// Mapped types drop method generics, so upsert keeps its own signature.
type RendererApi = Omit<Promisified<TermosApi>, 'upsert'> & {
  upsert<T extends Entity>(collection: CollectionName, entity: T): Promise<T>
}

/** Typed client for the main process. `api.sftpList(id, dir)` → ipc 'termos:sftpList'. */
export const api = new Proxy({} as RendererApi, {
  get:
    (_t, method: string) =>
    async (...args: unknown[]) => {
      try {
        return await window.termos.invoke(method as keyof TermosApi, ...args)
      } catch (err) {
        // Electron wraps handler errors as "Error invoking remote method 'x': Error: msg".
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }
})

export const bridge = window.termos

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
