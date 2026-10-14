import type { ITheme } from '@xterm/xterm'

/**
 * A theme carries two palettes:
 *  - `theme`: the xterm colors for terminal panes (can be picked per host),
 *  - `ui`: the CSS custom properties that restyle the whole app chrome
 *    (sidebar, tabs, buttons, inputs, tables, dialogs, menus, icons).
 */

export interface UiPalette {
  scheme: 'dark' | 'light'
  bg: string
  bg2: string
  bg3: string
  bg4: string
  line: string
  lineStrong: string
  text: string
  text2: string
  text3: string
  accent: string
  accentStrong: string
  accentInk: string
  ok: string
  danger: string
}

export const THEMES: Record<string, { label: string; theme: ITheme; ui: UiPalette }> = {
  'termos-dark': {
    label: 'Termos Graphite',
    theme: {
      background: '#121212',
      foreground: '#e2dfda',
      cursor: '#e9e6e1',
      cursorAccent: '#121212',
      selectionBackground: '#45423d',
      black: '#2a2a2a',
      red: '#f2616b',
      green: '#3ccf91',
      yellow: '#f2b84b',
      blue: '#5b8cff',
      magenta: '#b07cff',
      cyan: '#36b3d6',
      white: '#d4d0ca',
      brightBlack: '#77736d',
      brightRed: '#ff7f88',
      brightGreen: '#6ee6b0',
      brightYellow: '#ffd37a',
      brightBlue: '#86a9ff',
      brightMagenta: '#c9a3ff',
      brightCyan: '#6fd3ef',
      brightWhite: '#ffffff'
    },
    ui: {
      scheme: 'dark',
      bg: '#151515',
      bg2: '#1c1c1c',
      bg3: '#242424',
      bg4: '#2e2e2e',
      line: '#333',
      lineStrong: '#444',
      text: '#e9e6e1',
      text2: '#b3afa8',
      text3: '#9a958e',
      accent: '#e7a43a',
      accentStrong: '#f0b24e',
      accentInk: '#1a1a1a',
      ok: '#6cc387',
      danger: '#f0726a'
    }
  },
  'termos-ember': {
    label: 'Termos Ember',
    theme: {
      background: '#1b1410',
      foreground: '#efe3d3',
      cursor: '#ffb454',
      cursorAccent: '#1b1410',
      selectionBackground: '#40301f',
      black: '#261c14',
      red: '#f0603f',
      green: '#93c55e',
      yellow: '#ffb454',
      blue: '#6a9fd8',
      magenta: '#cf8fbf',
      cyan: '#4fbfc4',
      white: '#d9c9b6',
      brightBlack: '#7c6a55',
      brightRed: '#ff8066',
      brightGreen: '#b3dc85',
      brightYellow: '#ffd08a',
      brightBlue: '#8fbce8',
      brightMagenta: '#e4abd8',
      brightCyan: '#7fd8dc',
      brightWhite: '#fff6ea'
    },
    ui: {
      scheme: 'dark',
      bg: '#191210',
      bg2: '#201712',
      bg3: '#2a1e16',
      bg4: '#362719',
      line: '#3a2a1e',
      lineStrong: '#4f3827',
      text: '#f0e5d8',
      text2: '#c4ae99',
      text3: '#a38c74',
      accent: '#f08c3a',
      accentStrong: '#ffa257',
      accentInk: '#1f120a',
      ok: '#93c55e',
      danger: '#f0605a'
    }
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    theme: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#ff7a93',
      brightGreen: '#b9f27c',
      brightYellow: '#ff9e64',
      brightBlue: '#7da6ff',
      brightMagenta: '#c0a7f7',
      brightCyan: '#0db9d7',
      brightWhite: '#c0caf5'
    },
    ui: {
      scheme: 'dark',
      bg: '#16161e',
      bg2: '#1a1b26',
      bg3: '#1f2335',
      bg4: '#292e42',
      line: '#262b3d',
      lineStrong: '#3b4261',
      text: '#c0caf5',
      text2: '#9aa5ce',
      text3: '#838ab4',
      accent: '#7aa2f7',
      accentStrong: '#8fb0fb',
      accentInk: '#1a1b26',
      ok: '#9ece6a',
      danger: '#f7768e'
    }
  },
  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      selectionBackground: '#585b70',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#89dceb',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#eba0ac',
      brightGreen: '#b1e3a8',
      brightYellow: '#f9e2af',
      brightBlue: '#a3c1ff',
      brightMagenta: '#d8b6fb',
      brightCyan: '#a6e8f0',
      brightWhite: '#a6adc8'
    },
    ui: {
      scheme: 'dark',
      bg: '#181825',
      bg2: '#1e1e2e',
      bg3: '#262637',
      bg4: '#313244',
      line: '#2b2b3d',
      lineStrong: '#45475a',
      text: '#cdd6f4',
      text2: '#bac2de',
      text3: '#9399b2',
      accent: '#cba6f7',
      accentStrong: '#d9bffb',
      accentInk: '#1e1e2e',
      ok: '#a6e3a1',
      danger: '#f38ba8'
    }
  },
  nord: {
    label: 'Nord',
    theme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#d08770',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    },
    ui: {
      scheme: 'dark',
      bg: '#242933',
      bg2: '#2e3440',
      bg3: '#3b4252',
      bg4: '#434c5e',
      line: '#3b4252',
      lineStrong: '#4c566a',
      text: '#eceff4',
      text2: '#d8dee9',
      text3: '#a7b1c2',
      accent: '#88c0d0',
      accentStrong: '#9dd1de',
      accentInk: '#2e3440',
      ok: '#a3be8c',
      danger: '#bf616a'
    }
  },
  dracula: {
    label: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    },
    ui: {
      scheme: 'dark',
      bg: '#21222c',
      bg2: '#282a36',
      bg3: '#343746',
      bg4: '#3e4152',
      line: '#3a3d4d',
      lineStrong: '#4d5166',
      text: '#f8f8f2',
      text2: '#ced0dd',
      text3: '#9aa0b4',
      accent: '#bd93f9',
      accentStrong: '#caa9ff',
      accentInk: '#282a36',
      ok: '#50fa7b',
      danger: '#ff5555'
    }
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#93a1a1',
      brightYellow: '#839496',
      brightBlue: '#657b83',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    },
    ui: {
      scheme: 'dark',
      bg: '#01222b',
      bg2: '#073642',
      bg3: '#0b4553',
      bg4: '#10515f',
      line: '#0e4a57',
      lineStrong: '#1a5f6f',
      text: '#eee8d5',
      text2: '#a3b3b3',
      text3: '#93a1a1',
      accent: '#b58900',
      accentStrong: '#d1a127',
      accentInk: '#002b36',
      ok: '#859900',
      danger: '#dc322f'
    }
  },
  'one-light': {
    label: 'One Light',
    theme: {
      background: '#fafafa',
      foreground: '#383a42',
      cursor: '#526eff',
      selectionBackground: '#d4dcf5',
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#4078f2',
      magenta: '#a626a4',
      cyan: '#0184bc',
      white: '#a0a1a7',
      brightBlack: '#696c77',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#d19a66',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    },
    ui: {
      scheme: 'light',
      bg: '#fafafa',
      bg2: '#f0f0f2',
      bg3: '#e7e7ea',
      bg4: '#dcdce0',
      line: '#e2e2e6',
      lineStrong: '#c8c8cf',
      text: '#383a42',
      text2: '#55575f',
      text3: '#636572',
      accent: '#3266e0',
      accentStrong: '#4d7de8',
      accentInk: '#ffffff',
      ok: '#50a14f',
      danger: '#e45649'
    }
  }
}

export function themeFor(name?: string): ITheme {
  return (THEMES[name ?? ''] ?? THEMES['termos-dark']).theme
}

/** Restyle the whole app chrome by overriding the CSS variables on :root. */
export function applyUiTheme(name?: string): void {
  const { ui } = THEMES[name ?? ''] ?? THEMES['termos-dark']
  const el = document.documentElement
  const set = (prop: string, value: string): void => el.style.setProperty(prop, value)
  set('--bg', ui.bg)
  set('--bg-2', ui.bg2)
  set('--bg-3', ui.bg3)
  set('--bg-4', ui.bg4)
  set('--line', ui.line)
  set('--line-strong', ui.lineStrong)
  set('--text', ui.text)
  set('--text-2', ui.text2)
  set('--text-3', ui.text3)
  set('--accent', ui.accent)
  set('--accent-strong', ui.accentStrong)
  set('--accent-ink', ui.accentInk)
  set('--ok', ui.ok)
  set('--danger', ui.danger)
  set('--focus', ui.text)
  el.style.colorScheme = ui.scheme
}
