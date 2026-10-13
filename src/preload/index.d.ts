import type { PreloadBridge } from '../shared/api'

declare global {
  interface Window {
    termos: PreloadBridge
  }
}
